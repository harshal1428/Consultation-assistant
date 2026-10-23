import { HEAD_SHAPE, surfacePoint } from "./headShape";

/**
 * Deformation region weights (Phase 4; extended in Phase 7).
 *
 * Each function maps a *baseline* vertex position to a bounded 0..1 influence.
 * Weights are always evaluated from the immutable baseline, never from already
 * deformed geometry, which keeps deformation drift-free.
 *
 * Regions are structurally separated:
 *   - bridge / dorsum  (midline, upper corridor)
 *   - nasal tip        (lower midline apex)
 *   - alar / nostril   (lateral wings)
 *   - upper / lower lip (two distinct anterior masses)
 *   - chin             (lower midline; projection / height / width)
 *   - jawline          (lower-lateral mandibular region; width / contour)
 *   - cheek            (malar region, both sides; projection / fullness)
 *
 * The bands are deliberately chosen so that one region's controls do not move
 * another region's vertices, except for the small, documented transition
 * overlaps tested in `tests/geometry.test.ts`.
 *
 * The numbers live in a `FaceRegionFrame`. The default frame is the frame the
 * sculpted, procedural head was tuned for; the realistic head supplies its own
 * frame with the same semantics but its own anatomical centres. Keeping the
 * frame explicit means the deformation engine stays identical for both heads.
 */

export type RegionVec3 = [number, number, number];

export interface FaceRegionBell {
  /** Centre along the axis (or absolute x for the paired regions). */
  center: number;
  /** Gaussian width along the same axis. */
  sigma: number;
}

export interface FaceRegionFrame {
  /** Depth at which the smooth "front of the face" mask reaches 1. */
  frontZ: number;
  bridge: { x: number; sx: number; y: number; sy: number };
  bridgeWidth: { x: number; sx: number; y: number; sy: number };
  tip: { x: number; sx: number; y: number; sy: number };
  alar: { x: number; sx: number; y: number; sy: number };
  upperLip: { x: number; sx: number; y: number; sy: number };
  lowerLip: { x: number; sx: number; y: number; sy: number };
  chinProjection: { x: number; sx: number; y: number; sy: number };
  chinHeight: { x: number; sx: number; y: number; sy: number };
  chinWidth: { x: number; sx: number; y: number; sy: number };
  jawWidth: { x: number; sx: number; y: number; sy: number };
  jawDefinition: { x: number; sx: number; y: number; sy: number };
  cheekProjection: { x: number; sx: number; y: number; sy: number };
  cheekFullness: { x: number; sx: number; y: number; sy: number };
  /** Subnasale, used as the tip-rotation pivot. */
  tipPivot: { y: number; z: number };
  /** Radial centre of the upper lip fullness. */
  upperLipCenter: { y: number; z: number };
  /** Radial centre of the lower lip fullness. */
  lowerLipCenter: { y: number; z: number };
  /** Chin-height scaling pivot (roughly the top of the chin mass). */
  chinHeightPivot: number;
  /**
   * Explicit 3D landmark positions for a head that is not described by the
   * procedural `surfacePoint` function. Absent for the sculpted head.
   */
  landmarkPositions?: Record<string, RegionVec3>;
}

function bell(value: number, center: number, sigma: number): number {
  const t = (value - center) / sigma;
  return Math.exp(-t * t);
}

/** Smooth 0..1 front mask estimated from a baseline depth coordinate. */
function frontMask(z: number, frontZ: number): number {
  const f = Math.max(0, Math.min(1, z / frontZ));
  return f * f * (3 - 2 * f);
}

/** The frame the sculpted head and the original region tests were tuned for. */
export const DEFAULT_REGION_FRAME: FaceRegionFrame = {
  frontZ: HEAD_SHAPE.rz,
  bridge: { x: 0, sx: 0.085, y: 0.17, sy: 0.15 },
  bridgeWidth: { x: 0.075, sx: 0.05, y: 0.2, sy: 0.14 },
  tip: { x: 0, sx: 0.1, y: -0.16, sy: 0.1 },
  alar: { x: 0.15, sx: 0.06, y: -0.19, sy: 0.055 },
  upperLip: { x: 0, sx: 0.13, y: -0.36, sy: 0.03 },
  lowerLip: { x: 0, sx: 0.14, y: -0.44, sy: 0.036 },
  chinProjection: { x: 0, sx: 0.13, y: -0.57, sy: 0.075 },
  chinHeight: { x: 0, sx: 0.15, y: -0.56, sy: 0.085 },
  chinWidth: { x: 0.12, sx: 0.075, y: -0.56, sy: 0.075 },
  jawWidth: { x: 0.42, sx: 0.17, y: -0.5, sy: 0.17 },
  jawDefinition: { x: 0.5, sx: 0.13, y: -0.47, sy: 0.13 },
  cheekProjection: { x: 0.4, sx: 0.14, y: -0.05, sy: 0.12 },
  cheekFullness: { x: 0.43, sx: 0.13, y: -0.08, sy: 0.12 },
  tipPivot: { y: -0.3, z: surfacePoint(0, -0.3)[2] },
  upperLipCenter: { y: -0.36, z: surfacePoint(0, -0.36)[2] },
  lowerLipCenter: { y: -0.44, z: surfacePoint(0, -0.44)[2] },
  chinHeightPivot: -0.5,
};

/** Nasal bridge / dorsum corridor influence. */
export function bridgeWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.bridge;
  return frontMask(z, frame.frontZ) * bell(x, r.x, r.sx) * bell(y, r.y, r.sy);
}

/** Lateral dorsum influence for width changes. Excludes the alar band. */
export function bridgeWidthWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.bridgeWidth;
  return frontMask(z, frame.frontZ) * bell(Math.abs(x), r.x, r.sx) * bell(y, r.y, r.sy);
}

/** Nasal tip apex influence. */
export function tipWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.tip;
  return frontMask(z, frame.frontZ) * bell(x, r.x, r.sx) * bell(y, r.y, r.sy);
}

/**
 * Alar / nostril wing influence. Driven by the independent `alarWidth`
 * parameter, so bridge-width changes can never widen the nostrils by accident.
 * The weight is symmetric about the midline and localised to the wings.
 */
export function alarWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.alar;
  return (
    frontMask(z, frame.frontZ) *
    bell(y, r.y, r.sy) *
    (bell(x, r.x, r.sx) + bell(x, -r.x, r.sx))
  );
}

/* -------------------------------------------------------------------------- */
/* Lips (Phase 7)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Upper-lip influence. The vertical sigma is intentionally small so that the
 * band does not reach the subnasale / nasal base, keeping lip controls clear of
 * the nose.
 */
export function upperLipWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.upperLip;
  return frontMask(z, frame.frontZ) * bell(x, r.x, r.sx) * bell(y, r.y, r.sy);
}

/** Lower-lip influence, separate from the upper lip and from the chin. */
export function lowerLipWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.lowerLip;
  return frontMask(z, frame.frontZ) * bell(x, r.x, r.sx) * bell(y, r.y, r.sy);
}

/* -------------------------------------------------------------------------- */
/* Chin (Phase 7)                                                              */
/* -------------------------------------------------------------------------- */

/** Chin (pogonion) anterior projection influence. */
export function chinProjectionWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.chinProjection;
  return frontMask(z, frame.frontZ) * bell(x, r.x, r.sx) * bell(y, r.y, r.sy);
}

/** Chin vertical-dimension influence (scaled about the chin top pivot). */
export function chinHeightWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.chinHeight;
  return frontMask(z, frame.frontZ) * bell(x, r.x, r.sx) * bell(y, r.y, r.sy);
}

/**
 * Chin width influence. Centred nearer the midline than the jaw so chin width
 * and jaw width stay independently controllable.
 */
export function chinWidthWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.chinWidth;
  return frontMask(z, frame.frontZ) * bell(Math.abs(x), r.x, r.sx) * bell(y, r.y, r.sy);
}

/* -------------------------------------------------------------------------- */
/* Jawline (Phase 7)                                                           */
/* -------------------------------------------------------------------------- */

/** Broad lower-lateral jaw mass influence (jaw width). */
export function jawWidthWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.jawWidth;
  return frontMask(z, frame.frontZ) * bell(Math.abs(x), r.x, r.sx) * bell(y, r.y, r.sy);
}

/**
 * Narrow mandibular contour band influence (jaw definition). Sits further
 * lateral and lower than the broad jaw mass, so it sharpens the outer border
 * rather than inflating the whole jaw.
 */
export function jawDefinitionWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.jawDefinition;
  return frontMask(z, frame.frontZ) * bell(Math.abs(x), r.x, r.sx) * bell(y, r.y, r.sy);
}

/* -------------------------------------------------------------------------- */
/* Cheeks (Phase 7)                                                            */
/* -------------------------------------------------------------------------- */

/** Malar (cheekbone) anterior projection influence, both sides. */
export function cheekProjectionWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.cheekProjection;
  return frontMask(z, frame.frontZ) * bell(Math.abs(x), r.x, r.sx) * bell(y, r.y, r.sy);
}

/** Malar outward fullness influence (lateral + slight anterior), both sides. */
export function cheekFullnessWeight(
  x: number,
  y: number,
  z: number,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): number {
  const r = frame.cheekFullness;
  return frontMask(z, frame.frontZ) * bell(Math.abs(x), r.x, r.sx) * bell(y, r.y, r.sy);
}
