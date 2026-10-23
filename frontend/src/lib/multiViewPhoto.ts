/**
 * Multi-view patient photo management (Phase 10).
 *
 * Handles upload, validation, and storage of multiple patient photographs
 * for 3D face reconstruction. Photos are kept in memory only (object URLs)
 * and never uploaded to any server. They are hidden from the main workspace
 * and only accessible via the dedicated "View / Change Photos" interface.
 */

export type PhotoView =
  | "front"
  | "left-profile"
  | "right-profile"
  | "left-three-quarter"
  | "right-three-quarter"
  | "additional";

export const REQUIRED_VIEWS: PhotoView[] = [
  "front",
  "left-profile",
  "right-profile",
];

export const OPTIONAL_VIEWS: PhotoView[] = [
  "left-three-quarter",
  "right-three-quarter",
  "additional",
];

export const ALL_VIEWS: PhotoView[] = [...REQUIRED_VIEWS, ...OPTIONAL_VIEWS];

export const VIEW_LABELS: Record<PhotoView, string> = {
  front: "Front view",
  "left-profile": "Left profile",
  "right-profile": "Right profile",
  "left-three-quarter": "Left ¾ view",
  "right-three-quarter": "Right ¾ view",
  additional: "Additional photo",
};

export const VIEW_DESCRIPTIONS: Record<PhotoView, string> = {
  front: "Full front-facing photo, neutral expression, even lighting",
  "left-profile": "Left side profile (90°), ear visible, neutral expression",
  "right-profile": "Right side profile (90°), ear visible, neutral expression",
  "left-three-quarter": "Left 45° angle, shows cheek and nose side",
  "right-three-quarter": "Right 45° angle, shows cheek and nose side",
  additional: "Any extra view that may improve reconstruction",
};

export const VIEW_ICONS: Record<PhotoView, string> = {
  front: "image",
  "left-profile": "undo",
  "right-profile": "arrowRight",
  "left-three-quarter": "undo",
  "right-three-quarter": "resetView",
  additional: "upload",
};

export interface PatientPhoto {
  view: PhotoView;
  file: File;
  previewUrl: string;
  landmarks: FaceLandmarkPoint[] | null;
  validation: PhotoValidation;
  landmarkDetectionStatus: "pending" | "running" | "complete" | "error";
  landmarkError: string;
}

export interface FaceLandmarkPoint {
  x: number;
  y: number;
  z: number;
}

export interface PhotoValidation {
  ok: boolean;
  error: string;
  warnings: string[];
  faceDetected: boolean;
  imageDimensions: { width: number; height: number } | null;
}

export interface MultiViewValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  viewsWithFaces: PhotoView[];
  viewsMissing: PhotoView[];
  requiredViewsMissing: PhotoView[];
  inconsistentIdentity: boolean;
}

export const ACCEPTED_PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12 MB
export const MIN_PHOTO_DIMENSION = 256;
export const MAX_PHOTO_DIMENSION = 4096;

export const PHOTO_PRIVACY_NOTE =
  "Your photos are processed entirely on this device and never uploaded. " +
  "They are stored only in memory during this session.";

/**
 * Minimum number of landmarks a view must contribute to be usable for the
 * reconstruction. Matches the reconstruction service's own threshold.
 */
export const MIN_LANDMARKS_PER_VIEW = 100;

/**
 * The bundled MediaPipe face detector only fires on faces that are turned at
 * most roughly 50 degrees away from the camera. A true 90 degree profile is
 * therefore often reported as "no face detected" even when the photo is
 * perfectly usable for the reconstruction. The UI has to say so, and the
 * reconstruction must be able to continue with the views that *were* detected.
 */
export const FACE_DETECTOR_POSE_NOTE =
  "No face was detected. The bundled face detector only recognises faces that " +
  "are turned at most about 50° towards the camera, so a true side profile is " +
  "often not detected. Take the photo at 45° (left/right ¾ view) instead, or " +
  "use a more frontal angle.";

/** Views that contribute usable landmarks to the reconstruction. */
export function countUsableViews(photos: Map<PhotoView, PatientPhoto>): number {
  let count = 0;
  for (const photo of photos.values()) {
    if (photo.validation.ok && photo.landmarks && photo.landmarks.length >= MIN_LANDMARKS_PER_VIEW) {
      count += 1;
    }
  }
  return count;
}

/** Required views that are still missing usable landmarks. */
export function getMissingRequiredViews(photos: Map<PhotoView, PatientPhoto>): PhotoView[] {
  return REQUIRED_VIEWS.filter((view) => {
    const photo = photos.get(view);
    return !photo || !photo.validation.ok || !photo.landmarks || photo.landmarks.length < MIN_LANDMARKS_PER_VIEW;
  });
}

export function validatePhotoFile(file: File): PhotoValidation {
  const warnings: string[] = [];

  if (!file || typeof file.type !== "string") {
    return {
      ok: false,
      error: "That file could not be read.",
      warnings: [],
      faceDetected: false,
      imageDimensions: null,
    };
  }

  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
    return {
      ok: false,
      error: "Unsupported file type. Use a PNG, JPEG, or WebP photo.",
      warnings: [],
      faceDetected: false,
      imageDimensions: null,
    };
  }

  if (typeof file.size === "number" && file.size > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      error: "That photo is too large. Use an image under 12 MB.",
      warnings: [],
      faceDetected: false,
      imageDimensions: null,
    };
  }

  return { ok: true, error: "", warnings, faceDetected: false, imageDimensions: null };
}

export async function validatePhotoDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image dimensions."));
    };
    img.src = url;
  });
}

export async function validatePhotoWithFaceDetection(
  file: File,
  detectFn: (image: HTMLImageElement) => Promise<FaceLandmarkPoint[] | null>,
): Promise<PhotoValidation> {
  const baseValidation = validatePhotoFile(file);
  if (!baseValidation.ok) return baseValidation;

  try {
    const dimensions = await validatePhotoDimensions(file);
    const warnings: string[] = [];

    if (dimensions.width < MIN_PHOTO_DIMENSION || dimensions.height < MIN_PHOTO_DIMENSION) {
      warnings.push(
        `Image is quite small (${dimensions.width}×${dimensions.height}). ` +
          `Minimum recommended is ${MIN_PHOTO_DIMENSION}×${MIN_PHOTO_DIMENSION}.`,
      );
    }
    if (dimensions.width > MAX_PHOTO_DIMENSION || dimensions.height > MAX_PHOTO_DIMENSION) {
      warnings.push(
        `Image is very large (${dimensions.width}×${dimensions.height}). ` +
          `It will be downscaled for processing.`,
      );
    }

    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    URL.revokeObjectURL(url);

    const landmarks = await detectFn(img);
    const faceDetected = landmarks !== null && landmarks.length > 0;

    if (!faceDetected) {
      warnings.push("No face detected in this photo. Reconstruction quality may be reduced.");
    }

    return {
      ok: true,
      error: "",
      warnings,
      faceDetected,
      imageDimensions: dimensions,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to validate photo.",
      warnings: [],
      faceDetected: false,
      imageDimensions: null,
    };
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The photo could not be decoded."));
    img.src = url;
  });
}

export function validateMultiViewSet(photos: Map<PhotoView, PatientPhoto>): MultiViewValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const viewsWithFaces: PhotoView[] = [];
  const viewsMissing: PhotoView[] = [];

  for (const view of ALL_VIEWS) {
    const photo = photos.get(view);
    if (!photo) {
      viewsMissing.push(view);
      if (REQUIRED_VIEWS.includes(view)) {
        errors.push(`Required view missing: ${VIEW_LABELS[view]}`);
      }
      continue;
    }
    if (photo.validation.faceDetected) {
      viewsWithFaces.push(view);
    }
    if (!photo.validation.ok) {
      errors.push(`${VIEW_LABELS[view]}: ${photo.validation.error}`);
    }
    warnings.push(...photo.validation.warnings.map((w) => `${VIEW_LABELS[view]}: ${w}`));
  }

  const requiredViewsMissing = REQUIRED_VIEWS.filter((v) => viewsMissing.includes(v));

  // Check for identity consistency (simplified: require at least front + one profile with faces)
  let inconsistentIdentity = false;
  if (viewsWithFaces.includes("front")) {
    const hasProfile = viewsWithFaces.includes("left-profile") || viewsWithFaces.includes("right-profile");
    if (!hasProfile) {
      warnings.push("Only front view has a detected face. Add at least one profile for better reconstruction.");
    }
  } else if (viewsWithFaces.length > 0) {
    warnings.push("Front view face not detected. Reconstruction will rely on profile views only.");
  }

  // Could add more sophisticated identity check here (e.g., compare landmark configurations)
  // For now, we just warn if required views are missing faces

  return {
    ok: errors.length === 0 && requiredViewsMissing.length === 0,
    errors,
    warnings,
    viewsWithFaces,
    viewsMissing,
    requiredViewsMissing,
    inconsistentIdentity,
  };
}

export function createEmptyPatientPhoto(view: PhotoView): PatientPhoto {
  return {
    view,
    file: null as any,
    previewUrl: "",
    landmarks: null,
    validation: { ok: false, error: "No photo uploaded", warnings: [], faceDetected: false, imageDimensions: null },
    landmarkDetectionStatus: "pending",
    landmarkError: "",
  };
}

export function getPhotoForView(photos: Map<PhotoView, PatientPhoto>, view: PhotoView): PatientPhoto | undefined {
  return photos.get(view);
}

export function hasRequiredPhotos(photos: Map<PhotoView, PatientPhoto>): boolean {
  return REQUIRED_VIEWS.every((view) => {
    const photo = photos.get(view);
    return photo && photo.validation.ok && photo.landmarks !== null;
  });
}

export function getUploadedViewCount(photos: Map<PhotoView, PatientPhoto>): number {
  let count = 0;
  for (const photo of photos.values()) {
    if (photo.file) count++;
  }
  return count;
}