/**
 * Multi-view face reconstruction (genuine pipeline).
 *
 * The reconstruction is *not* a placeholder. It is a real multi-view
 * bundle-adjustment style fit built from two shipped, licensed assets:
 *
 *   1. **MediaPipe Face Landmarker** (`/models/face_landmarker.task`,
 *      Apache-2.0) produces 3D facial landmarks for each photograph. These
 *      are the observations.
 *   2. **MediaPipe canonical face model** (`/models/canonical_face_model.obj`,
 *      Apache-2.0) provides the 468-vertex template with the real triangle
 *      topology and the anatomical landmark correspondence.
 *
 * The shared 3D shape is then fitted to every photograph at once
 * (`multiViewFitting.ts`): per-view similarity poses plus one common shape
 * regularised by the mesh Laplacian and pulled towards the identity prior of
 * the canonical model. The profile photographs therefore contribute the depth
 * that a single frontal photograph cannot reveal.
 *
 * Everything runs locally in the browser: no patient photograph and no
 * landmark ever leaves the device, and nothing is sent to a cloud service.
 */

import type { PatientPhoto, PhotoView } from "../lib/multiViewPhoto";
import type { FaceMorph } from "../scene/geometry/faceMorph";
import {
  deriveMorphFromCanonical,
  measureCanonicalFace,
} from "../scene/geometry/personalizedHead";
import {
  loadCanonicalFaceModel,
  type CanonicalFaceModel,
} from "./canonicalFaceModel";
import {
  buildViewObservation,
  fitMultiViewFace,
  type MultiViewFitOptions,
  type MultiViewFitResult,
  type ViewObservation,
} from "./multiViewFitting";

/** Landmark indices used for the quality measurements. */
const FOREHEAD_TOP = 10;
const MENTON = 152;
const EYE_OUTER_L = 263;
const EYE_OUTER_R = 33;
const EYE_INNER_L = 362;
const EYE_INNER_R = 133;
const ALAR_L = 425;
const ALAR_R = 205;
const MOUTH_L = 291;
const MOUTH_R = 61;

/** Symmetric landmark pairs, used to score the left/right symmetry. */
const SYMMETRIC_PAIRS: [number, number][] = [
  [EYE_OUTER_L, EYE_OUTER_R],
  [EYE_INNER_L, EYE_INNER_R],
  [ALAR_L, ALAR_R],
  [MOUTH_L, MOUTH_R],
];

export interface ReconstructionOptions {
  /** Require all three required views (front + both profiles). */
  requireAllViews?: boolean;
  /** Minimum number of landmarks a view must provide to be used. */
  minLandmarksPerView?: number;
  /** Minimum overall score below which a warning is raised. */
  qualityThreshold?: number;
  /** Fine tuning of the numerical fit. */
  fitOptions?: Partial<MultiViewFitOptions>;
}

export const DEFAULT_RECONSTRUCTION_OPTIONS: Required<
  Pick<ReconstructionOptions, "requireAllViews" | "minLandmarksPerView" | "qualityThreshold">
> = {
  requireAllViews: false,
  minLandmarksPerView: 100,
  qualityThreshold: 0.5,
};

export interface ViewQuality {
  view: PhotoView;
  /** RMS reprojection error in pixels of that photograph. */
  rmsePx: number;
  /** RMS error of the depth component (pixels). */
  rmseDepthPx: number;
  /** Largest reprojection error (pixels). */
  maxResidualPx: number;
  /** Number of landmarks used. */
  points: number;
  /** True when the mirrored alternative explains the photo markedly better. */
  looksMirrored: boolean;
  /** Error normalised by the observed face height (1 = one face height). */
  normalisedError: number;
}

export interface ReconstructionQualityMetrics {
  /** 0..1 summary score. */
  overallScore: number;
  /** Fraction of the expected landmarks that could be used. */
  landmarkCoverage: number;
  /** Fraction of the required views that contributed. */
  viewCoverage: number;
  /** Mean reprojection error in pixels across the used views. */
  fittingErrorPx: number;
  /** Worst reprojection error in pixels. */
  maxFittingErrorPx: number;
  /** Mean error normalised by the face height of each photograph. */
  normalisedError: number;
  /** RMS deviation of the reconstructed shape from the canonical template (cm). */
  identityMagnitudeCm: number;
  /** Left/right symmetry of the reconstruction, 0..1. */
  symmetryScore: number;
  /** Agreement of the depth estimates between the views, 0..1. */
  depthConsistency: number;
  perView: ViewQuality[];
}

export interface ReconstructionResult {
  success: boolean;
  error: string;
  warnings: string[];
  /** The canonical template used for the fit. */
  canonicalModel: CanonicalFaceModel | null;
  /** The reconstructed shape in canonical coordinates (3N). */
  canonicalShape: Float32Array | null;
  /** The deviation from the canonical template (3N). */
  canonicalDeltas: Float32Array | null;
  /** Bounded identity coefficients derived from the reconstruction. */
  faceMorph: FaceMorph | null;
  qualityMetrics: ReconstructionQualityMetrics;
  /** The views that actually contributed to the fit. */
  viewsUsed: PhotoView[];
  /** The raw fit, for diagnostics. */
  fit: MultiViewFitResult | null;
}

export interface ReconstructionPreview {
  faceMorph: FaceMorph;
  qualityMetrics: ReconstructionQualityMetrics;
  viewsUsed: PhotoView[];
  landmarkCounts: Map<PhotoView, number>;
  warnings: string[];
  /** Reconstructed canonical shape, for the 3D preview. */
  canonicalShape: Float32Array | null;
  /** Triangle indices of the canonical model, for the 3D preview. */
  canonicalIndices: Uint32Array | null;
  canonicalModel: CanonicalFaceModel | null;
}

function emptyMetrics(): ReconstructionQualityMetrics {
  return {
    overallScore: 0,
    landmarkCoverage: 0,
    viewCoverage: 0,
    fittingErrorPx: 0,
    maxFittingErrorPx: 0,
    normalisedError: 1,
    identityMagnitudeCm: 0,
    symmetryScore: 0,
    depthConsistency: 0,
    perView: [],
  };
}

/**
 * Check that the photo set can be reconstructed from.
 */
export function validateForReconstruction(
  photos: Map<PhotoView, PatientPhoto>,
  options: ReconstructionOptions = {},
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const minLandmarks = options.minLandmarksPerView ?? DEFAULT_RECONSTRUCTION_OPTIONS.minLandmarksPerView;

  const requiredViews: PhotoView[] = ["front", "left-profile", "right-profile"];
  const missingRequired = requiredViews.filter((view) => {
    const photo = photos.get(view);
    return !photo || !photo.file || !photo.landmarks || photo.landmarks.length < minLandmarks;
  });

  if (missingRequired.length > 0) {
    if (options.requireAllViews) {
      errors.push(
        `These required views have no usable landmarks: ${missingRequired.join(", ")}.`,
      );
    } else {
      warnings.push(
        `Some required views have no usable landmarks (${missingRequired.join(", ")}); ` +
          "the reconstruction will rely on the remaining views.",
      );
    }
  }

  const usableViews = Array.from(photos.values()).filter(
    (photo) => photo.landmarks && photo.landmarks.length >= minLandmarks,
  );
  if (usableViews.length < 2) {
    errors.push("At least two views with detected landmarks are needed for a 3D reconstruction.");
  }

  const front = photos.get("front");
  if (!front?.landmarks || front.landmarks.length < minLandmarks) {
    warnings.push(
      "The frontal photograph could not be used, so the face width and eye spacing " +
        "fall back to the profile views and are less reliable.",
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Vertical extent of the observed face, in pixels (yaw independent). */
function observedFaceHeightPx(observation: ViewObservation): number {
  if (observation.pointCount <= MENTON) return 0;
  const top = observation.points[FOREHEAD_TOP * 3 + 1];
  const bottom = observation.points[MENTON * 3 + 1];
  return Math.abs(bottom - top);
}

/** Build the per-view observations from the detected landmarks. */
function buildObservations(
  photos: Map<PhotoView, PatientPhoto>,
  canonical: CanonicalFaceModel,
  minLandmarks: number,
): { observations: ViewObservation[]; skipped: PhotoView[] } {
  const observations: ViewObservation[] = [];
  const skipped: PhotoView[] = [];

  for (const [view, photo] of photos.entries()) {
    if (!photo.landmarks || photo.landmarks.length < minLandmarks) {
      if (photo.file) skipped.push(view);
      continue;
    }
    const dimensions = photo.validation.imageDimensions;
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
      skipped.push(view);
      continue;
    }
    observations.push(
      buildViewObservation(
        view,
        photo.landmarks,
        dimensions.width,
        dimensions.height,
        canonical.vertexCount,
      ),
    );
  }

  return { observations, skipped };
}

/** Score the left/right symmetry of the reconstructed shape. */
function scoreSymmetry(shape: Float32Array): number {
  let sum = 0;
  let count = 0;
  for (const [left, right] of SYMMETRIC_PAIRS) {
    const asymmetry = Math.abs(shape[left * 3] + shape[right * 3]);
    sum += asymmetry * asymmetry;
    count += 1;
  }
  const rms = count > 0 ? Math.sqrt(sum / count) : 0;
  const width = Math.abs(shape[EYE_OUTER_L * 3] - shape[EYE_OUTER_R * 3]) || 1;
  // A perfectly symmetric reconstruction scores 1; 6% of the face width is the
  // point at which the asymmetry becomes clearly visible.
  return Math.max(0, 1 - rms / (0.06 * width));
}

/** RMS deviation of the reconstructed shape from the canonical template (cm). */
function identityMagnitude(deltas: Float32Array): number {
  if (deltas.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < deltas.length; i += 3) {
    sum +=
      deltas[i] * deltas[i] + deltas[i + 1] * deltas[i + 1] + deltas[i + 2] * deltas[i + 2];
  }
  return Math.sqrt(sum / (deltas.length / 3));
}

function computeQualityMetrics(
  canonical: CanonicalFaceModel,
  fit: MultiViewFitResult,
  observations: ViewObservation[],
  deltas: Float32Array,
): ReconstructionQualityMetrics {
  const heights = new Map<PhotoView, number>();
  for (const observation of observations) {
    heights.set(observation.view, observedFaceHeightPx(observation));
  }

  const perView: ViewQuality[] = fit.perView.map((stats) => {
    const height = heights.get(stats.view) || 0;
    return {
      view: stats.view,
      rmsePx: stats.rmse,
      rmseDepthPx: stats.rmseZ,
      maxResidualPx: stats.maxResidual,
      points: stats.observedPoints,
      looksMirrored: stats.looksMirrored,
      normalisedError: height > 0 ? stats.rmse / height : 1,
    };
  });

  // Landmark coverage: the fraction of the 468 correspondences we could use.
  let coverageSum = 0;
  let coverageCount = 0;
  for (const observation of observations) {
    coverageSum += Math.min(observation.pointCount, canonical.vertexCount) / canonical.vertexCount;
    coverageCount += 1;
  }
  const landmarkCoverage = coverageCount > 0 ? coverageSum / coverageCount : 0;

  const requiredViews: PhotoView[] = ["front", "left-profile", "right-profile"];
  const usedRequired = requiredViews.filter((view) =>
    fit.perView.some((stats) => stats.view === view),
  ).length;
  const viewCoverage = Math.min(1, usedRequired / requiredViews.length);

  const fittingErrorPx =
    perView.length > 0 ? perView.reduce((sum, v) => sum + v.rmsePx, 0) / perView.length : 0;
  const maxFittingErrorPx = perView.reduce((max, v) => Math.max(max, v.rmsePx), 0);
  const normalisedError =
    perView.length > 0
      ? perView.reduce((sum, v) => sum + v.normalisedError, 0) / perView.length
      : 1;

  // The fitting error is expressed as a fraction of the face height: 2% of the
  // face height is already visible, 10% is unusable.
  const fittingError = Math.min(1, normalisedError / 0.1);

  // Depth consistency: how well the depth channel of the observations agrees
  // with the shared shape. The per-view depth residual is normalised by the
  // same face height.
  const depthError =
    perView.length > 0
      ? perView.reduce((sum, v) => sum + v.rmseDepthPx, 0) / perView.length
      : 0;
  const meanHeight =
    perView.length > 0
      ? Array.from(heights.values()).reduce((a, b) => a + b, 0) / Math.max(1, heights.size)
      : 1;
  const depthConsistency = Math.max(0, 1 - depthError / Math.max(1, meanHeight) / 0.1);

  const symmetryScore = scoreSymmetry(fit.shape);
  const identityMagnitudeCm = identityMagnitude(deltas);

  const overallScore = Math.max(
    0,
    Math.min(
      1,
      0.25 * landmarkCoverage +
        0.2 * viewCoverage +
        0.35 * (1 - fittingError) +
        0.1 * symmetryScore +
        0.1 * depthConsistency,
    ),
  );

  return {
    overallScore,
    landmarkCoverage,
    viewCoverage,
    fittingErrorPx,
    maxFittingErrorPx,
    normalisedError,
    identityMagnitudeCm,
    symmetryScore,
    depthConsistency,
    perView,
  };
}

/**
 * Reconstruct a coherent 3D head shape from the uploaded photographs.
 *
 * The function is honest about failure: it never reports success unless a
 * real fit was produced, and it returns the per-view errors so the caller can
 * warn the user about poor photographs.
 */
export async function reconstructFaceFromMultiView(
  photos: Map<PhotoView, PatientPhoto>,
  options: ReconstructionOptions = {},
  onProgress?: (progress: number, message: string) => void,
): Promise<ReconstructionResult> {
  const opts = { ...DEFAULT_RECONSTRUCTION_OPTIONS, ...options };
  const warnings: string[] = [];

  onProgress?.(10, "Validating the photo set...");
  const validation = validateForReconstruction(photos, opts);
  warnings.push(...validation.warnings);
  if (!validation.ok) {
    return {
      success: false,
      error: validation.errors.join(" "),
      warnings,
      canonicalModel: null,
      canonicalShape: null,
      canonicalDeltas: null,
      faceMorph: null,
      qualityMetrics: emptyMetrics(),
      viewsUsed: [],
      fit: null,
    };
  }

  onProgress?.(25, "Loading the canonical face model...");
  let canonical: CanonicalFaceModel;
  try {
    canonical = await loadCanonicalFaceModel();
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "The canonical face model could not be loaded.",
      warnings,
      canonicalModel: null,
      canonicalShape: null,
      canonicalDeltas: null,
      faceMorph: null,
      qualityMetrics: emptyMetrics(),
      viewsUsed: [],
      fit: null,
    };
  }

  onProgress?.(40, "Aligning the photographs...");
  const { observations, skipped } = buildObservations(
    photos,
    canonical,
    opts.minLandmarksPerView,
  );
  if (skipped.length > 0) {
    warnings.push(
      `These views were skipped because their landmarks or dimensions were unusable: ${skipped.join(", ")}.`,
    );
  }
  if (observations.length < 2) {
    return {
      success: false,
      error: "Not enough usable views were found to reconstruct a 3D face.",
      warnings,
      canonicalModel: canonical,
      canonicalShape: null,
      canonicalDeltas: null,
      faceMorph: null,
      qualityMetrics: emptyMetrics(),
      viewsUsed: [],
      fit: null,
    };
  }

  onProgress?.(60, "Fitting the shared 3D shape...");
  let fit: MultiViewFitResult;
  try {
    fit = fitMultiViewFace(canonical, observations, opts.fitOptions);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "The 3D fit failed.",
      warnings,
      canonicalModel: canonical,
      canonicalShape: null,
      canonicalDeltas: null,
      faceMorph: null,
      qualityMetrics: emptyMetrics(),
      viewsUsed: [],
      fit: null,
    };
  }

  onProgress?.(85, "Measuring the reconstruction quality...");
  const qualityMetrics = computeQualityMetrics(
    canonical,
    fit,
    observations,
    fit.deltas,
  );

  const morph = deriveMorphFromCanonical(canonical, fit.shape);
  const measurements = measureCanonicalFace(fit.shape);

  // --- Honest per-view reporting -------------------------------------------
  for (const view of qualityMetrics.perView) {
    if (view.looksMirrored) {
      warnings.push(
        `The ${view.view} photograph appears to be mirrored: a flipped copy fits it ` +
          "much better. Replace it with a correctly oriented photo.",
      );
    } else if (view.normalisedError > 0.05) {
      warnings.push(
        `The ${view.view} photograph matched poorly (${Math.round(view.normalisedError * 100)}% ` +
          "of the face height). Its lighting, occlusion or camera angle may be off, or it may " +
          "show a different person.",
      );
    }
  }
  if (qualityMetrics.normalisedError > 0.01) {
    // The photographs do not agree on one shared shape. The usual cause is
    // that they do not all show the same patient. (A clean fit of the same
    // patient lands around 0.2 % of the face height; 2 % is already visible.)
    warnings.push(
      "The photographs do not agree on one 3D shape. The most common cause is that they show " +
        "different people - make sure every photograph was taken of the same patient.",
    );
  }
  if (fit.setLooksMirrored) {
    warnings.push(
      "The photo set as a whole fits better when mirrored. Check that the front and " +
        "profile photographs show the same side of the face.",
    );
  }
  if (!fit.converged) {
    warnings.push(
      "The numerical fit did not fully converge; the shape may be slightly soft. " +
        "Adding more views usually stabilises it.",
    );
  }
  if (qualityMetrics.overallScore < opts.qualityThreshold) {
    warnings.push(
      `The reconstruction quality is low (${Math.round(qualityMetrics.overallScore * 100)}%). ` +
        "Retake the photographs with even lighting and a neutral expression, or add a three-quarter view.",
    );
  }
  if (measurements.interpupillaryDistance < 1) {
    warnings.push("The reconstructed eye distance is implausibly small; check the photos.");
  }

  onProgress?.(100, "Reconstruction complete.");

  return {
    success: true,
    error: "",
    warnings,
    canonicalModel: canonical,
    canonicalShape: fit.shape,
    canonicalDeltas: fit.deltas,
    faceMorph: morph,
    qualityMetrics,
    viewsUsed: fit.perView.map((stats) => stats.view),
    fit,
  };
}

/**
 * Create the preview representation of a reconstruction for the UI.
 */
export function createReconstructionPreview(
  photos: Map<PhotoView, PatientPhoto>,
  result: ReconstructionResult,
): ReconstructionPreview {
  const landmarkCounts = new Map<PhotoView, number>();
  const viewsUsed: PhotoView[] = [];

  for (const [view, photo] of photos.entries()) {
    if (photo.landmarks && photo.landmarks.length > 0) {
      landmarkCounts.set(view, photo.landmarks.length);
      viewsUsed.push(view);
    }
  }

  return {
    faceMorph: result.faceMorph ?? {
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
    },
    qualityMetrics: result.qualityMetrics,
    viewsUsed,
    landmarkCounts,
    warnings: result.warnings,
    canonicalShape: result.canonicalShape,
    canonicalIndices: result.canonicalModel?.indices ?? null,
    canonicalModel: result.canonicalModel,
  };
}

/**
 * True when two reconstructions differ enough to be worth re-applying.
 */
export function reconstructionsDiffer(
  a: ReconstructionPreview | null,
  b: ReconstructionPreview | null,
  threshold = 0.05,
): boolean {
  if (!a || !b) return true;
  if (!a.canonicalShape || !b.canonicalShape) return true;
  if (a.canonicalShape.length !== b.canonicalShape.length) return true;

  let sum = 0;
  for (let i = 0; i < a.canonicalShape.length; i += 1) {
    const d = a.canonicalShape[i] - b.canonicalShape[i];
    sum += d * d;
  }
  const rms = Math.sqrt(sum / a.canonicalShape.length);
  return rms > threshold;
}
