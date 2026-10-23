import { describe, expect, it } from "vitest";
import {
  buildFaceTextureData,
  cameraDirectionInAlignedFrame,
  normalInAlignedFrame,
  vertexIndexForTexel,
  type TextureView,
} from "../src/services/faceTexture";
import { computeAutoLevels } from "../src/services/detectionPreprocess";

function identityRotation(): Float32Array {
  return Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

function solidView(
  width: number,
  height: number,
  rgb: [number, number, number],
  overrides: Partial<TextureView> = {},
): TextureView {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return {
    view: "front",
    width,
    height,
    data,
    transform: {
      rotation: identityRotation(),
      translation: Float32Array.from([width / 2, -height / 2, 0]),
      scale: width / 2,
    },
    priority: 1,
    direction: [0, 0, 1],
    ...overrides,
  };
}

/**
 * A 3x3 grid of vertices (segmentsX = 2, segmentsY = 2) on a flat, front-facing
 * surface. Vertex iy * 3 + ix, matching the SphereGeometry layout.
 */
function gridSurface(options: { flat?: boolean } = {}) {
  const segmentsX = 2;
  const segmentsY = 2;
  const positions = new Float32Array(9 * 3);
  const normals = new Float32Array(9 * 3);
  const correspondence = new Float32Array(9 * 3);
  const coverage = new Float32Array(9).fill(1);
  for (let iy = 0; iy < 3; iy += 1) {
    for (let ix = 0; ix < 3; ix += 1) {
      const v = iy * 3 + ix;
      const x = (ix - 1) * 0.5;
      const y = (1 - iy) * 0.5;
      const z = options.flat ? 0.8 : 0;
      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;
      normals[v * 3] = 0;
      normals[v * 3 + 1] = 0;
      normals[v * 3 + 2] = 1;
      correspondence[v * 3] = x * 0.5;
      correspondence[v * 3 + 1] = y * 0.5;
      correspondence[v * 3 + 2] = 0;
    }
  }
  return { segmentsX, segmentsY, positions, normals, correspondence, coverage };
}

const identityAlignment = {
  rotation: identityRotation(),
  translation: Float32Array.from([0, 0, 0]),
  scale: 1,
};

function baseInput() {
  const surface = gridSurface();
  return {
    width: 32,
    height: 32,
    segmentsX: surface.segmentsX,
    segmentsY: surface.segmentsY,
    positions: surface.positions,
    normals: surface.normals,
    correspondence: surface.correspondence,
    coverage: surface.coverage,
    canonicalToSceneRotation: identityRotation(),
    inverseAlignment: identityAlignment,
    views: [solidView(32, 32, [255, 0, 0])],
    skinColor: [10, 20, 30] as [number, number, number],
    hairColor: [1, 2, 3] as [number, number, number],
    hairlineY: 100,
  };
}

describe("face texture projection", () => {
  it("maps texture rows and columns onto the SphereGeometry vertex grid", () => {
    expect(vertexIndexForTexel(0, 0, 4, 4, 2, 2)).toBe(0);
    expect(vertexIndexForTexel(3, 3, 4, 4, 2, 2)).toBe(8);
    expect(vertexIndexForTexel(0, 3, 4, 4, 2, 2)).toBe(6);
    expect(vertexIndexForTexel(1, 0, 4, 4, 2, 2)).toBe(1);
  });

  it("derives the camera direction in the aligned frame", () => {
    expect(Array.from(cameraDirectionInAlignedFrame(identityRotation(), identityRotation()))).toEqual([
      0, 0, 1,
    ]);

    // 90 degree rotation about X: the camera axis ends up along +Y.
    const rotation = Float32Array.from([1, 0, 0, 0, 0, -1, 0, 1, 0]);
    const direction = cameraDirectionInAlignedFrame(identityRotation(), rotation);
    expect(direction[0]).toBeCloseTo(0, 6);
    expect(direction[1]).toBeCloseTo(1, 6);
    expect(direction[2]).toBeCloseTo(0, 6);
  });

  it("rotates scene normals back into the canonical frame", () => {
    const rotation = Float32Array.from([0, -1, 0, 1, 0, 0, 0, 0, 1]);
    const normal = normalInAlignedFrame(rotation, 0, 1, 0);
    expect(normal[0]).toBeCloseTo(1, 6);
    expect(normal[1]).toBeCloseTo(0, 6);
    expect(normal[2]).toBeCloseTo(0, 6);
  });

  it("samples photographed colour on every texel the camera can see", () => {
    const result = buildFaceTextureData(baseInput());

    expect(result.coverage).toBeGreaterThan(0.9);
    expect(result.texturedTexels).toBeGreaterThan(0);
    expect(result.viewContributions.front).toBeGreaterThan(0);
    // The only view is solid red, so every textured texel is red.
    expect(result.data[0]).toBe(255);
    expect(result.data[1]).toBe(0);
    expect(result.data[2]).toBe(0);
    expect(result.data[3]).toBe(255);
  });

  it("falls back to the sampled skin colour where no photo sees the surface", () => {
    const input = baseInput();
    input.views = [solidView(32, 32, [255, 0, 0], { direction: [0, 0, -1] })];
    const result = buildFaceTextureData(input);

    expect(result.coverage).toBe(0);
    expect(Array.from(result.data.slice(0, 3))).toEqual([10, 20, 30]);
  });

  it("paints uncovered texels above the hairline with the hair colour", () => {
    const input = baseInput();
    input.views = [];
    input.hairlineY = -10; // everything is above the hairline
    const result = buildFaceTextureData(input);

    expect(result.coverage).toBe(0);
    expect(Array.from(result.data.slice(0, 3))).toEqual([1, 2, 3]);
  });

  it("keeps the fallback colours when the reconstruction has no coverage", () => {
    const input = baseInput();
    input.coverage = new Float32Array(input.coverage.length);
    const result = buildFaceTextureData(input);

    expect(result.coverage).toBe(0);
    expect(result.texturedTexels).toBe(0);
    expect(result.skinColor).toEqual([10, 20, 30]);
    expect(Array.from(result.data.slice(0, 3))).toEqual([10, 20, 30]);
  });

  it("is deterministic for the same inputs", () => {
    const first = buildFaceTextureData(baseInput());
    const second = buildFaceTextureData(baseInput());
    expect(Array.from(second.data)).toEqual(Array.from(first.data));
  });
});

describe("detection exposure normalisation", () => {
  it("finds the usable luminance window of a dark photograph", () => {
    const data = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i += 1) {
      const value = 20 + (i % 41);
      data[i * 4] = value;
      data[i * 4 + 1] = value;
      data[i * 4 + 2] = value;
      data[i * 4 + 3] = 255;
    }
    const { low, high } = computeAutoLevels(data);
    expect(low).toBeGreaterThanOrEqual(19);
    expect(low).toBeLessThanOrEqual(22);
    expect(high).toBeGreaterThanOrEqual(58);
    expect(high).toBeLessThanOrEqual(61);
  });

  it("leaves an already flat image alone", () => {
    const data = new Uint8ClampedArray(256 * 4).fill(40);
    expect(computeAutoLevels(data)).toEqual({ low: 0, high: 255 });
  });
});
