import { HEAD_SHAPE } from "./headShape";

/**
 * Identity morph (Phase 9).
 *
 * The photogrammetric step of this prototype is a *landmark-driven proportional
 * fit*: facial landmarks detected on a frontal photograph are converted into a
 * small set of bounded identity coefficients (`FaceMorph`), which warp the
 * generated head surface into a personalized baseline. The existing 17
 * simulation parameters are then applied *relative to that baseline*, so a
 * person's face is preserved while a region is edited.
 *
 * This is deliberately honest about what it is: a parametric proportion fit,
 * not a full 3D morphable model / photogrammetric reconstruction. A single
 * frontal image cannot reveal hidden side geometry, so depth changes (e.g. nose
 * projection) are bounded estimates. See
 * `docs/FACE_RECONSTRUCTION_CORRECTION_REPORT.md`.
 *
 * Every coefficient is nominally in [-1, 1] and defaults to 0 (the neutral,
 * generic head). With an all-zero morph, `morphPoint` is the identity, so the
 * default model and every existing geometry test are unchanged.
 */

export interface FaceMorph {
  /** Overall facial (zygomatic/midface) width. +wider. */
  faceWidth: number;
  /** Overall vertical face length. +longer. */
  faceLength: number;
  /** Height of the forehead band. +taller. */
  foreheadHeight: number;
  /** Lower-jaw width. +wider. */
  jawWidth: number;
  /** Chin width. +wider. */
  chinWidth: number;
  /** Chin vertical length. +longer. */
  chinLength: number;
  /** Malar (cheek) fullness. +fuller. */
  cheekFullness: number;
  /** Horizontal eye separation. +wider set. */
  eyeSpacing: number;
  /** Eye feature size. +larger. */
  eyeSize: number;
  /** Vertical eye position. +higher. */
  eyeHeight: number;
  /** Vertical brow position. +higher. */
  browHeight: number;
  /** Nose (bridge/ala) width. +wider. */
  noseWidth: number;
  /** Nose length (nasion to subnasale). +longer. */
  noseLength: number;
  /** Estimated anterior tip projection. +more projected. */
  noseTip: number;
  /** Mouth width. +wider. */
  mouthWidth: number;
  /** Lip fullness. +fuller. */
  lipFullness: number;
}

export const NEUTRAL_FACE_MORPH: FaceMorph = {
  faceWidth: 0,
  faceLength: 0,
  foreheadHeight: 0,
  jawWidth: 0,
  chinWidth: 0,
  chinLength: 0,
  cheekFullness: 0,
  eyeSpacing: 0,
  eyeSize: 0,
  eyeHeight: 0,
  browHeight: 0,
  noseWidth: 0,
  noseLength: 0,
  noseTip: 0,
  mouthWidth: 0,
  lipFullness: 0,
};

export const FACE_MORPH_KEYS: (keyof FaceMorph)[] = Object.keys(
  NEUTRAL_FACE_MORPH,
) as (keyof FaceMorph)[];

/** True when every coefficient is ~0 (identity morph). */
export function isNeutralMorph(morph: FaceMorph): boolean {
  for (const key of FACE_MORPH_KEYS) {
    if (Math.abs(morph[key]) > 1e-6) return false;
  }
  return true;
}

/** Clamp a morph coefficient to [-1, 1]; non-finite values collapse to 0. */
export function clampMorph(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

function bell(value: number, center: number, sigma: number): number {
  const t = (value - center) / sigma;
  return Math.exp(-t * t);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function frontMask(z: number): number {
  const f = Math.max(0, Math.min(1, z / HEAD_SHAPE.rz));
  return f * f * (3 - 2 * f);
}

/**
 * Warp a single head-surface point through the identity morph. Pure and
 * deterministic: identical inputs always yield identical outputs, so the
 * personalized baseline never drifts.
 *
 * Feature-local terms are faded out by a front mask (so the back of the skull
 * is not distorted), while global width/length scale the whole head.
 */
export function morphPoint(
  x: number,
  y: number,
  z: number,
  morph: FaceMorph,
  out: number[],
): number[] {
  const faceWidth = clampMorph(morph.faceWidth);
  const faceLength = clampMorph(morph.faceLength);
  const foreheadHeight = clampMorph(morph.foreheadHeight);
  const jawWidth = clampMorph(morph.jawWidth);
  const chinWidth = clampMorph(morph.chinWidth);
  const chinLength = clampMorph(morph.chinLength);
  const cheekFullness = clampMorph(morph.cheekFullness);
  const eyeSpacing = clampMorph(morph.eyeSpacing);
  const eyeHeight = clampMorph(morph.eyeHeight);
  const browHeight = clampMorph(morph.browHeight);
  const noseWidth = clampMorph(morph.noseWidth);
  const noseLength = clampMorph(morph.noseLength);
  const noseTip = clampMorph(morph.noseTip);
  const mouthWidth = clampMorph(morph.mouthWidth);
  const lipFullness = clampMorph(morph.lipFullness);

  const front = frontMask(z);
  const ax = Math.abs(x);
  const sx = x === 0 ? 0 : Math.sign(x);

  // Global proportion: vertical length about the eye line and overall width.
  let nx = x * (1 + 0.12 * faceWidth);
  let ny = 0.19 + (y - 0.19) * (1 + 0.12 * faceLength);
  let nz = z;

  // Forehead height.
  if (foreheadHeight !== 0) {
    const mask = front * bell(x, 0, 0.45) * smoothstep(0.2, 0.72, y);
    ny += 0.07 * foreheadHeight * mask;
  }

  // Jaw width (lower-lateral mandible).
  if (jawWidth !== 0 && sx !== 0) {
    const mask = front * bell(ax, 0.42, 0.17) * bell(y, -0.5, 0.17);
    nx += sx * 0.1 * jawWidth * mask;
  }

  // Chin width.
  if (chinWidth !== 0 && sx !== 0) {
    const mask = front * bell(ax, 0.12, 0.08) * bell(y, -0.56, 0.08);
    nx += sx * 0.08 * chinWidth * mask;
  }

  // Chin length (downward).
  if (chinLength !== 0) {
    const mask = front * bell(x, 0, 0.16) * smoothstep(-0.42, -0.64, y);
    ny -= 0.08 * chinLength * mask;
  }

  // Cheek fullness.
  if (cheekFullness !== 0) {
    const mask = front * bell(ax, 0.42, 0.14) * bell(y, -0.06, 0.13);
    if (sx !== 0) nx += sx * 0.07 * cheekFullness * mask;
    nz += 0.04 * cheekFullness * mask;
  }

  // Eye spacing (lateral) and eye height (vertical), about the eyes.
  if (eyeSpacing !== 0 && sx !== 0) {
    const mask = front * bell(ax, 0.24, 0.13) * bell(y, 0.19, 0.12);
    nx += sx * 0.05 * eyeSpacing * mask;
  }
  if (eyeHeight !== 0) {
    const mask = front * bell(ax, 0.24, 0.13) * bell(y, 0.19, 0.1);
    ny += 0.05 * eyeHeight * mask;
  }

  // Brow height.
  if (browHeight !== 0) {
    const mask = front * bell(ax, 0.24, 0.14) * bell(y, 0.27, 0.09);
    ny += 0.05 * browHeight * mask;
  }

  // Nose width (alar / dorsum).
  if (noseWidth !== 0 && sx !== 0) {
    const mask = front * bell(ax, 0.12, 0.1) * bell(y, -0.14, 0.16);
    nx += sx * 0.05 * noseWidth * mask;
  }

  // Nose length: lower the lower-nose complex (tip + alae) toward the lip.
  if (noseLength !== 0) {
    const mask = front * bell(x, 0, 0.11) * smoothstep(-0.08, -0.34, y);
    ny -= 0.06 * noseLength * mask;
  }

  // Nose tip projection (bounded depth estimate).
  if (noseTip !== 0) {
    const mask = front * bell(x, 0, 0.11) * bell(y, -0.16, 0.09);
    nz += 0.06 * noseTip * mask;
  }

  // Mouth width.
  if (mouthWidth !== 0 && sx !== 0) {
    const mask =
      front * bell(ax, 0, 0.13) * (bell(y, -0.36, 0.06) + bell(y, -0.44, 0.07));
    nx += sx * 0.05 * mouthWidth * mask;
  }

  // Lip fullness.
  if (lipFullness !== 0) {
    const mask =
      front *
      bell(x, 0, 0.14) *
      (bell(y, -0.36, 0.05) + bell(y, -0.44, 0.06));
    nz += 0.04 * lipFullness * mask;
  }

  out[0] = nx;
  out[1] = ny;
  out[2] = nz;
  return out;
}

/**
 * Apply the identity morph to a whole baseline position buffer, returning a new
 * buffer. When the morph is neutral the input is returned unchanged (so the
 * default model is byte-identical and drift-free).
 */
export function applyFaceMorph(
  base: Float32Array,
  morph: FaceMorph,
): Float32Array {
  if (isNeutralMorph(morph)) return base;
  const count = Math.floor(base.length / 3);
  const result = new Float32Array(base.length);
  const out: number[] = [0, 0, 0];
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    morphPoint(base[o], base[o + 1], base[o + 2], morph, out);
    result[o] = out[0];
    result[o + 1] = out[1];
    result[o + 2] = out[2];
  }
  return result;
}

/** Eye feature scale factor derived from the morph (for anatomy meshes). */
export function morphEyeScale(morph: FaceMorph): number {
  return 1 + 0.28 * clampMorph(morph.eyeSize);
}
