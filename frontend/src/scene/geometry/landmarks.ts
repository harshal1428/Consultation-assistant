import { surfacePoint } from "./headShape";
import type { FaceMorph } from "./faceMorph";
import { DEFAULT_REGION_FRAME, type FaceRegionFrame } from "./regions";

/**
 * Landmark definitions (Phase 4; extended in Phase 7).
 *
 * Landmarks are authored as facial coordinates on the documented sagittal /
 * transverse system and resolved to the *actual* mesh vertices, so they move
 * with the deformed geometry rather than sitting at hard-coded offsets. The
 * original seven nasal landmarks are preserved; the added lip / chin / cheek /
 * jawline landmarks are resolved exactly the same way, so they follow their
 * region's deformation.
 */
export interface LandmarkDef {
  id: string;
  label: string;
  /** Facial coordinate in scene units (see headShape.ts coordinate system). */
  x: number;
  y: number;
}

export const LANDMARKS: LandmarkDef[] = [
  // Nasal (unchanged from Phase 4).
  { id: "nasion", label: "Nasion", x: 0, y: 0.34 },
  { id: "rhinion", label: "Rhinion", x: 0, y: 0.17 },
  { id: "pronasale", label: "Pronasale (tip)", x: 0, y: -0.16 },
  { id: "subnasale", label: "Subnasale", x: 0, y: -0.3 },
  { id: "alare_l", label: "Alare (L)", x: 0.15, y: -0.19 },
  { id: "alare_r", label: "Alare (R)", x: -0.15, y: -0.19 },
  { id: "pogonion", label: "Pogonion (chin)", x: 0, y: -0.56 },
  // Lips / chin / cheeks / jawline (Phase 7).
  { id: "upper_lip", label: "Upper lip", x: 0, y: -0.36 },
  { id: "lower_lip", label: "Lower lip", x: 0, y: -0.44 },
  { id: "menton", label: "Menton (chin base)", x: 0, y: -0.6 },
  { id: "cheek_l", label: "Cheek (L)", x: 0.4, y: -0.05 },
  { id: "cheek_r", label: "Cheek (R)", x: -0.4, y: -0.05 },
  { id: "jaw_l", label: "Jawline (L)", x: 0.42, y: -0.5 },
  { id: "jaw_r", label: "Jawline (R)", x: -0.42, y: -0.5 },
];

export type LandmarkPositions = Record<string, [number, number, number]>;

/**
 * Analytic baseline position of each landmark on the head surface.
 *
 * A head that is not described by the procedural surface (the realistic model)
 * supplies explicit 3D targets in its region frame. Those are used verbatim;
 * the sculpted head keeps the original `surfacePoint` placement.
 */
export function landmarkBasePoints(
  morph?: FaceMorph,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): LandmarkPositions {
  const result: LandmarkPositions = {};
  for (const lm of LANDMARKS) {
    const explicit = frame.landmarkPositions?.[lm.id];
    result[lm.id] = explicit ? [...explicit] : surfacePoint(lm.x, lm.y, morph);
  }
  return result;
}

/** Index of the baseline vertex closest to a target point. */
export function nearestVertexIndex(
  base: Float32Array,
  target: [number, number, number],
): number {
  const count = Math.floor(base.length / 3);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const dx = base[o] - target[0];
    const dy = base[o + 1] - target[1];
    const dz = base[o + 2] - target[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Resolve each landmark to a stable baseline vertex index. */
export function landmarkVertexIndices(
  base: Float32Array,
  morph?: FaceMorph,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): Record<string, number> {
  const basePoints = landmarkBasePoints(morph, frame);
  const indices: Record<string, number> = {};
  for (const lm of LANDMARKS) {
    indices[lm.id] = nearestVertexIndex(base, basePoints[lm.id]);
  }
  return indices;
}

/** Read landmark positions out of the current deformed positions. */
export function resolveLandmarks(
  indices: Record<string, number>,
  positions: Float32Array,
): LandmarkPositions {
  const result: LandmarkPositions = {};
  for (const id of Object.keys(indices)) {
    const o = indices[id] * 3;
    result[id] = [positions[o], positions[o + 1], positions[o + 2]];
  }
  return result;
}
