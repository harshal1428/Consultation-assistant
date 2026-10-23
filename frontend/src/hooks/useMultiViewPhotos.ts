import { useCallback, useEffect, useRef, useState } from "react";
import {
  type PatientPhoto,
  type PhotoView,
  type MultiViewValidationResult,
  type FaceLandmarkPoint,
  REQUIRED_VIEWS,
  OPTIONAL_VIEWS,
  ALL_VIEWS,
  VIEW_LABELS,
  validatePhotoFile,
  validatePhotoWithFaceDetection,
  validateMultiViewSet,
  createEmptyPatientPhoto,
  getPhotoForView,
  hasRequiredPhotos,
  getUploadedViewCount,
  countUsableViews,
  getMissingRequiredViews,
  FACE_DETECTOR_POSE_NOTE,
} from "../lib/multiViewPhoto";
import { detectFaceLandmarks } from "../services/faceLandmarker";
import { FaceReconstructionError } from "../services/faceReconstruction";

export type MultiViewPhotoStatus = "idle" | "processing" | "ready" | "error";

export interface MultiViewPhotoState {
  photos: Map<PhotoView, PatientPhoto>;
  status: MultiViewPhotoStatus;
  error: string;
  validationResult: MultiViewValidationResult | null;
  isReconstructing: boolean;
  reconstructionProgress: number;
  reconstructionError: string;
  /**
   * Incremented every time the photo collection changes (upload, replace,
   * remove, retry). Consumers use it to detect that a previous reconstruction
   * is stale and that in-flight async work must be discarded.
   */
  version: number;
}

/**
 * The controller returned by `useMultiViewPhotos`.
 *
 * A single instance is owned by `App` and handed down to the photo manager and
 * the reconstruction panel, so both always operate on the same collection
 * (and therefore on the same landmark detections).
 */
export type MultiViewPhotoController = ReturnType<typeof useMultiViewPhotos>;

/**
 * Multi-view photo management hook.
 *
 * Handles upload, validation, and landmark detection for multiple patient
 * photographs. Provides a version token to invalidate stale async work
 * (similar to useFacePersonalization). Photos are kept in memory only.
 */
export function useMultiViewPhotos() {
  const [state, setState] = useState<MultiViewPhotoState>({
    photos: new Map<PhotoView, PatientPhoto>(
      ALL_VIEWS.map((view) => [view, createEmptyPatientPhoto(view)]),
    ),
    status: "idle",
    error: "",
    validationResult: null,
    isReconstructing: false,
    reconstructionProgress: 0,
    reconstructionError: "",
    version: 0,
  });

  const versionRef = useRef(0);
  const urlRefs = useRef<Map<PhotoView, string>>(new Map());
  const fileRefs = useRef<Map<PhotoView, File>>(new Map());

  const revokeUrl = useCallback((view: PhotoView) => {
    const url = urlRefs.current.get(view);
    if (url) {
      URL.revokeObjectURL(url);
      urlRefs.current.delete(view);
    }
  }, []);

  const revokeAllUrls = useCallback(() => {
    for (const url of urlRefs.current.values()) {
      URL.revokeObjectURL(url);
    }
    urlRefs.current.clear();
  }, []);

  const validateAndDetectLandmarks = useCallback(
    async (view: PhotoView, file: File, version: number) => {
      const isStale = () => version !== versionRef.current;

      // Initial validation
      const baseValidation = validatePhotoFile(file);
      setState((prev) => {
        const newPhotos = new Map(prev.photos);
        const photo = newPhotos.get(view)!;
        newPhotos.set(view, { ...photo, validation: baseValidation });
        return { ...prev, photos: newPhotos, status: "processing", error: "" };
      });

      if (!baseValidation.ok || isStale()) return;

      try {
        // Validate dimensions and detect face
        const validation = await validatePhotoWithFaceDetection(file, async (img) => {
          if (isStale()) return null;
          return detectFaceLandmarks(img);
        });

        if (isStale()) return;

        let landmarks: FaceLandmarkPoint[] | null = null;
        if (validation.faceDetected) {
          setState((prev) => {
            const newPhotos = new Map(prev.photos);
            const photo = newPhotos.get(view)!;
            newPhotos.set(view, { ...photo, landmarkDetectionStatus: "running" });
            return { ...prev, photos: newPhotos };
          });

          const img = await loadImage(urlRefs.current.get(view)!);
          landmarks = await detectFaceLandmarks(img);

          if (isStale()) return;
        }

        setState((prev) => {
          const newPhotos = new Map(prev.photos);
          const photo = newPhotos.get(view)!;
          newPhotos.set(view, {
            ...photo,
            validation,
            landmarks,
            landmarkDetectionStatus: landmarks ? "complete" : "error",
            landmarkError: landmarks ? "" : FACE_DETECTOR_POSE_NOTE,
          });
          return { ...prev, photos: newPhotos };
        });
      } catch (err) {
        if (isStale()) return;
        const message = err instanceof FaceReconstructionError
          ? err.message
          : "Landmark detection failed. Try a clearer photo.";
        setState((prev) => {
          const newPhotos = new Map(prev.photos);
          const photo = newPhotos.get(view)!;
          newPhotos.set(view, {
            ...photo,
            landmarkDetectionStatus: "error",
            landmarkError: message,
          });
          return { ...prev, photos: newPhotos };
        });
      }
    },
    [],
  );

  const uploadPhoto = useCallback(
    async (view: PhotoView, file: File) => {
      versionRef.current += 1;
      const version = versionRef.current;

      revokeUrl(view);

      const url = URL.createObjectURL(file);
      urlRefs.current.set(view, url);
      fileRefs.current.set(view, file);

      setState((prev) => {
        const newPhotos = new Map(prev.photos);
        const photo = newPhotos.get(view)!;
        newPhotos.set(view, {
          ...photo,
          file,
          previewUrl: url,
          validation: { ok: true, error: "", warnings: [], faceDetected: false, imageDimensions: null },
          landmarkDetectionStatus: "pending",
          landmarkError: "",
        });
        return { ...prev, photos: newPhotos, status: "processing", error: "", version: prev.version + 1 };
      });

      await validateAndDetectLandmarks(view, file, version);

      // Re-validate full set after each upload
      setState((prev) => ({
        ...prev,
        validationResult: validateMultiViewSet(prev.photos),
        status: "ready",
      }));
    },
    [revokeUrl, validateAndDetectLandmarks],
  );

  const removePhoto = useCallback(
    (view: PhotoView) => {
      versionRef.current += 1;
      revokeUrl(view);
      fileRefs.current.delete(view);

      setState((prev) => {
        const newPhotos = new Map(prev.photos);
        newPhotos.set(view, createEmptyPatientPhoto(view));
        return {
          ...prev,
          photos: newPhotos,
          validationResult: validateMultiViewSet(newPhotos),
          status: "ready",
          version: prev.version + 1,
        };
      });
    },
    [revokeUrl],
  );

  const retryLandmarkDetection = useCallback(
    async (view: PhotoView) => {
      const file = fileRefs.current.get(view);
      if (!file) return;

      versionRef.current += 1;
      const version = versionRef.current;

      setState((prev) => {
        const newPhotos = new Map(prev.photos);
        const photo = newPhotos.get(view)!;
        newPhotos.set(view, { ...photo, landmarkDetectionStatus: "pending", landmarkError: "" });
        return { ...prev, photos: newPhotos, status: "processing", version: prev.version + 1 };
      });

      await validateAndDetectLandmarks(view, file, version);

      setState((prev) => ({
        ...prev,
        validationResult: validateMultiViewSet(prev.photos),
        status: "ready",
      }));
    },
    [validateAndDetectLandmarks],
  );

  const clearAllPhotos = useCallback(() => {
    versionRef.current += 1;
    revokeAllUrls();
    fileRefs.current.clear();

    setState((prev) => ({
      photos: new Map<PhotoView, PatientPhoto>(
        ALL_VIEWS.map((view) => [view, createEmptyPatientPhoto(view)]),
      ),
      status: "idle",
      error: "",
      validationResult: null,
      isReconstructing: false,
      reconstructionProgress: 0,
      reconstructionError: "",
      version: prev.version + 1,
    }));
  }, [revokeAllUrls]);

  const startReconstruction = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isReconstructing: true,
      reconstructionProgress: 0,
      reconstructionError: "",
    }));
  }, []);

  const setReconstructionProgress = useCallback((progress: number) => {
    setState((prev) => ({ ...prev, reconstructionProgress: progress }));
  }, []);

  const finishReconstruction = useCallback((error?: string) => {
    setState((prev) => ({
      ...prev,
      isReconstructing: false,
      reconstructionProgress: error ? 0 : 100,
      reconstructionError: error || "",
    }));
  }, []);

  // Cleanup on unmount
  useEffect(
    () => () => {
      versionRef.current += 1;
      revokeAllUrls();
    },
    [revokeAllUrls],
  );

  // Computed getters
  const getPhoto = useCallback(
    (view: PhotoView) => getPhotoForView(state.photos, view),
    [state.photos],
  );

  const canReconstruct = useCallback(() => countUsableViews(state.photos) >= 2, [state.photos]);

  const uploadedCount = getUploadedViewCount(state.photos);
  const usableViewCount = countUsableViews(state.photos);
  const missingRequiredViews = getMissingRequiredViews(state.photos);

  return {
    ...state,
    uploadPhoto,
    removePhoto,
    retryLandmarkDetection,
    clearAllPhotos,
    startReconstruction,
    setReconstructionProgress,
    finishReconstruction,
    getPhoto,
    canReconstruct: canReconstruct(),
    uploadedCount,
    usableViewCount,
    missingRequiredViews,
    hasAllRequiredPhotos: hasRequiredPhotos(state.photos),
    requiredViews: REQUIRED_VIEWS,
    optionalViews: OPTIONAL_VIEWS,
    allViews: ALL_VIEWS,
    viewLabels: VIEW_LABELS,
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The photo could not be decoded."));
    img.src = url;
  });
}