/**
 * Uploaded-photo validation (Phase 9).
 *
 * Only raster photos are accepted, and only up to a bounded size. The file is
 * read locally (object URL + canvas) and never uploaded anywhere.
 */

export const ACCEPTED_PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12 MB

export const PHOTO_PRIVACY_NOTE =
  "Your photo is processed entirely on this device and never uploaded. " +
  "Personalization is not saved to any server.";

export interface PhotoValidation {
  ok: boolean;
  error: string;
}

export function validatePhotoFile(file: {
  type: string;
  size: number;
}): PhotoValidation {
  if (!file || typeof file.type !== "string") {
    return { ok: false, error: "That file could not be read." };
  }
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
    return {
      ok: false,
      error: "Unsupported file type. Use a PNG, JPEG, or WebP photo.",
    };
  }
  if (typeof file.size === "number" && file.size > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      error: "That photo is too large. Use an image under 12 MB.",
    };
  }
  return { ok: true, error: "" };
}
