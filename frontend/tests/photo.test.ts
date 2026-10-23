import { describe, expect, it } from "vitest";
import {
  ACCEPTED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  validatePhotoFile,
} from "../src/lib/photo";

describe("validatePhotoFile", () => {
  it("accepts the supported raster photo types", () => {
    for (const type of ACCEPTED_PHOTO_TYPES) {
      expect(validatePhotoFile({ type, size: 1024 }).ok).toBe(true);
    }
  });

  it("rejects non-image files", () => {
    const result = validatePhotoFile({ type: "application/pdf", size: 1024 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unsupported file type/i);
  });

  it("rejects files over the size limit", () => {
    const result = validatePhotoFile({ type: "image/png", size: MAX_PHOTO_BYTES + 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  it("accepts a photo exactly at the size limit", () => {
    expect(validatePhotoFile({ type: "image/jpeg", size: MAX_PHOTO_BYTES }).ok).toBe(
      true,
    );
  });
});
