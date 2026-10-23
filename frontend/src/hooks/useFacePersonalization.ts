import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceMorph } from "../scene/geometry/faceMorph";
import {
  measureProfile,
  profileToMorph,
  sampleSkinTone,
  DEFAULT_SKIN_TONE,
  FaceReconstructionError,
} from "../services/faceReconstruction";
import type { FaceProfile, FaceLandmarkPoint } from "../services/faceReconstruction";
import { detectFaceLandmarks } from "../services/faceLandmarker";
import { validatePhotoFile } from "../lib/photo";

/**
 * Personalization workflow orchestration (Phase 9).
 *
 * Owns the uploaded photo, the reconstruction lifecycle, and the resulting
 * personalized baseline. A monotonically increasing version token invalidates
 * stale asynchronous work, so removing or replacing a photo can never be
 * "undone" by a late landmark/measurement response.
 */

export type PersonalizationStatus = "idle" | "loading" | "ready" | "error";

export interface ActivePersonalization {
  morph: FaceMorph;
  skinTone: string;
  profile: FaceProfile;
  photoName: string;
}

export interface FacePersonalization {
  personalization: ActivePersonalization | null;
  previewUrl: string | null;
  photoName: string;
  status: PersonalizationStatus;
  error: string;
  upload: (file: File) => void;
  remove: () => void;
  retry: () => void;
  /** Test hook: set a precomputed personalization (bypasses detection). */
  applyPersonalization: (value: ActivePersonalization) => void;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The photo could not be decoded."));
    img.src = url;
  });
}

/**
 * Read skin tone from the image via a small offscreen canvas. Returns the
 * fallback when canvas/pixel access is unavailable (e.g. jsdom, tainted data).
 */
function readSkinTone(
  image: HTMLImageElement,
  landmarks: FaceLandmarkPoint[],
): string {
  try {
    if (typeof document === "undefined") return DEFAULT_SKIN_TONE;
    const naturalW = image.naturalWidth || image.width;
    const naturalH = image.naturalHeight || image.height;
    if (!naturalW || !naturalH) return DEFAULT_SKIN_TONE;
    const maxSide = 256;
    const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
    const w = Math.max(1, Math.round(naturalW * scale));
    const h = Math.max(1, Math.round(naturalH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return DEFAULT_SKIN_TONE;
    ctx.drawImage(image, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return sampleSkinTone(data.data, w, h, landmarks, DEFAULT_SKIN_TONE);
  } catch {
    return DEFAULT_SKIN_TONE;
  }
}

export function useFacePersonalization(): FacePersonalization {
  const [personalization, setPersonalization] =
    useState<ActivePersonalization | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState("");
  const [status, setStatus] = useState<PersonalizationStatus>("idle");
  const [error, setError] = useState("");

  const versionRef = useRef(0);
  const urlRef = useRef<string | null>(null);
  const fileRef = useRef<File | null>(null);

  const revokeCurrentUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const reconstruct = useCallback(
    async (url: string, label: string, version: number) => {
      const isStale = () => version !== versionRef.current;
      try {
        const image = await loadImage(url);
        if (isStale()) return;
        const landmarks = await detectFaceLandmarks(image);
        if (isStale()) return;
        if (!landmarks) {
          setError(
            "No face was detected. Use a clear, well-lit, front-facing photo.",
          );
          setStatus("error");
          setPersonalization(null);
          return;
        }
        const profile = measureProfile(landmarks);
        const morph = profileToMorph(profile);
        const skinTone = readSkinTone(image, landmarks);
        if (isStale()) return;
        setPersonalization({ morph, skinTone, profile, photoName: label });
        setStatus("ready");
      } catch (err) {
        if (isStale()) return;
        setError(
          err instanceof FaceReconstructionError
            ? err.message
            : "Reconstruction from this photo failed. Try another photo.",
        );
        setStatus("error");
        setPersonalization(null);
      }
    },
    [],
  );

  const start = useCallback(
    (file: File) => {
      if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
        setError("This browser cannot preview the selected photo.");
        setStatus("error");
        return;
      }
      versionRef.current += 1;
      const version = versionRef.current;
      revokeCurrentUrl();
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      fileRef.current = file;
      const label = file.name.replace(/\.[^.]+$/, "") || "Uploaded photo";
      setPreviewUrl(url);
      setPhotoName(label);
      setStatus("loading");
      setError("");
      void reconstruct(url, label, version);
    },
    [reconstruct, revokeCurrentUrl],
  );

  const upload = useCallback(
    (file: File) => {
      const validation = validatePhotoFile(file);
      if (!validation.ok) {
        setError(validation.error);
        setStatus("error");
        return;
      }
      start(file);
    },
    [start],
  );

  const remove = useCallback(() => {
    versionRef.current += 1; // Invalidate any in-flight reconstruction.
    revokeCurrentUrl();
    fileRef.current = null;
    setPreviewUrl(null);
    setPhotoName("");
    setPersonalization(null);
    setStatus("idle");
    setError("");
  }, [revokeCurrentUrl]);

  const retry = useCallback(() => {
    const file = fileRef.current;
    if (file) start(file);
  }, [start]);

  const applyPersonalization = useCallback((value: ActivePersonalization) => {
    versionRef.current += 1;
    setPersonalization(value);
    setStatus("ready");
    setError("");
  }, []);

  // Release the object URL on unmount.
  useEffect(
    () => () => {
      versionRef.current += 1;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  return {
    personalization,
    previewUrl,
    photoName,
    status,
    error,
    upload,
    remove,
    retry,
    applyPersonalization,
  };
}
