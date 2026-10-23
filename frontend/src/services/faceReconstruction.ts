import type { FaceMorph } from "../scene/geometry/faceMorph";
import { NEUTRAL_FACE_MORPH, clampMorph } from "../scene/geometry/faceMorph";

/**
 * Landmark-driven proportional reconstruction (Phase 9).
 *
 * Detected facial landmarks (from MediaPipe Face Mesh, 478 points, normalized
 * image coordinates) are reduced to a small set of anthropometric ratios and
 * then to bounded identity coefficients (`FaceMorph`) that personalize the
 * generated head. This module is pure and dependency-free so it can be unit
 * tested with synthetic landmarks.
 *
 * The MediaPipe Face Mesh model is a trained 3D surface regressor: every
 * landmark carries an estimated depth coordinate (z), not just a 2D position.
 * This module therefore fits BOTH the transverse proportions (x/y ratios) and
 * the recovered depth (the anterior projection of the nose relative to the
 * rest of the face). It is still honest about its limits: a single frontal
 * photo gives a bounded depth estimate, so the depth-derived terms are
 * conservative, and it is not a photogrammetric scan.
 */

export interface FaceLandmarkPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * MediaPipe Face Mesh landmark indices used for measurement. Only stable,
 * widely documented indices are used so the mapping is robust.
 */
export const FACE_LANDMARK_INDEX = {
  foreheadTop: 10,
  chinBottom: 152,
  faceRight: 234,
  faceLeft: 454,
  jawRight: 172,
  jawLeft: 397,
  chinRight: 136,
  chinLeft: 365,
  eyeRightOuter: 33,
  eyeRightInner: 133,
  eyeLeftInner: 362,
  eyeLeftOuter: 263,
  irisRight: 468,
  irisLeft: 473,
  browRight: 105,
  browLeft: 334,
  noseBridge: 168,
  noseTip: 1,
  subnasale: 2,
  alarRight: 129,
  alarLeft: 358,
  mouthRight: 61,
  mouthLeft: 291,
  upperLipTop: 13,
  lowerLipBottom: 17,
} as const;

/** The highest landmark index this module reads (for validation). */
const REQUIRED_INDEX = FACE_LANDMARK_INDEX.irisLeft;

export interface FaceProfile {
  faceWidthOverHeight: number;
  eyeLineOverHeight: number;
  interocularOverWidth: number;
  eyeWidthOverWidth: number;
  noseWidthOverWidth: number;
  noseLengthOverHeight: number;
  mouthWidthOverWidth: number;
  lipHeightOverHeight: number;
  jawWidthOverWidth: number;
  chinWidthOverWidth: number;
  chinHeightOverHeight: number;
  browHeightOverHeight: number;
  /**
   * Recovered anterior projection of the nose: the depth gap between the nasal
   * bridge and the tip, normalised by the face's landmark depth spread. Larger
   * means a more projecting nose. Derived from the MediaPipe 3D (z) output.
   */
  noseProjectionDepth: number;
}

/**
 * Reference ("typical adult") ratios. A photograph whose measurements match
 * these yields a neutral morph, so the personalized baseline defaults to the
 * generic head for an average face. These are heuristic central values for a
 * frontal adult portrait, not a validated anthropometric dataset.
 */
export const TYPICAL_PROFILE: FaceProfile = {
  faceWidthOverHeight: 0.74,
  eyeLineOverHeight: 0.47,
  interocularOverWidth: 0.42,
  eyeWidthOverWidth: 0.19,
  noseWidthOverWidth: 0.23,
  noseLengthOverHeight: 0.24,
  mouthWidthOverWidth: 0.32,
  lipHeightOverHeight: 0.055,
  jawWidthOverWidth: 0.72,
  chinWidthOverWidth: 0.48,
  chinHeightOverHeight: 0.11,
  browHeightOverHeight: 0.075,
  noseProjectionDepth: 0.35,
};

export class FaceReconstructionError extends Error {}

function dist(a: FaceLandmarkPoint, b: FaceLandmarkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function vertical(a: FaceLandmarkPoint, b: FaceLandmarkPoint): number {
  return a.y - b.y;
}

function at(landmarks: FaceLandmarkPoint[], index: number): FaceLandmarkPoint {
  const p = landmarks[index];
  if (!p) throw new FaceReconstructionError("Facial landmarks are incomplete.");
  return p;
}

/** Validate that a landmark array is usable for measurement. */
export function isValidLandmarkSet(landmarks: FaceLandmarkPoint[]): boolean {
  if (!Array.isArray(landmarks) || landmarks.length <= REQUIRED_INDEX) return false;
  return landmarks.every(
    (p) =>
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x >= -0.5 &&
      p.x <= 1.5 &&
      p.y >= -0.5 &&
      p.y <= 1.5,
  );
}

/**
 * Reduce landmarks to anthropometric ratios. Throws `FaceReconstructionError`
 * when the set is unusable or degenerate (e.g. face too small in frame).
 */
export function measureProfile(landmarks: FaceLandmarkPoint[]): FaceProfile {
  if (!isValidLandmarkSet(landmarks)) {
    throw new FaceReconstructionError("Face landmarks could not be measured.");
  }
  const idx = FACE_LANDMARK_INDEX;
  const foreheadTop = at(landmarks, idx.foreheadTop);
  const chinBottom = at(landmarks, idx.chinBottom);
  const faceRight = at(landmarks, idx.faceRight);
  const faceLeft = at(landmarks, idx.faceLeft);

  const faceWidth = dist(faceRight, faceLeft);
  const faceHeight = vertical(chinBottom, foreheadTop);
  if (faceWidth < 1e-3 || faceHeight < 1e-3) {
    throw new FaceReconstructionError("The detected face is too small to measure.");
  }

  const irisRight = at(landmarks, idx.irisRight);
  const irisLeft = at(landmarks, idx.irisLeft);
  const eyeLineY = (irisRight.y + irisLeft.y) / 2;

  const eyeRightOuter = at(landmarks, idx.eyeRightOuter);
  const eyeRightInner = at(landmarks, idx.eyeRightInner);
  const eyeLeftInner = at(landmarks, idx.eyeLeftInner);
  const eyeLeftOuter = at(landmarks, idx.eyeLeftOuter);
  const eyeWidth =
    (dist(eyeRightOuter, eyeRightInner) + dist(eyeLeftInner, eyeLeftOuter)) / 2;

  const browRight = at(landmarks, idx.browRight);
  const browLeft = at(landmarks, idx.browLeft);
  const browLineY = (browRight.y + browLeft.y) / 2;

  const noseBridge = at(landmarks, idx.noseBridge);
  const subnasale = at(landmarks, idx.subnasale);
  const alarRight = at(landmarks, idx.alarRight);
  const alarLeft = at(landmarks, idx.alarLeft);

  const mouthRight = at(landmarks, idx.mouthRight);
  const mouthLeft = at(landmarks, idx.mouthLeft);
  const upperLipTop = at(landmarks, idx.upperLipTop);
  const lowerLipBottom = at(landmarks, idx.lowerLipBottom);

  const jawRight = at(landmarks, idx.jawRight);
  const jawLeft = at(landmarks, idx.jawLeft);
  const chinRight = at(landmarks, idx.chinRight);
  const chinLeft = at(landmarks, idx.chinLeft);

  // Recovered depth: compare the depth (z) of the nasal bridge with the tip and
  // the rest of the face. MediaPipe z is smaller when a point is closer to the
  // camera, so a projecting nose has a strongly negative tip z. Normalising by
  // the landmark depth spread makes the measure scale-invariant.
  const used = Object.values(idx).map((i) => at(landmarks, i));
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of used) {
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const zSpread = maxZ - minZ;
  const noseProjectionDepth =
    zSpread > 1e-6
      ? (at(landmarks, idx.noseBridge).z - at(landmarks, idx.noseTip).z) / zSpread
      : TYPICAL_PROFILE.noseProjectionDepth;

  return {
    faceWidthOverHeight: faceWidth / faceHeight,
    eyeLineOverHeight: (eyeLineY - foreheadTop.y) / faceHeight,
    interocularOverWidth: dist(irisRight, irisLeft) / faceWidth,
    eyeWidthOverWidth: eyeWidth / faceWidth,
    noseWidthOverWidth: dist(alarRight, alarLeft) / faceWidth,
    noseLengthOverHeight: vertical(subnasale, noseBridge) / faceHeight,
    mouthWidthOverWidth: dist(mouthRight, mouthLeft) / faceWidth,
    lipHeightOverHeight: vertical(lowerLipBottom, upperLipTop) / faceHeight,
    jawWidthOverWidth: dist(jawRight, jawLeft) / faceWidth,
    chinWidthOverWidth: dist(chinRight, chinLeft) / faceWidth,
    chinHeightOverHeight: vertical(chinBottom, lowerLipBottom) / faceHeight,
    browHeightOverHeight: (eyeLineY - browLineY) / faceHeight,
    noseProjectionDepth,
  };
}

/** Map a ratio deviation from typical onto a bounded morph coefficient. */
function deviation(value: number, typical: number, scale: number): number {
  return (value - typical) / scale;
}

/** Convert a measured profile into bounded identity coefficients. */
export function profileToMorph(profile: FaceProfile): FaceMorph {
  return {
    ...NEUTRAL_FACE_MORPH,
    // Wider face aspect widens; the eye-line position drives lower-face length.
    faceWidth: clampMorph(
      deviation(profile.faceWidthOverHeight, TYPICAL_PROFILE.faceWidthOverHeight, 0.1),
    ),
    faceLength: clampMorph(
      -deviation(profile.faceWidthOverHeight, TYPICAL_PROFILE.faceWidthOverHeight, 0.16),
    ),
    foreheadHeight: clampMorph(
      (TYPICAL_PROFILE.eyeLineOverHeight - profile.eyeLineOverHeight) / 0.06,
    ),
    jawWidth: clampMorph(
      (profile.jawWidthOverWidth - TYPICAL_PROFILE.jawWidthOverWidth) / 0.06,
    ),
    chinWidth: clampMorph(
      (profile.chinWidthOverWidth - TYPICAL_PROFILE.chinWidthOverWidth) / 0.07,
    ),
    chinLength: clampMorph(
      (profile.chinHeightOverHeight - TYPICAL_PROFILE.chinHeightOverHeight) / 0.045,
    ),
    cheekFullness: clampMorph(
      (profile.faceWidthOverHeight - TYPICAL_PROFILE.faceWidthOverHeight) / 0.12,
    ),
    eyeSpacing: clampMorph(
      (profile.interocularOverWidth - TYPICAL_PROFILE.interocularOverWidth) / 0.05,
    ),
    eyeSize: clampMorph(
      (profile.eyeWidthOverWidth - TYPICAL_PROFILE.eyeWidthOverWidth) / 0.035,
    ),
    eyeHeight: 0,
    browHeight: clampMorph(
      (profile.browHeightOverHeight - TYPICAL_PROFILE.browHeightOverHeight) / 0.03,
    ),
    noseWidth: clampMorph(
      (profile.noseWidthOverWidth - TYPICAL_PROFILE.noseWidthOverWidth) / 0.06,
    ),
    noseLength: clampMorph(
      (profile.noseLengthOverHeight - TYPICAL_PROFILE.noseLengthOverHeight) / 0.05,
    ),
    // Nose tip projection comes from the recovered depth (MediaPipe z), not a
    // 2D ratio: a person whose bridge-to-tip depth gap is larger than typical
    // gets a more projected tip. Falls back to neutral when depth is flat.
    noseTip: clampMorph(
      deviation(
        profile.noseProjectionDepth,
        TYPICAL_PROFILE.noseProjectionDepth,
        0.25,
      ),
    ),
    mouthWidth: clampMorph(
      (profile.mouthWidthOverWidth - TYPICAL_PROFILE.mouthWidthOverWidth) / 0.07,
    ),
    lipFullness: clampMorph(
      (profile.lipHeightOverHeight - TYPICAL_PROFILE.lipHeightOverHeight) / 0.03,
    ),
  } satisfies FaceMorph;
}

/**
 * Average skin tone sampled from a small set of skin landmarks on the
 * photograph. Returns a hex string. Falls back to a neutral tone when the
 * image data is unavailable (e.g. headless test environments).
 */
export const DEFAULT_SKIN_TONE = "#e7b89b";

export function sampleSkinTone(
  pixels: Uint8ClampedArray | null,
  width: number,
  height: number,
  landmarks: FaceLandmarkPoint[],
  fallback: string = DEFAULT_SKIN_TONE,
): string {
  if (!pixels || width <= 0 || height <= 0 || !isValidLandmarkSet(landmarks)) {
    return fallback;
  }
  const idx = FACE_LANDMARK_INDEX;
  const sampleIndices = [
    idx.foreheadTop,
    idx.faceRight,
    idx.faceLeft,
    idx.jawRight,
    idx.jawLeft,
    idx.chinBottom,
  ];
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  // Sample a small window around each landmark and keep the median channel,
  // which rejects stray specular highlights and shadows.
  for (const index of sampleIndices) {
    const p = landmarks[index];
    if (!p) continue;
    const cx = Math.round(p.x * width);
    const cy = Math.round(p.y * height);
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const o = (py * width + px) * 4;
        reds.push(pixels[o]);
        greens.push(pixels[o + 1]);
        blues.push(pixels[o + 2]);
      }
    }
  }
  if (reds.length === 0) return fallback;
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const toHex = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${toHex(median(reds))}${toHex(median(greens))}${toHex(median(blues))}`;
}

/** Convenience: neutral morph instance (fresh copy). */
export function neutralMorph(): FaceMorph {
  return { ...NEUTRAL_FACE_MORPH };
}
