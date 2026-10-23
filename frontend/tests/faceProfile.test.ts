import { describe, expect, it } from "vitest";
import { HEAD_SHAPE, surfacePoint } from "../src/scene/geometry";

/**
 * Anatomical profile invariants for the generated default head.
 *
 * These guard the specific "double nose bulge" regression: the nose must be a
 * single monotonic dorsum rising to the tip, with the tip the most anterior
 * point of the whole face, and no lateral slices may have off-centre maxima.
 */

const TIP_Y = -0.16;
const NASION_Y = 0.34;
const SUBNASALE_Y = -0.3;
const POGONION_Y = -0.56;

function z(x: number, y: number): number {
  return surfacePoint(x, y)[2];
}

describe("default head facial profile", () => {
  it("rises monotonically along the midline from nasion to tip", () => {
    let previous = -Infinity;
    for (let y = NASION_Y; y >= TIP_Y; y -= 0.01) {
      const current = z(0, y);
      expect(current).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = current;
    }
  });

  it("makes the nose tip the most anterior point of the face", () => {
    const tip = z(0, TIP_Y);
    for (const y of [NASION_Y, 0.17, 0.0, SUBNASALE_Y, -0.36, -0.44, POGONION_Y]) {
      expect(tip).toBeGreaterThan(z(0, y) + 1e-3);
    }
  });

  it("falls away from the tip toward the subnasale", () => {
    expect(z(0, TIP_Y)).toBeGreaterThan(z(0, SUBNASALE_Y) + 0.1);
  });

  it("has a single centrally-dominant maximum in every transverse nose slice", () => {
    for (const y of [0.17, 0.0, TIP_Y, -0.19, -0.22]) {
      const centre = z(0, y);
      for (let x = 0.04; x <= 0.34; x += 0.02) {
        expect(z(x, y)).toBeLessThan(centre);
      }
    }
  });

  it("keeps the tip well inside the head depth budget", () => {
    const tip = z(0, TIP_Y);
    expect(tip).toBeLessThan(HEAD_SHAPE.rz + 0.32);
    expect(tip).toBeGreaterThan(HEAD_SHAPE.rz);
  });

  it("keeps the face symmetric about the midline", () => {
    for (const [x, y] of [
      [0.15, -0.19],
      [0.24, 0.19],
      [0.4, -0.05],
    ] as const) {
      expect(z(x, y)).toBeCloseTo(z(-x, y), 6);
    }
  });
});
