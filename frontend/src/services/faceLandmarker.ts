import type { FaceLandmarkPoint } from "./faceReconstruction";
import { FaceReconstructionError } from "./faceReconstruction";
import {
  prepareDetectionCanvas,
  type AutoLevels,
  computeAutoLevels,
  DETECTION_MIN_SIZE,
  DETECTION_MAX_UPSCALE,
} from "./detectionPreprocess";

export { prepareDetectionCanvas, computeAutoLevels, DETECTION_MIN_SIZE, DETECTION_MAX_UPSCALE };
export type { AutoLevels };

/**
 * Local facial-landmark detection (Phase 9).
 *
 * Uses MediaPipe Tasks Vision (`@mediapipe/tasks-vision`, Apache-2.0) running
 * the bundled Face Landmarker model. Everything is served from this origin:
 *   - the model at `/models/face_landmarker.task`
 *   - the WASM runtime at `/mediapipe/*`
 * No image leaves the browser and no remote asset URL is fetched at runtime.
 *
 * The module is imported dynamically so the heavy WASM bundle is only pulled in
 * when a photo is actually personalized, and so headless/test environments can
 * mock it without loading WASM.
 */

export const FACE_LANDMARKER_MODEL_PATH = "/models/face_landmarker.task";
export const FACE_LANDMARKER_WASM_PATH = "/mediapipe";

/** Number of landmarks Face Mesh returns (468 + 10 iris = 478). */
export const FACE_LANDMARK_COUNT = 478;

type AnyLandmarker = {
  detect: (image: HTMLImageElement | HTMLCanvasElement | ImageBitmap) => {
    faceLandmarks?: { x: number; y: number; z: number }[][];
  };
};

let landmarkerPromise: Promise<AnyLandmarker> | null = null;

async function createLandmarker(): Promise<AnyLandmarker> {
  if (typeof window === "undefined") {
    throw new FaceReconstructionError(
      "Facial reconstruction requires a browser environment.",
    );
  }
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(
    FACE_LANDMARKER_WASM_PATH,
  );
  const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: FACE_LANDMARKER_MODEL_PATH,
      delegate: "CPU",
    },
    runningMode: "IMAGE",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  return landmarker as unknown as AnyLandmarker;
}

/** Lazily create (and cache) the landmarker. */
export function getFaceLandmarker(): Promise<AnyLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker().catch((error) => {
      landmarkerPromise = null;
      if (error instanceof FaceReconstructionError) throw error;
      throw new FaceReconstructionError(
        "The facial landmark model could not be loaded. Ensure " +
          `${FACE_LANDMARKER_MODEL_PATH} and ${FACE_LANDMARKER_WASM_PATH} ` +
          "are available.",
      );
    });
  }
  return landmarkerPromise;
}

/**
 * Retry settings applied only when the original photograph yields no face.
 * The order is cheapest-first; each retry normalises exposure and (for small
 * images) upscales, which is what recovers dark 300–500 px photographs.
 */
const DETECTION_RETRIES: { contrast: number }[] = [
  { contrast: 1 },
  { contrast: 1.6 },
  { contrast: 2.2 },
];

function runDetection(
  landmarker: AnyLandmarker,
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): FaceLandmarkPoint[] | null {
  let result;
  try {
    result = landmarker.detect(image);
  } catch {
    throw new FaceReconstructionError(
      "Facial landmark detection failed. Try a clearer, well-lit frontal photo.",
    );
  }
  const faces = result?.faceLandmarks;
  if (!faces || faces.length === 0) return null;
  return faces[0].map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
}

/**
 * Detect facial landmarks on a (fully loaded) image element.
 *
 * Tries the photo as-is first, then retries on exposure-normalised, upscaled
 * copies. Returns `null` when no face is found in any attempt; throws
 * `FaceReconstructionError` when the model itself fails.
 */
export async function detectFaceLandmarks(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): Promise<FaceLandmarkPoint[] | null> {
  const landmarker = await getFaceLandmarker();

  const direct = runDetection(landmarker, image);
  if (direct) return direct;

  for (const retry of DETECTION_RETRIES) {
    const canvas = prepareDetectionCanvas(image, { contrast: retry.contrast });
    if (!canvas) continue;
    try {
      const found = runDetection(landmarker, canvas);
      if (found) return found;
    } catch {
      // A failed retry must not mask the original "no face" result.
    }
  }

  return null;
}

/** Test hook: forget the cached landmarker. */
export function resetFaceLandmarker(): void {
  landmarkerPromise = null;
}
