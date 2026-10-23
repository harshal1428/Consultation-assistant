import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCanonicalFaceModel, type CanonicalFaceModel } from "../src/services/canonicalFaceModel";
import {
  buildViewObservation,
  fitMultiViewFace,
  fitSimilarity,
  type ViewObservation,
} from "../src/services/multiViewFitting";
import type { PhotoView } from "../src/lib/multiViewPhoto";

const OBJ_PATH = join(process.cwd(), "public", "models", "canonical_face_model.obj");

function loadCanonical(): CanonicalFaceModel {
  return parseCanonicalFaceModel(readFileSync(OBJ_PATH, "utf8"));
}

/** Rotation about the Y axis (yaw), row-major. */
function yaw(theta: number): Float32Array {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return new Float32Array([c, 0, s, 0, 1, 0, -s, 0, c]);
}

/** Camera looking at the patient's left side (camera on +X). */
function leftProfileRotation(): Float32Array {
  return new Float32Array([0, 0, -1, 0, 1, 0, 1, 0, 0]);
}

/** Camera looking at the patient's right side (camera on -X). */
function rightProfileRotation(): Float32Array {
  return new Float32Array([0, 0, 1, 0, 1, 0, -1, 0, 0]);
}

function applyRot(
  r: Float32Array,
  points: Float32Array,
  count: number,
  scale: number,
  t: [number, number, number],
): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const x = points[o];
    const y = points[o + 1];
    const z = points[o + 2];
    out[o] = scale * (r[0] * x + r[1] * y + r[2] * z) + t[0];
    out[o + 1] = scale * (r[3] * x + r[4] * y + r[5] * z) + t[1];
    out[o + 2] = scale * (r[6] * x + r[7] * y + r[8] * z) + t[2];
  }
  return out;
}

/**
 * Build a synthetic "photograph": the true shape is projected with a camera
 * pose, then converted back into MediaPipe's normalised landmark format.
 */
function synthesiseView(
  view: PhotoView,
  trueShape: Float32Array,
  count: number,
  rotation: Float32Array,
  scale: number,
  width: number,
  height: number,
): ViewObservation {
  const t: [number, number, number] = [width / 2, height / 2, 0];
  const cam = applyRot(rotation, trueShape, count, scale, t);
  const landmarks = [];
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    landmarks.push({
      x: cam[o] / width,
      y: -cam[o + 1] / height,
      z: -cam[o + 2] / width,
    });
  }
  return buildViewObservation(view, landmarks, width, height, count);
}

describe("similarity fitting", () => {
  it("recovers a known rotation, scale and translation", () => {
    const source = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 2, 0,
      0, 0, 3,
      1, 1, 1,
      -2, 0.5, 1.5,
    ]);
    const r = yaw(0.7);
    const scale = 2.5;
    const t: [number, number, number] = [30, -12, 8];
    const target = applyRot(r, source, source.length / 3, scale, t);

    const fit = fitSimilarity(source, target, source.length / 3);

    expect(fit.rmse).toBeLessThan(1e-3);
    expect(fit.transform.scale).toBeCloseTo(scale, 4);
    for (let i = 0; i < 9; i += 1) {
      expect(fit.transform.rotation[i]).toBeCloseTo(r[i], 4);
    }
    for (let i = 0; i < 3; i += 1) {
      expect(fit.transform.translation[i]).toBeCloseTo(t[i], 3);
    }
  });

  it("reports a large residual for a mirrored point cloud", () => {
    const source = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 2, 0,
      0, 0, 3,
      1, 1, 1,
      -2, 0.5, 1.5,
    ]);
    const mirrored = new Float32Array(source.length);
    for (let i = 0; i < source.length; i += 3) {
      mirrored[i] = -source[i];
      mirrored[i + 1] = source[i + 1];
      mirrored[i + 2] = source[i + 2];
    }
    const fit = fitSimilarity(source, mirrored, source.length / 3);
    expect(fit.rmse).toBeGreaterThan(0.5);
  });
});

describe("multi-view fitting", () => {
  const canonical = loadCanonical();

  it("loads the shipped canonical model with the expected topology", () => {
    expect(canonical.vertexCount).toBe(468);
    expect(canonical.triangleCount).toBe(898);
    expect(canonical.indices.length).toBe(898 * 3);
    // Every vertex must have at least two neighbours so the Laplacian is valid.
    for (const neighbours of canonical.neighbours) {
      expect(neighbours.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("recovers a known patient-specific deformation from three views", () => {
    const count = canonical.vertexCount;
    // Ground truth: a wider face plus a more projected nose tip.
    const trueShape = new Float32Array(canonical.positions);
    const noseIndex = 4;
    const nx = canonical.positions[noseIndex * 3];
    const ny = canonical.positions[noseIndex * 3 + 1];
    const nz = canonical.positions[noseIndex * 3 + 2];
    for (let i = 0; i < count; i += 1) {
      const o = i * 3;
      trueShape[o] = canonical.positions[o] * 1.07;
      const dx = canonical.positions[o] - nx;
      const dy = canonical.positions[o + 1] - ny;
      const dz = canonical.positions[o + 2] - nz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const bump = Math.exp(-d2 / (2 * 1.6 * 1.6));
      trueShape[o + 2] = canonical.positions[o + 2] + 1.2 * bump;
    }

    const width = 900;
    const height = 1200;
    const observations = [
      synthesiseView("front", trueShape, count, yaw(0.05), 26, width, height),
      synthesiseView("left-profile", trueShape, count, leftProfileRotation(), 26, width, height),
      synthesiseView("right-profile", trueShape, count, rightProfileRotation(), 26, width, height),
    ];

    const result = fitMultiViewFace(canonical, observations);

    // The reprojection must be accurate: the shared shape explains every view.
    expect(result.maxRmse).toBeLessThan(6);
    expect(result.perView.length).toBe(3);

    // The recovered shape must reproduce the ground-truth deformation.
    // Compare against the canonical template, after the same final alignment
    // the fitter applies.
    const truth = fitSimilarity(trueShape, canonical.positions, count).transform;
    const alignedTruth = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const o = i * 3;
      const x = trueShape[o];
      const y = trueShape[o + 1];
      const z = trueShape[o + 2];
      alignedTruth[o] =
        truth.scale * (truth.rotation[0] * x + truth.rotation[1] * y + truth.rotation[2] * z) +
        truth.translation[0];
      alignedTruth[o + 1] =
        truth.scale * (truth.rotation[3] * x + truth.rotation[4] * y + truth.rotation[5] * z) +
        truth.translation[1];
      alignedTruth[o + 2] =
        truth.scale * (truth.rotation[6] * x + truth.rotation[7] * y + truth.rotation[8] * z) +
        truth.translation[2];
    }

    let sum = 0;
    let max = 0;
    for (let i = 0; i < count * 3; i += 1) {
      const d = result.shape[i] - alignedTruth[i];
      sum += d * d;
      if (Math.abs(d) > max) max = Math.abs(d);
    }
    const rmse = Math.sqrt(sum / (count * 3));
    // Sub-millimetre-scale agreement on the canonical template scale.
    expect(rmse).toBeLessThan(0.12);
    expect(max).toBeLessThan(0.6);

    // The nose tip must end up more anterior than the template.
    const tipDelta = result.deltas[noseIndex * 3 + 2];
    expect(tipDelta).toBeGreaterThan(0.6);
  });

  it("flags a mirrored profile photograph", () => {
    const count = canonical.vertexCount;
    const width = 900;
    const height = 1200;
    const front = synthesiseView("front", canonical.positions, count, yaw(0.02), 26, width, height);
    const left = synthesiseView("left-profile", canonical.positions, count, leftProfileRotation(), 26, width, height);
    const right = synthesiseView("right-profile", canonical.positions, count, rightProfileRotation(), 26, width, height);
    // A horizontally flipped photograph reverses the camera x axis.
    const flippedLeft: ViewObservation = {
      view: "left-profile",
      points: (() => {
        const p = new Float32Array(left.points.length);
        for (let i = 0; i < left.pointCount; i += 1) {
          p[i * 3] = -left.points[i * 3];
          p[i * 3 + 1] = left.points[i * 3 + 1];
          p[i * 3 + 2] = left.points[i * 3 + 2];
        }
        return p;
      })(),
      pointCount: left.pointCount,
    };

    const result = fitMultiViewFace(canonical, [front, flippedLeft, right]);

    const mirrored = result.perView.filter((v) => v.looksMirrored);
    expect(mirrored.length).toBeGreaterThanOrEqual(1);
    expect(mirrored[0].view).toBe("left-profile");
  });

  it("rejects an observation set without enough landmarks", () => {
    const observations: ViewObservation[] = [
      { view: "front", points: new Float32Array(30), pointCount: 10 },
    ];
    expect(() => fitMultiViewFace(canonical, observations)).toThrow(/No usable/i);
  });
});
