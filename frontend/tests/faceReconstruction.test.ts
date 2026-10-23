import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKIN_TONE,
  FACE_LANDMARK_INDEX,
  TYPICAL_PROFILE,
  FaceReconstructionError,
  isValidLandmarkSet,
  measureProfile,
  profileToMorph,
  sampleSkinTone,
} from "../src/services/faceReconstruction";
import type { FaceLandmarkPoint } from "../src/services/faceReconstruction";
import { isNeutralMorph } from "../src/scene/geometry/faceMorph";

/**
 * Build a full 478-point landmark set (y grows downward, as in normalized image
 * coordinates) with a plausible frontal face, then apply overrides.
 */
function buildLandmarks(
  overrides: Partial<Record<keyof typeof FACE_LANDMARK_INDEX, FaceLandmarkPoint>> = {},
): FaceLandmarkPoint[] {
  const pts: FaceLandmarkPoint[] = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }));
  const set = (index: number, x: number, y: number) => {
    pts[index] = { x, y, z: 0 };
  };
  const idx = FACE_LANDMARK_INDEX;
  set(idx.foreheadTop, 0.5, 0.2);
  set(idx.chinBottom, 0.5, 0.85);
  set(idx.faceRight, 0.28, 0.5);
  set(idx.faceLeft, 0.72, 0.5);
  set(idx.jawRight, 0.32, 0.6);
  set(idx.jawLeft, 0.68, 0.6);
  set(idx.chinRight, 0.42, 0.8);
  set(idx.chinLeft, 0.58, 0.8);
  set(idx.eyeRightOuter, 0.34, 0.5);
  set(idx.eyeRightInner, 0.44, 0.5);
  set(idx.eyeLeftInner, 0.56, 0.5);
  set(idx.eyeLeftOuter, 0.66, 0.5);
  set(idx.irisRight, 0.41, 0.5);
  set(idx.irisLeft, 0.59, 0.5);
  set(idx.browRight, 0.4, 0.45);
  set(idx.browLeft, 0.6, 0.45);
  set(idx.noseBridge, 0.5, 0.46);
  set(idx.noseTip, 0.5, 0.58);
  set(idx.subnasale, 0.5, 0.62);
  set(idx.alarRight, 0.44, 0.62);
  set(idx.alarLeft, 0.56, 0.62);
  set(idx.mouthRight, 0.42, 0.72);
  set(idx.mouthLeft, 0.58, 0.72);
  set(idx.upperLipTop, 0.5, 0.7);
  set(idx.lowerLipBottom, 0.5, 0.75);

  for (const [key, value] of Object.entries(overrides)) {
    if (value) pts[FACE_LANDMARK_INDEX[key as keyof typeof FACE_LANDMARK_INDEX]] = value;
  }
  return pts;
}

describe("measureProfile", () => {
  it("returns finite, positive proportions for a plausible face", () => {
    const profile = measureProfile(buildLandmarks());
    for (const value of Object.values(profile)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
    // Face width stays narrower than its height for this synthetic face.
    expect(profile.faceWidthOverHeight).toBeGreaterThan(0.5);
    expect(profile.faceWidthOverHeight).toBeLessThan(1);
  });

  it("increases faceWidthOverHeight when the face is widened", () => {
    const narrow = measureProfile(buildLandmarks());
    const wide = measureProfile(
      buildLandmarks({
        faceRight: { x: 0.2, y: 0.5, z: 0 },
        faceLeft: { x: 0.8, y: 0.5, z: 0 },
      }),
    );
    expect(wide.faceWidthOverHeight).toBeGreaterThan(narrow.faceWidthOverHeight);
  });

  it("rejects an empty or incomplete landmark set", () => {
    expect(() => measureProfile([])).toThrowError(/could not be measured/i);
    const short = buildLandmarks().slice(0, 100);
    expect(() => measureProfile(short)).toThrowError(/could not be measured/i);
  });
});

describe("recovered depth (MediaPipe z)", () => {
  it("keeps the nose tip neutral when depth is unavailable (all zero)", () => {
    const profile = measureProfile(buildLandmarks());
    expect(profile.noseProjectionDepth).toBeCloseTo(
      TYPICAL_PROFILE.noseProjectionDepth,
      6,
    );
    expect(profileToMorph(profile).noseTip).toBeCloseTo(0, 6);
  });

  it("projects the tip when the recovered depth shows a projecting nose", () => {
    const profile = measureProfile(
      buildLandmarks({ noseTip: { x: 0.5, y: 0.58, z: -0.2 } }),
    );
    expect(profile.noseProjectionDepth).toBeGreaterThan(
      TYPICAL_PROFILE.noseProjectionDepth,
    );
    expect(profileToMorph(profile).noseTip).toBeGreaterThan(0);
  });
});

describe("profileToMorph", () => {
  it("is a no-op (neutral) for the typical profile", () => {
    const morph = profileToMorph({ ...TYPICAL_PROFILE });
    expect(isNeutralMorph(morph)).toBe(true);
  });

  it("widens the morph as the measured face widens", () => {
    const narrow = buildLandmarks();
    const wide = buildLandmarks({
      faceRight: { x: 0.22, y: 0.5, z: 0 },
      faceLeft: { x: 0.78, y: 0.5, z: 0 },
    });
    const narrowMorph = profileToMorph(measureProfile(narrow));
    const wideMorph = profileToMorph(measureProfile(wide));
    expect(wideMorph.faceWidth).toBeGreaterThan(narrowMorph.faceWidth);
  });

  it("keeps every coefficient within [-1, 1] even for extreme input", () => {
    const extreme = measureProfile(
      buildLandmarks({
        faceRight: { x: 0.9, y: 0.5, z: 0 },
        faceLeft: { x: 0.1, y: 0.5, z: 0 },
      }),
    );
    const morph = profileToMorph(extremeProfile(extreme));
    for (const value of Object.values(morph)) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

function extremeProfile(profile: ReturnType<typeof measureProfile>) {
  return Object.fromEntries(
    Object.entries(profile).map(([key, value]) => [key, value * 10]),
  ) as typeof profile;
}

describe("sampleSkinTone", () => {
  it("returns the median sampled colour from image pixels", () => {
    const width = 8;
    const height = 8;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 200;
      pixels[i + 1] = 120;
      pixels[i + 2] = 90;
      pixels[i + 3] = 255;
    }
    const tone = sampleSkinTone(pixels, width, height, buildLandmarks());
    expect(tone).toBe("#c8785a");
  });

  it("falls back to the default tone without pixel data", () => {
    expect(sampleSkinTone(null, 8, 8, buildLandmarks())).toBe("#e7b89b");
  });
});

describe("isValidLandmarkSet", () => {
  it("accepts a complete set and rejects out-of-range coordinates", () => {
    expect(isValidLandmarkSet(buildLandmarks())).toBe(true);
    const bad = buildLandmarks();
    bad[10] = { x: 5, y: 0.5, z: 0 };
    expect(isValidLandmarkSet(bad)).toBe(false);
  });
});
