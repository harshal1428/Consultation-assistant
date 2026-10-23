import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PhotoView } from "../src/lib/multiViewPhoto";
import type { PatientPhoto } from "../src/lib/multiViewPhoto";

/**
 * The reconstruction service loads the canonical model over HTTP in the
 * browser. In the test environment the real shipped asset is parsed from disk
 * instead, so the pipeline under test is exactly the production one.
 */
vi.mock("../src/services/canonicalFaceModel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/canonicalFaceModel")>();
  const obj = readFileSync(
    join(process.cwd(), "public", "models", "canonical_face_model.obj"),
    "utf8",
  );
  const model = actual.parseCanonicalFaceModel(obj);
  return { ...actual, loadCanonicalFaceModel: vi.fn(async () => model) };
});

import { parseCanonicalFaceModel, type CanonicalFaceModel } from "../src/services/canonicalFaceModel";
import {
  reconstructFaceFromMultiView,
  createReconstructionPreview,
} from "../src/services/multiViewReconstruction";
import { buildPersonalizedHeadModel } from "../src/scene/geometry/personalizedHead";
import { createHeadGeometry } from "../src/scene/geometry/headMesh";
import { projectCanonicalMesh } from "../src/scene/geometry/reconstructionPreview";

const OBJ_PATH = join(process.cwd(), "public", "models", "canonical_face_model.obj");

function loadCanonical(): CanonicalFaceModel {
  return parseCanonicalFaceModel(readFileSync(OBJ_PATH, "utf8"));
}

function yaw(theta: number): Float32Array {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return new Float32Array([c, 0, s, 0, 1, 0, -s, 0, c]);
}

function leftProfileRotation(): Float32Array {
  return new Float32Array([0, 0, -1, 0, 1, 0, 1, 0, 0]);
}

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

const IMAGE_WIDTH = 900;
const IMAGE_HEIGHT = 1200;

/** Build a synthetic photograph: the true shape is rendered with a camera pose. */
function synthesisePhoto(
  view: PhotoView,
  trueShape: Float32Array,
  count: number,
  rotation: Float32Array,
  scale: number,
): PatientPhoto {
  const t: [number, number, number] = [IMAGE_WIDTH / 2, IMAGE_HEIGHT / 2, 0];
  const cam = applyRot(rotation, trueShape, count, scale, t);
  const landmarks = [];
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    landmarks.push({
      x: cam[o] / IMAGE_WIDTH,
      y: -cam[o + 1] / IMAGE_HEIGHT,
      z: -cam[o + 2] / IMAGE_WIDTH,
    });
  }
  return {
    view,
    file: new File(["x"], `${view}.jpg`, { type: "image/jpeg" }),
    previewUrl: `blob:${view}`,
    landmarks,
    validation: {
      ok: true,
      error: "",
      warnings: [],
      faceDetected: true,
      imageDimensions: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
    },
    landmarkDetectionStatus: "complete",
    landmarkError: "",
  };
}

function photoMap(photos: PatientPhoto[]): Map<PhotoView, PatientPhoto> {
  const map = new Map<PhotoView, PatientPhoto>();
  for (const photo of photos) map.set(photo.view, photo);
  return map;
}

/** Ground truth: a wider face plus a 1.2 cm more projected nose tip. */
function deformedShape(canonical: CanonicalFaceModel): Float32Array {
  const count = canonical.vertexCount;
  const shape = new Float32Array(canonical.positions);
  const noseIndex = 4;
  const nx = canonical.positions[noseIndex * 3];
  const ny = canonical.positions[noseIndex * 3 + 1];
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    shape[o] = canonical.positions[o] * 1.07;
    const dx = canonical.positions[o] - nx;
    const dy = canonical.positions[o + 1] - ny;
    const dz = canonical.positions[o + 2] - canonical.positions[noseIndex * 3 + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    shape[o + 2] = canonical.positions[o + 2] + 1.2 * Math.exp(-d2 / (2 * 1.6 * 1.6));
  }
  return shape;
}

describe("multi-view reconstruction service", () => {
  const canonical = loadCanonical();

  it("reconstructs a coherent 3D shape from three photographs", async () => {
    const truth = deformedShape(canonical);
    const photos = photoMap([
      synthesisePhoto("front", truth, canonical.vertexCount, yaw(0.05), 26),
      synthesisePhoto("left-profile", truth, canonical.vertexCount, leftProfileRotation(), 26),
      synthesisePhoto("right-profile", truth, canonical.vertexCount, rightProfileRotation(), 26),
    ]);

    const result = await reconstructFaceFromMultiView(photos);

    expect(result.success).toBe(true);
    expect(result.error).toBe("");
    expect(result.canonicalShape).not.toBeNull();
    expect(result.canonicalShape!.length).toBe(canonical.vertexCount * 3);
    expect(result.viewsUsed).toEqual(
      expect.arrayContaining(["front", "left-profile", "right-profile"]),
    );

    // The reconstruction must differ from the neutral template: it carries
    // the patient's identity.
    let deviation = 0;
    for (let i = 0; i < result.canonicalShape!.length; i += 1) {
      deviation += Math.abs(result.canonicalShape![i] - canonical.positions[i]);
    }
    expect(deviation / result.canonicalShape!.length).toBeGreaterThan(0.05);

    // The nose tip must come out more anterior than in the template.
    const tipDelta = result.canonicalShape![4 * 3 + 2] - canonical.positions[4 * 3 + 2];
    expect(tipDelta).toBeGreaterThan(0.4);

    // Real, bounded quality metrics.
    expect(result.qualityMetrics.overallScore).toBeGreaterThan(0);
    expect(result.qualityMetrics.overallScore).toBeLessThanOrEqual(1);
    expect(result.qualityMetrics.landmarkCoverage).toBeGreaterThan(0.9);
    expect(result.qualityMetrics.viewCoverage).toBe(1);
    expect(result.qualityMetrics.perView.length).toBe(3);
    for (const view of result.qualityMetrics.perView) {
      expect(view.rmsePx).toBeGreaterThanOrEqual(0);
      expect(view.normalisedError).toBeLessThan(0.2);
    }

    // A bounded identity summary is derived for the anatomical attachments.
    expect(result.faceMorph).not.toBeNull();
    for (const value of Object.values(result.faceMorph!)) {
      expect(Math.abs(value)).toBeLessThanOrEqual(1.0001);
    }
  });

  it("warns when the photographs do not agree on one shape", async () => {
    // Two different "patients": a wide face with a projected nose and a narrow
    // face with a flat nose. A single shared shape cannot explain both.
    const wide = deformedShape(canonical);
    const narrow = new Float32Array(canonical.positions);
    for (let i = 0; i < canonical.vertexCount; i += 1) {
      narrow[i * 3] = canonical.positions[i * 3] * 0.82;
      narrow[i * 3 + 2] = canonical.positions[i * 3 + 2] * 0.94;
    }

    const photos = photoMap([
      synthesisePhoto("front", wide, canonical.vertexCount, yaw(0.05), 26),
      synthesisePhoto("left-profile", narrow, canonical.vertexCount, leftProfileRotation(), 26),
      synthesisePhoto("right-profile", wide, canonical.vertexCount, rightProfileRotation(), 26),
    ]);

    const result = await reconstructFaceFromMultiView(photos);

    expect(result.success).toBe(true);
    const inconsistent = result.warnings.some((w) =>
      /do not agree on one 3D shape|different people/i.test(w),
    );
    expect(inconsistent).toBe(true);
    // The disagreement has to show up in the measured quality as well.
    expect(result.qualityMetrics.normalisedError).toBeGreaterThan(0.01);
  });

  it("does not warn about disagreement when all photographs show the same face", async () => {
    const truth = deformedShape(canonical);
    const photos = photoMap([
      synthesisePhoto("front", truth, canonical.vertexCount, yaw(0.05), 26),
      synthesisePhoto("left-profile", truth, canonical.vertexCount, leftProfileRotation(), 26),
      synthesisePhoto("right-profile", truth, canonical.vertexCount, rightProfileRotation(), 26),
    ]);

    const result = await reconstructFaceFromMultiView(photos);

    expect(result.success).toBe(true);
    expect(
      result.warnings.some((w) => /do not agree on one 3D shape|different people/i.test(w)),
    ).toBe(false);
    expect(result.qualityMetrics.normalisedError).toBeLessThan(0.01);
  });

  it("fails honestly when there are not enough usable views", async () => {
    const photos = photoMap([
      synthesisePhoto("front", canonical.positions, canonical.vertexCount, yaw(0.02), 26),
    ]);

    const result = await reconstructFaceFromMultiView(photos);

    expect(result.success).toBe(false);
    expect(result.error.length).toBeGreaterThan(0);
    expect(result.canonicalShape).toBeNull();
    expect(result.faceMorph).toBeNull();
  });

  it("fails honestly when a photograph has no detected landmarks", async () => {
    const photos = photoMap([
      {
        ...synthesisePhoto("front", canonical.positions, canonical.vertexCount, yaw(0.02), 26),
        landmarks: null,
        landmarkDetectionStatus: "error" as const,
        landmarkError: "No face detected in this view.",
      },
      synthesisePhoto("left-profile", canonical.positions, canonical.vertexCount, leftProfileRotation(), 26),
    ]);

    const result = await reconstructFaceFromMultiView(photos);

    expect(result.success).toBe(false);
    expect(result.error.length).toBeGreaterThan(0);
    expect(result.canonicalShape).toBeNull();
  });

  it("warns when a view is mirrored instead of silently using it", async () => {
    const truth = deformedShape(canonical);
    const front = synthesisePhoto("front", truth, canonical.vertexCount, yaw(0.02), 26);
    const left = synthesisePhoto("left-profile", truth, canonical.vertexCount, leftProfileRotation(), 26);
    const right = synthesisePhoto("right-profile", truth, canonical.vertexCount, rightProfileRotation(), 26);

    // A horizontally flipped photograph reverses the camera x axis.
    const flipped: PatientPhoto = {
      ...left,
      landmarks: left.landmarks!.map((lm) => ({ ...lm, x: -lm.x })),
    };

    const result = await reconstructFaceFromMultiView(
      photoMap([front, flipped, right]),
    );

    expect(result.warnings.some((w) => /mirrored/i.test(w))).toBe(true);
  });

  it("creates a preview that carries the mesh and the per-view landmark counts", async () => {
    const truth = deformedShape(canonical);
    const photos = photoMap([
      synthesisePhoto("front", truth, canonical.vertexCount, yaw(0.05), 26),
      synthesisePhoto("left-profile", truth, canonical.vertexCount, leftProfileRotation(), 26),
    ]);

    const result = await reconstructFaceFromMultiView(photos);
    const preview = createReconstructionPreview(photos, result);

    expect(preview.canonicalShape).not.toBeNull();
    expect(preview.canonicalIndices).not.toBeNull();
    expect(preview.canonicalIndices!.length).toBe(canonical.triangleCount * 3);
    expect(preview.landmarkCounts.get("front")).toBe(canonical.vertexCount);
    expect(preview.landmarkCounts.get("left-profile")).toBe(canonical.vertexCount);
    expect(preview.landmarkCounts.has("right-profile")).toBe(false);
  });
});

describe("shape transfer onto the simulation head", () => {
  const canonical = loadCanonical();

  function neutralHeadPositions(): Float32Array {
    const geometry = createHeadGeometry();
    const attribute = geometry.getAttribute("position");
    const positions = new Float32Array(attribute.array as ArrayLike<number>);
    geometry.dispose();
    return positions;
  }

  /** Index of the head vertex closest to a facial coordinate (x, y). */
  function nearestVertex(positions: Float32Array, x: number, y: number): number {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < positions.length / 3; i += 1) {
      const dx = positions[i * 3] - x;
      const dy = positions[i * 3 + 1] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistance) {
        bestDistance = d2;
        best = i;
      }
    }
    return best;
  }

  it("moves the nose forward and leaves the back of the head untouched", () => {
    const truth = deformedShape(canonical);
    const positions = neutralHeadPositions();
    const started = Date.now();
    const model = buildPersonalizedHeadModel(canonical, truth, positions);
    const elapsed = Date.now() - started;

    // The transfer has to be fast enough to run interactively when the user
    // accepts a reconstruction.
    expect(elapsed).toBeLessThan(2000);
    expect(model.vertexCount).toBe(positions.length / 3);

    const noseVertex = nearestVertex(positions, 0, -0.16);
    const backVertex = nearestVertex(positions, 0, 0);
    // The back of the head is the vertex with the smallest z.
    let backMost = 0;
    for (let i = 0; i < positions.length / 3; i += 1) {
      if (positions[i * 3 + 2] < positions[backMost * 3 + 2]) backMost = i;
    }

    // The nose has to move anteriorly (positive z in scene space).
    expect(model.displacement[noseVertex * 3 + 2]).toBeGreaterThan(0.01);

    // The crown / back of the head is outside the reconstructed patch and
    // must not move at all.
    expect(Math.abs(model.displacement[backMost * 3 + 2])).toBeLessThan(1e-6);
    expect(Math.abs(model.displacement[backMost * 3 + 1])).toBeLessThan(1e-6);
    expect(model.coverage[backMost]).toBe(0);

    // The coverage must fade towards the rim of the canonical patch instead of
    // creating a hard step.
    let maxCoverage = 0;
    for (let i = 0; i < model.coverage.length; i += 1) {
      if (model.coverage[i] > maxCoverage) maxCoverage = model.coverage[i];
    }
    expect(maxCoverage).toBeGreaterThan(0.5);
    expect(maxCoverage).toBeLessThanOrEqual(1.0001);
  }, 30000);

  it("changes the rendered head geometry and leaves the default head untouched", () => {
    const truth = deformedShape(canonical);
    const positions = neutralHeadPositions();
    const model = buildPersonalizedHeadModel(canonical, truth, positions);

    const neutral = createHeadGeometry();
    const personalized = createHeadGeometry(undefined, undefined, undefined, model);
    const neutralAttribute = neutral.getAttribute("position");
    const personalizedAttribute = personalized.getAttribute("position");

    let maxDifference = 0;
    for (let i = 0; i < neutralAttribute.count; i += 1) {
      const d = Math.abs(
        neutralAttribute.getZ(i) - personalizedAttribute.getZ(i),
      );
      if (d > maxDifference) maxDifference = d;
    }
    expect(maxDifference).toBeGreaterThan(0.01);

    // Without a personalized model the geometry is byte-identical to before.
    const again = createHeadGeometry();
    const againAttribute = again.getAttribute("position");
    for (let i = 0; i < neutralAttribute.count; i += 1) {
      expect(againAttribute.getX(i)).toBeCloseTo(neutralAttribute.getX(i), 6);
      expect(againAttribute.getY(i)).toBeCloseTo(neutralAttribute.getY(i), 6);
      expect(againAttribute.getZ(i)).toBeCloseTo(neutralAttribute.getZ(i), 6);
    }

    neutral.dispose();
    personalized.dispose();
    again.dispose();
  }, 30000);
});

describe("reconstruction preview projection", () => {
  const canonical = loadCanonical();

  it("projects the mesh from the front and from both profiles", () => {
    const front = projectCanonicalMesh(canonical.positions, canonical.indices, "front");
    expect(front.triangles.length).toBe(canonical.triangleCount);
    for (const triangle of front.triangles) {
      expect(triangle.points.length).toBe(3);
      for (const [x, y] of triangle.points) {
        expect(x).toBeGreaterThanOrEqual(-0.001);
        expect(x).toBeLessThanOrEqual(1.001);
        expect(y).toBeGreaterThanOrEqual(-0.001);
        expect(y).toBeLessThanOrEqual(1.001);
      }
      expect(triangle.shade).toBeGreaterThanOrEqual(0);
      expect(triangle.shade).toBeLessThanOrEqual(1);
    }

    const left = projectCanonicalMesh(canonical.positions, canonical.indices, "left");
    const right = projectCanonicalMesh(canonical.positions, canonical.indices, "right");
    expect(left.triangles.length).toBe(canonical.triangleCount);
    expect(right.triangles.length).toBe(canonical.triangleCount);

    // The nose tip marker must sit on the opposite side in the two profiles.
    const leftTip = left.markers.find((m) => m.label === "Nose tip")!;
    const rightTip = right.markers.find((m) => m.label === "Nose tip")!;
    expect(leftTip.x).toBeLessThan(0.5);
    expect(rightTip.x).toBeGreaterThan(0.5);
  });
});
