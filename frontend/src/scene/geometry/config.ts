import { HEAD_SHAPE } from "./headShape";

/**
 * Single geometry scale configuration (Phase 4).
 *
 * Every length-like parameter is converted to scene units through exactly one
 * pathway: `mmToScene`. There is no other scaling factor for translations
 * anywhere in the viewer or deformation engine. Angular parameters are handled
 * separately by `degreesToRadians` and are never multiplied by a length scale.
 *
 * Honest calibration note: the generated head has no verified physical
 * dimensions. We therefore assume one illustrative reference — the facial
 * width (2 * rx) represents an adult facial width of 150 mm — and label the
 * result an illustrative reference scale. It is a visualisation aid, not a
 * validated clinical calibration.
 */
export const GEOMETRY_SCALE = {
  /** Scene units covering one assumed millimetre. */
  sceneUnitsPerMm: (2 * HEAD_SHAPE.rx) / 150,
  /** Assumed reference facial width in millimetres. */
  referenceFaceWidthMm: 150,
  /** The same reference expressed in scene units (2 * rx). */
  referenceFaceWidthSceneUnits: 2 * HEAD_SHAPE.rx,
  /** Degrees -> radians factor (angular, scale-independent). */
  degreesToRadians: Math.PI / 180,
} as const;

/** Convert a length in millimetres to scene units. The only length pathway. */
export function mmToScene(mm: number): number {
  return mm * GEOMETRY_SCALE.sceneUnitsPerMm;
}

/** Convert an angle in degrees to radians. Never scaled as a length. */
export function degreesToRadians(degrees: number): number {
  return degrees * GEOMETRY_SCALE.degreesToRadians;
}

/** Guard against non-finite parameter values reaching the geometry engine. */
export function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
