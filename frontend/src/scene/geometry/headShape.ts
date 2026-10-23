/**
 * Parametric volumetric head shape (Phase 4 foundation; facial-anatomy pass).
 *
 * Coordinate system (see docs/PHASE_4_REPORT.md):
 *   - X: left(-) / right(+) across the face, mirrored about X = 0.
 *   - Y: superior(+) / inferior(-) along the face.
 *   - Z: anterior(front, +) / posterior(back, -).
 *   - Origin: centre of the head.
 *
 * This is still the sanctioned *generated* head (no external asset: the
 * licences of candidate meshes could not be authoritatively verified — see
 * PHASE_4_REPORT.md). It is a closed remapped sphere, but the sculpting was
 * reworked to read as a recognisable human than a smooth ball:
 *   - the lower face / jaw / chin taper is narrower than the cranium,
 *   - the brow ridge, temples, eye sockets and cheekbones are modelled,
 *   - the nose gets a dorsal ridge, a projecting tip, alar wings and nostril
 *     recesses,
 *   - the lips are two distinct masses split by an oral fissure, with a
 *     philtrum above and a mentolabial sulcus below,
 *   - eyes, eyelids, brows and ears are added as separate meshes (see
 *     `facialFeatures.ts`), because a heightfield-over-ellipsoid cannot form a
 *     detached eyeball or an undercut ear.
 *
 * Scale note: the head has no verified physical dimensions. The facial width is
 * an *illustrative* 150 mm reference (see `config.ts`), not a calibration.
 */

import type { FaceMorph } from "./faceMorph";
import { morphPoint } from "./faceMorph";

export interface HeadShapeRadii {
  rx: number;
  ry: number;
  rz: number;
}

/** Axis-aligned reference semiaxes of the base head (scene units). */
export const HEAD_SHAPE: HeadShapeRadii = { rx: 0.7, ry: 0.92, rz: 0.86 };

/** Axis-aligned bounds of the base head. */
export const HEAD_BOUNDS = {
  min: [-HEAD_SHAPE.rx, -HEAD_SHAPE.ry, -HEAD_SHAPE.rz] as const,
  max: [HEAD_SHAPE.rx, HEAD_SHAPE.ry, HEAD_SHAPE.rz] as const,
};

/** Symmetric gaussian bell used to sculpt every facial feature. */
function bell(value: number, center: number, sigma: number): number {
  const t = (value - center) / sigma;
  return Math.exp(-t * t);
}

/** Smooth Hermite step: 0 at edge0, 1 at edge1 (edge0 may be > edge1). */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Smooth 0..1 front mask from an ellipsoid depth coordinate. Features fade to
 * zero at the silhouette so the surface never tears.
 */
function frontMaskFromDz(dz: number): number {
  const f = Math.max(0, Math.min(1, dz));
  return f * f * (3 - 2 * f);
}

/**
 * Map a unit-sphere direction to the sculpted head surface.
 *
 * Pure function of the direction: the same input always yields the same output,
 * which keeps the baseline immutable and the deformation drift-free.
 */
export function shapeInto(
  dx: number,
  dy: number,
  dz: number,
  out: number[],
): number[] {
  const { rx, ry, rz } = HEAD_SHAPE;

  let x = dx * rx;
  let y = dy * ry;
  let z = dz * rz;

  const front = frontMaskFromDz(dz);

  // Lower face narrows toward the jaw and chin (a head is not an ellipsoid).
  const lowerFace = smoothstep(0.18, -0.78, dy);
  x *= 1 - 0.17 * lowerFace;

  // Slight occipital flattening so the back of the head is not a perfect ball.
  if (dz < 0) z *= 1 - 0.07 * smoothstep(0, -1, dz);

  // Anterior feature sculpting, faded out at the silhouette by `front`.
  let fz = 0;

  // Forehead plate (broad, gently proud).
  fz += 0.05 * bell(dy, 0.5, 0.16) * bell(dx, 0, 0.5);

  // Brow ridge above the eyes (paired lobes).
  fz +=
    0.035 *
    bell(dy, 0.24, 0.05) *
    (bell(dx, 0.21, 0.15) + bell(dx, -0.21, 0.15));

  // Temples (soft recesses at the sides of the forehead).
  fz -=
    0.028 *
    bell(dy, 0.27, 0.09) *
    (bell(dx, 0.52, 0.09) + bell(dx, -0.52, 0.09));

  // Eye sockets (recessed, so the added eyeballs sit inside).
  fz -=
    0.075 *
    bell(dy, 0.19, 0.07) *
    (bell(dx, 0.24, 0.09) + bell(dx, -0.24, 0.09));

  // Malar (cheekbone) prominences.
  fz +=
    0.06 *
    bell(dy, -0.02, 0.13) *
    (bell(dx, 0.4, 0.14) + bell(dx, -0.4, 0.14));

  // Nose: ONE continuous dorsum whose height rises monotonically from the
  // nasion to the tip and whose width grows toward the tip. It is built from a
  // single monotonic amplitude, not a sum of gaussian bumps (the previous
  // bridge-ridge + tip-ball pair left a waist between them that read as two
  // overlapping bulges). `noseS` runs 0 at the nasion to 1 at the tip; the
  // window fades the ridge in above the nasion and out below the subnasale.
  const noseS = Math.min(1, Math.max(0, (0.3 - dy) / (0.3 + 0.16)));
  const noseWindow = smoothstep(0.4, 0.3, dy) * smoothstep(-0.34, -0.26, dy);
  const dorsumAmp = 0.05 + 0.2 * noseS;
  const dorsumSigma = 0.045 + 0.055 * noseS;
  fz += dorsumAmp * noseWindow * bell(dx, 0, dorsumSigma);

  // Alar wings: soft flares blended into the tip, low enough not to read as
  // separate spheres.
  fz +=
    0.045 *
    bell(dy, -0.185, 0.055) *
    (bell(dx, 0.14, 0.07) + bell(dx, -0.14, 0.07));

  // Nostril recesses under the tip.
  fz -=
    0.05 *
    bell(dy, -0.22, 0.028) *
    (bell(dx, 0.08, 0.032) + bell(dx, -0.08, 0.032));

  // Columella / nasal sill: a low midline ridge beneath the tip.
  fz += 0.018 * bell(dx, 0, 0.035) * bell(dy, -0.245, 0.028);

  // Philtrum column and the subnasale depression.
  fz -= 0.03 * bell(dx, 0, 0.05) * bell(dy, -0.27, 0.032);
  fz += 0.02 * bell(Math.abs(dx), 0.03, 0.02) * bell(dy, -0.31, 0.05);

  // Upper and lower lips: two distinct anterior masses so they can deform
  // independently; the oral fissure between them stays recessed.
  fz += 0.06 * bell(dx, 0, 0.12) * bell(dy, -0.36, 0.032);
  fz += 0.066 * bell(dx, 0, 0.13) * bell(dy, -0.44, 0.038);
  fz -= 0.036 * bell(dx, 0, 0.14) * bell(dy, -0.4, 0.014);

  // Mentolabial sulcus (crease between lower lip and chin).
  fz -= 0.03 * bell(dx, 0, 0.12) * bell(dy, -0.5, 0.032);

  // Chin (pogonion / menton).
  fz += 0.07 * bell(dx, 0, 0.11) * bell(dy, -0.58, 0.085);

  z += fz * front;

  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/**
 * Analytic front-surface point for a facial coordinate `(x, y)` in scene units.
 * Used to place landmarks, reference features and region probes relative to the
 * same shape the mesh is built from.
 */
export function surfacePoint(
  x: number,
  y: number,
  morph?: FaceMorph,
): [number, number, number] {
  const { rx, ry } = HEAD_SHAPE;
  const nx = x / rx;
  const ny = y / ry;
  const dz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const out: number[] = [0, 0, 0];
  shapeInto(nx, ny, dz, out);
  if (morph) morphPoint(out[0], out[1], out[2], morph, out);
  return [out[0], out[1], out[2]];
}
