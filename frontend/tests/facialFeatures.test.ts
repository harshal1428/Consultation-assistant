import { describe, expect, it } from "vitest";
import {
  BROW,
  EAR,
  EYE,
  FEATURE_COLORS,
  browAnchor,
  earAnchor,
  eyeCenter,
  surfacePoint,
} from "../src/scene/geometry";

describe("facial feature placement", () => {
  it("places eyes symmetrically about the midline", () => {
    const right = eyeCenter(1);
    const left = eyeCenter(-1);
    expect(right[0]).toBeGreaterThan(0);
    expect(left[0]).toBeLessThan(0);
    expect(right[0]).toBeCloseTo(-left[0], 6);
    expect(right[1]).toBeCloseTo(left[1], 6);
    expect(right[2]).toBeCloseTo(left[2], 6);
  });

  it("recesses the eyeball behind the skin surface", () => {
    const surface = surfacePoint(EYE.x, EYE.y);
    const centre = eyeCenter(1);
    expect(centre[2]).toBeLessThan(surface[2]);
    expect(surface[2] - centre[2]).toBeCloseTo(EYE.backset, 6);
  });

  it("anchors the brow above the eye on the surface", () => {
    const eye = eyeCenter(1);
    const brow = browAnchor(1);
    expect(brow[1]).toBeGreaterThan(eye[1]);
    expect(brow[0]).toBeCloseTo(eye[0], 6);
  });

  it("places ears symmetrically at the sides", () => {
    const right = earAnchor(1);
    const left = earAnchor(-1);
    expect(right[0]).toBeCloseTo(EAR.x, 6);
    expect(left[0]).toBeCloseTo(-EAR.x, 6);
    expect(right[1]).toBeCloseTo(EAR.y, 6);
    expect(right[2]).toBeCloseTo(EAR.z, 6);
  });

  it("has positive, ordered feature dimensions", () => {
    expect(EYE.ballRadius).toBeGreaterThan(EYE.irisRadius);
    expect(EYE.irisRadius).toBeGreaterThan(EYE.pupilRadius);
    expect(EYE.lidTube).toBeGreaterThan(0);
    expect(BROW.radius).toBeGreaterThan(BROW.tube);
    expect(BROW.arc).toBeGreaterThan(0);
    expect(BROW.above).toBeGreaterThan(0);
    for (const s of EAR.scale) expect(s).toBeGreaterThan(0);
  });

  it("defines a distinct colour for every feature layer", () => {
    const colors = Object.values(FEATURE_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
