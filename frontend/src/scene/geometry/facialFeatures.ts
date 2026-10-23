import { surfacePoint } from "./headShape";
import type { FaceMorph } from "./faceMorph";
import { morphPoint } from "./faceMorph";

/**
 * Non-deforming facial features (eyes, eyelids, brows, ears).
 *
 * The deformable shell is a heightfield over an ellipsoid, so it cannot form a
 * detached eyeball, a true eyelid aperture, a brow, or an undercut ear. Those
 * are therefore authored as separate meshes placed against the same baseline
 * surface via `surfacePoint`, so they sit on the face rather than floating.
 *
 * They are deliberately *not* driven by simulation parameters (there are no
 * eye/brow/ear parameters), so they do not participate in deformation.
 */

export type FeatureSide = -1 | 1;

export interface EyeConfig {
  /** Eye centre in facial coordinates (scene units). */
  x: number;
  y: number;
  ballRadius: number;
  irisRadius: number;
  pupilRadius: number;
  /** How far the eyeball centre is pushed behind the surface point. */
  backset: number;
  /** Outward yaw so the eye faces slightly away from the midline. */
  yaw: number;
  /** Eyelid rim tube radius. */
  lidTube: number;
}

export const EYE: EyeConfig = {
  x: 0.24,
  y: 0.19,
  ballRadius: 0.082,
  irisRadius: 0.04,
  pupilRadius: 0.016,
  backset: 0.07,
  yaw: 0.34,
  lidTube: 0.017,
};

export interface BrowConfig {
  /** Brow arch radius. */
  radius: number;
  /** Brow tube radius. */
  tube: number;
  /** Arc angle of the brow. */
  arc: number;
  /** Vertical offset above the eye centre. */
  above: number;
}

export const BROW: BrowConfig = {
  radius: 0.125,
  tube: 0.014,
  arc: Math.PI * 0.62,
  above: 0.075,
};

export interface EarConfig {
  x: number;
  y: number;
  z: number;
  /** Half-extents of the outer ear shell. */
  scale: readonly [number, number, number];
  /** Half-extents of the inner concha recess. */
  innerScale: readonly [number, number, number];
  /** Outward yaw of the ear. */
  yaw: number;
}

export const EAR: EarConfig = {
  x: 0.66,
  y: -0.03,
  z: -0.04,
  scale: [0.028, 0.115, 0.098],
  innerScale: [0.016, 0.064, 0.056],
  yaw: 0.42,
};

/** Skin / feature colours used by the viewer material set. */
export const FEATURE_COLORS = {
  skin: "#e7b89b",
  skinShadow: "#c98f72",
  sclera: "#f3efe9",
  iris: "#5a4636",
  pupil: "#171009",
  brow: "#4b3626",
} as const;

/** Eyeball centre for a side, pushed back into the socket. */
export function eyeCenter(
  side: FeatureSide,
  morph?: FaceMorph,
): [number, number, number] {
  const [x, y, z] = surfacePoint(side * EYE.x, EYE.y, morph);
  return [x, y, z - EYE.backset];
}

/** Brow anchor for a side, on the surface above the eye. */
export function browAnchor(
  side: FeatureSide,
  morph?: FaceMorph,
): [number, number, number] {
  const [x, y, z] = surfacePoint(side * EYE.x, EYE.y + BROW.above, morph);
  return [x, y, z];
}

/** Ear anchor for a side. */
export function earAnchor(
  side: FeatureSide,
  morph?: FaceMorph,
): [number, number, number] {
  if (morph) {
    const out: number[] = [0, 0, 0];
    morphPoint(side * EAR.x, EAR.y, EAR.z, morph, out);
    return [out[0], out[1], out[2]];
  }
  return [side * EAR.x, EAR.y, EAR.z];
}
