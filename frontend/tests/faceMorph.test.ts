import { describe, expect, it } from "vitest";
import {
  FACE_MORPH_KEYS,
  NEUTRAL_FACE_MORPH,
  applyFaceMorph,
  clampMorph,
  isNeutralMorph,
  morphEyeScale,
  morphPoint,
} from "../src/scene/geometry/faceMorph";

describe("face morph coefficients", () => {
  it("exposes a neutral default for every coefficient", () => {
    expect(FACE_MORPH_KEYS).toHaveLength(16);
    for (const key of FACE_MORPH_KEYS) {
      expect(NEUTRAL_FACE_MORPH[key]).toBe(0);
    }
    expect(isNeutralMorph(NEUTRAL_FACE_MORPH)).toBe(true);
  });

  it("flags a non-neutral coefficient", () => {
    expect(isNeutralMorph({ ...NEUTRAL_FACE_MORPH, noseWidth: 0.4 })).toBe(false);
    expect(isNeutralMorph({ ...NEUTRAL_FACE_MORPH, noseWidth: 1e-9 })).toBe(true);
  });

  it("clamps coefficients to [-1, 1] and rejects non-finite values", () => {
    expect(clampMorph(2)).toBe(1);
    expect(clampMorph(-3)).toBe(-1);
    expect(clampMorph(0.25)).toBe(0.25);
    expect(clampMorph(Number.NaN)).toBe(0);
    expect(clampMorph(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampMorph(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("morphPoint", () => {
  it("is the exact identity for the neutral morph", () => {
    const out = [0, 0, 0];
    for (const p of [
      [0.2, 0.35, 0.6],
      [-0.4, -0.2, 0.3],
      [0, 0, 0],
    ] as const) {
      morphPoint(p[0], p[1], p[2], NEUTRAL_FACE_MORPH, out);
      expect(out).toEqual([p[0], p[1], p[2]]);
    }
  });

  it("widens the face for a positive faceWidth coefficient", () => {
    const out = [0, 0, 0];
    morphPoint(0.5, 0, 0.5, { ...NEUTRAL_FACE_MORPH, faceWidth: 1 }, out);
    expect(out[0]).toBeGreaterThan(0.5);
  });

  it("lengthens the lower face about the eye line for faceLength", () => {
    const out = [0, 0, 0];
    morphPoint(0, -0.4, 0.3, { ...NEUTRAL_FACE_MORPH, faceLength: 1 }, out);
    expect(out[1]).toBeLessThan(-0.4);
  });

  it("projects the nose tip forward on the front of the face", () => {
    const out = [0, 0, 0];
    morphPoint(0, -0.16, 0.6, { ...NEUTRAL_FACE_MORPH, noseTip: 1 }, out);
    expect(out[2]).toBeGreaterThan(0.6);
  });
});

describe("applyFaceMorph", () => {
  it("returns the input buffer unchanged for the neutral morph", () => {
    const base = new Float32Array([1, 2, 3, 4, 5, 6]);
    expect(applyFaceMorph(base, NEUTRAL_FACE_MORPH)).toBe(base);
  });

  it("returns a new warped buffer for a non-neutral morph", () => {
    const base = new Float32Array([0.5, 0, 0.5]);
    const result = applyFaceMorph(base, { ...NEUTRAL_FACE_MORPH, faceWidth: 1 });
    expect(result).not.toBe(base);
    expect(base[0]).toBe(0.5);
    expect(result[0]).toBeGreaterThan(0.5);
  });
});

describe("morphEyeScale", () => {
  it("returns 1 for the neutral morph and grows with eyeSize", () => {
    expect(morphEyeScale(NEUTRAL_FACE_MORPH)).toBe(1);
    expect(morphEyeScale({ ...NEUTRAL_FACE_MORPH, eyeSize: 1 })).toBeGreaterThan(1);
  });
});

describe("applyFaceMorph", () => {
  it("returns the same buffer reference for a neutral morph", () => {
    const base = new Float32Array([1, 2, 3]);
    expect(applyFaceMorph(base, NEUTRAL_FACE_MORPH)).toBe(base);
  });
});
