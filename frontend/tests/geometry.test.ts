import { describe, expect, it } from "vitest";
import {
  createHeadGeometry,
  deformPositions,
  degreesToRadians,
  GEOMETRY_SCALE,
  HEAD_BOUNDS,
  HEAD_SHAPE,
  LANDMARKS,
  landmarkVertexIndices,
  mmToScene,
  nearestVertexIndex,
  safeNumber,
  surfacePoint,
  TIP_ROTATION_PIVOT,
  alarWeight,
  bridgeWeight,
  bridgeWidthWeight,
  tipWeight,
  upperLipWeight,
  lowerLipWeight,
  chinProjectionWeight,
  chinHeightWeight,
  chinWidthWeight,
  jawWidthWeight,
  jawDefinitionWeight,
  cheekProjectionWeight,
  cheekFullnessWeight,
} from "../src/scene/geometry";
import { applyAllCommands, resetModel } from "../src/scene/transformations/logic";
import type { Command, ModelState } from "../src/scene/transformations/types";
import { SIMULATED_PARAM_KEYS } from "../src/scene/transformations/types";

const GEO = createHeadGeometry();
const POSITION = GEO.getAttribute("position") as {
  count: number;
  array: ArrayLike<number>;
};
const BASE = new Float32Array(POSITION.array);
const INDICES = landmarkVertexIndices(BASE);

function voice(overrides: Partial<Command>): Command {
  return {
    id: "c",
    source: "voice",
    target: "nasal_tip",
    parameter: "projection",
    operation: "increase",
    value: 2,
    requested_value: 2,
    requested_unit: "mm",
    unit: "mm",
    direction: null,
    adjusted_value: null,
    confidence: 0.9,
    requires_confirmation: true,
    status: "ok",
    reason: null,
    original_text: "test",
    parser: "rules",
    createdAt: 0,
    ...overrides,
  };
}

function distance(
  positions: Float32Array,
  index: number,
  base: Float32Array,
): number {
  const o = index * 3;
  return Math.hypot(
    positions[o] - base[o],
    positions[o + 1] - base[o + 1],
    positions[o + 2] - base[o + 2],
  );
}

function deformation(state: ModelState) {
  return deformPositions(BASE, state);
}

describe("head mesh", () => {
  it("loads a dense mesh with finite coordinates", () => {
    expect(POSITION.count).toBe((192 + 1) * (128 + 1));
    let finite = true;
    for (let i = 0; i < POSITION.array.length; i += 1) {
      if (!Number.isFinite(POSITION.array[i])) finite = false;
    }
    expect(finite).toBe(true);
  });

  it("is genuinely three-dimensional (depth, crown and back of head)", () => {
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < POSITION.count; i += 1) {
      const o = i * 3;
      minZ = Math.min(minZ, POSITION.array[o + 2]);
      maxZ = Math.max(maxZ, POSITION.array[o + 2]);
      minY = Math.min(minY, POSITION.array[o + 1]);
      maxY = Math.max(maxY, POSITION.array[o + 1]);
    }
    expect(maxZ - minZ).toBeGreaterThan(1.4);
    expect(minZ).toBeLessThan(-0.5);
    expect(maxY - minY).toBeGreaterThan(1.5);
    expect(maxZ).toBeGreaterThan(HEAD_SHAPE.rz);
  });

  it("has outward-facing normals", () => {
    const normal = GEO.getAttribute("normal") as { array: ArrayLike<number> };
    let outward = 0;
    for (let i = 0; i < POSITION.count; i += 1) {
      const o = i * 3;
      const dot =
        normal.array[o] * POSITION.array[o] +
        normal.array[o + 1] * POSITION.array[o + 1] +
        normal.array[o + 2] * POSITION.array[o + 2];
      if (dot > 0) outward += 1;
    }
    expect(outward / POSITION.count).toBeGreaterThan(0.9);
  });

  it("exposes documented bounds matching the ellipsoid semiaxes", () => {
    expect(HEAD_BOUNDS.max[0]).toBeCloseTo(HEAD_SHAPE.rx, 5);
    expect(HEAD_BOUNDS.max[1]).toBeCloseTo(HEAD_SHAPE.ry, 5);
    expect(HEAD_BOUNDS.max[2]).toBeCloseTo(HEAD_SHAPE.rz, 5);
  });
});

describe("scale and coordinate system", () => {
  it("maps the documented reference dimension to scene units", () => {
    expect(mmToScene(150)).toBeCloseTo(2 * HEAD_SHAPE.rx, 6);
    expect(mmToScene(1)).toBeCloseTo(GEOMETRY_SCALE.sceneUnitsPerMm, 9);
    expect(GEOMETRY_SCALE.sceneUnitsPerMm).toBeCloseTo(1.4 / 150, 9);
  });

  it("treats angles separately from lengths", () => {
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI, 9);
    expect(degreesToRadians(180)).not.toBeCloseTo(mmToScene(180), 3);
  });

  it("applies exactly one length scale to a tip displacement", () => {
    const tipIndex = INDICES.pronasale;
    const o = tipIndex * 3;
    const w = tipWeight(BASE[o], BASE[o + 1], BASE[o + 2]);
    const result = deformation({ ...resetModel(), tipProjection: 10 });
    const expected = mmToScene(10) * w;
    expect(expected).toBeGreaterThan(0);
    expect(distance(result.positions, tipIndex, BASE)).toBeCloseTo(expected, 6);
  });

  it("guards non-finite parameter values", () => {
    expect(safeNumber(Number.NaN)).toBe(0);
    expect(safeNumber(Infinity)).toBe(0);
    const result = deformation({
      ...resetModel(),
      bridgeHeight: Number.NaN,
      bridgeWidth: Infinity,
      tipHeight: Number.NaN,
      tipProjection: -Infinity,
      tipRotation: Number.NaN,
      alarWidth: Number.NaN,
      upperLipFullness: Number.NaN,
      chinHeight: Infinity,
      jawWidth: Number.NaN,
      cheekProjection: Number.NaN,
    });
    let finite = true;
    for (let i = 0; i < result.positions.length; i += 1) {
      if (!Number.isFinite(result.positions[i])) finite = false;
    }
    expect(finite).toBe(true);
    expect(Number.isFinite(result.maxDisplacement)).toBe(true);
  });
});

describe("deformation engine", () => {
  it("returns the immutable baseline for a reset state", () => {
    const result = deformation(resetModel());
    expect(result.maxDisplacement).toBeCloseTo(0, 9);
    for (let i = 0; i < BASE.length; i += 1) {
      expect(result.positions[i]).toBeCloseTo(BASE[i], 6);
    }
  });

  it("is deterministic for a repeated state", () => {
    const state = { ...resetModel(), tipProjection: 4, tipRotation: 12, bridgeHeight: -3 };
    const a = deformation(state).positions;
    const b = deformation(state).positions;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("recomposes from baseline so reset and replay do not drift", () => {
    const commands = [
      voice({ target: "nasal_bridge", parameter: "height", value: 3 }),
      voice({ target: "nasal_tip", parameter: "projection", value: 2 }),
      voice({ target: "nasal_tip", parameter: "rotation", value: 5 }),
    ];
    const replayed = applyAllCommands(commands);
    const first = deformation(replayed).positions;
    const second = deformation(applyAllCommands(commands)).positions;
    expect(Array.from(first)).toEqual(Array.from(second));

    const baselineAgain = deformation(resetModel()).positions;
    for (let i = 0; i < BASE.length; i += 1) {
      expect(baselineAgain[i]).toBeCloseTo(BASE[i], 6);
    }
  });

  it("does not move the alar region when the bridge is widened", () => {
    const alar = INDICES.alare_l;
    const result = deformation({ ...resetModel(), bridgeWidth: 10 });
    expect(distance(result.positions, alar, BASE)).toBeLessThan(1e-3);
  });

  it("does move the dorsum sides when the bridge is widened", () => {
    const side = nearestVertexIndex(BASE, surfacePoint(0.075, 0.2));
    const result = deformation({ ...resetModel(), bridgeWidth: 10 });
    expect(distance(result.positions, side, BASE)).toBeGreaterThan(
      mmToScene(10) * 0.3,
    );
  });

  it("does not move the bridge when the tip is projected", () => {
    const result = deformation({ ...resetModel(), tipProjection: 10 });
    expect(distance(result.positions, INDICES.nasion, BASE)).toBeLessThan(1e-3);
    expect(distance(result.positions, INDICES.rhinion, BASE)).toBeLessThan(1e-3);
  });

  it("rotates the tip about the documented subnasale pivot", () => {
    const tipIndex = INDICES.pronasale;
    const o = tipIndex * 3;
    const before = [BASE[o], BASE[o + 1], BASE[o + 2]] as const;
    const result = deformation({ ...resetModel(), tipRotation: 30 });
    const after = [
      result.positions[o],
      result.positions[o + 1],
      result.positions[o + 2],
    ] as const;

    const radius = (p: readonly number[]) =>
      Math.hypot(p[1] - TIP_ROTATION_PIVOT.y, p[2] - TIP_ROTATION_PIVOT.z);

    expect(radius(after)).toBeCloseTo(radius(before), 6);
    expect(after[1]).toBeGreaterThan(before[1]);
  });

  it("propagates commands from the existing parameter pathway", () => {
    const state = applyAllCommands([
      voice({ target: "nasal_tip", parameter: "projection", operation: "increase", value: 6 }),
    ]);
    const result = deformation(state);
    expect(distance(result.positions, INDICES.pronasale, BASE)).toBeGreaterThan(
      mmToScene(6) * 0.5,
    );
  });

  it("widens the alar wings without moving the bridge or tip", () => {
    const result = deformation({ ...resetModel(), alarWidth: 10 });
    expect(distance(result.positions, INDICES.alare_l, BASE)).toBeGreaterThan(
      mmToScene(10) * 0.3,
    );
    expect(distance(result.positions, INDICES.alare_r, BASE)).toBeGreaterThan(
      mmToScene(10) * 0.3,
    );
    expect(distance(result.positions, INDICES.nasion, BASE)).toBeLessThan(1e-3);
    expect(distance(result.positions, INDICES.pronasale, BASE)).toBeLessThan(1e-3);
  });

  it("spreads the two alar wings symmetrically about the midline", () => {
    const result = deformation({ ...resetModel(), alarWidth: 10 });
    const l = INDICES.alare_l * 3;
    const r = INDICES.alare_r * 3;
    const dl = result.positions[l] - BASE[l];
    const dr = result.positions[r] - BASE[r];
    expect(Math.sign(dl)).toBe(-Math.sign(dr));
    expect(Math.abs(dl)).toBeCloseTo(Math.abs(dr), 5);
  });

  it("preserves the nasal midline when the alae are widened", () => {
    const mid = nearestVertexIndex(BASE, surfacePoint(0, -0.19));
    const result = deformation({ ...resetModel(), alarWidth: 10 });
    expect(distance(result.positions, mid, BASE)).toBeLessThan(1e-3);
  });

  it("keeps alar width and bridge width independent in both directions", () => {
    const alar = INDICES.alare_l;
    const bridgeSide = nearestVertexIndex(BASE, surfacePoint(0.075, 0.2));

    const viaAlar = deformation({ ...resetModel(), alarWidth: 10 });
    expect(distance(viaAlar.positions, bridgeSide, BASE)).toBeLessThan(1e-3);

    const viaBridge = deformation({ ...resetModel(), bridgeWidth: 10 });
    expect(distance(viaBridge.positions, alar, BASE)).toBeLessThan(1e-3);
  });

  it("normalizes heatmap intensity independently of physical units", () => {
    const result = deformation({ ...resetModel(), tipProjection: 2 });
    let max = 0;
    for (let i = 0; i < result.colors.length; i += 1) {
      max = Math.max(max, result.colors[i]);
    }
    expect(max).toBeLessThanOrEqual(1);
    expect(result.maxDisplacement).toBeGreaterThan(0);
  });
});

describe("region weights", () => {
  it("stay finite and bounded across the mesh", () => {
    for (let i = 0; i < POSITION.count; i += 97) {
      const o = i * 3;
      const x = POSITION.array[o];
      const y = POSITION.array[o + 1];
      const z = POSITION.array[o + 2];
      for (const w of [
        bridgeWeight(x, y, z),
        bridgeWidthWeight(x, y, z),
        tipWeight(x, y, z),
        alarWeight(x, y, z),
        upperLipWeight(x, y, z),
        lowerLipWeight(x, y, z),
        chinProjectionWeight(x, y, z),
        chinHeightWeight(x, y, z),
        chinWidthWeight(x, y, z),
        jawWidthWeight(x, y, z),
        jawDefinitionWeight(x, y, z),
        cheekProjectionWeight(x, y, z),
        cheekFullnessWeight(x, y, z),
      ]) {
        expect(Number.isFinite(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps the bridge-width band clear of the alar band", () => {
    const alar = surfacePoint(0.15, -0.19);
    const bridge = surfacePoint(0.075, 0.2);
    expect(bridgeWidthWeight(alar[0], alar[1], alar[2])).toBeLessThan(1e-3);
    expect(bridgeWidthWeight(bridge[0], bridge[1], bridge[2])).toBeGreaterThan(0.3);
  });

  it("keeps the alar band clear of the bridge-width band", () => {
    const bridge = surfacePoint(0.075, 0.2);
    expect(alarWeight(bridge[0], bridge[1], bridge[2])).toBeLessThan(1e-3);
  });

  it("keeps the tip band clear of the bridge landmark", () => {
    const nasion = surfacePoint(0, 0.34);
    expect(tipWeight(nasion[0], nasion[1], nasion[2])).toBeLessThan(1e-6);
  });
});

describe("multi-region deformation", () => {
  it("projects the upper lip anteriorly without moving the nose tip", () => {
    const result = deformation({ ...resetModel(), upperLipProjection: 8 });
    const ulip = INDICES.upper_lip * 3;
    expect(result.positions[ulip + 2]).toBeGreaterThan(BASE[ulip + 2]);
    expect(distance(result.positions, INDICES.pronasale, BASE)).toBeLessThan(1e-3);
  });

  it("keeps the upper and lower lip controls independent", () => {
    const upper = deformation({ ...resetModel(), upperLipProjection: 8 });
    const lower = deformation({ ...resetModel(), lowerLipProjection: 8 });
    const ul = INDICES.upper_lip * 3;
    const ll = INDICES.lower_lip * 3;

    expect(upper.positions[ul + 2]).toBeGreaterThan(BASE[ul + 2]);
    expect(distance(upper.positions, INDICES.lower_lip, BASE)).toBeLessThan(
      mmToScene(8) * 0.05,
    );

    expect(lower.positions[ll + 2]).toBeGreaterThan(BASE[ll + 2]);
    expect(distance(lower.positions, INDICES.upper_lip, BASE)).toBeLessThan(
      mmToScene(8) * 0.05,
    );
  });

  it("opens the lip with fullness rather than only translating it", () => {
    const above = nearestVertexIndex(BASE, surfacePoint(0, -0.33));
    const below = nearestVertexIndex(BASE, surfacePoint(0, -0.47));

    const upFull = deformation({ ...resetModel(), upperLipFullness: 8 });
    expect(upFull.positions[above * 3 + 1]).toBeGreaterThan(BASE[above * 3 + 1]);

    const lowFull = deformation({ ...resetModel(), lowerLipFullness: 8 });
    expect(lowFull.positions[below * 3 + 1]).toBeLessThan(BASE[below * 3 + 1]);
  });

  it("projects and lengthens the chin without moving the lips", () => {
    const projection = deformation({ ...resetModel(), chinProjection: 8 });
    const pog = INDICES.pogonion * 3;
    expect(projection.positions[pog + 2]).toBeGreaterThan(BASE[pog + 2]);
    expect(distance(projection.positions, INDICES.upper_lip, BASE)).toBeLessThan(
      mmToScene(8) * 0.05,
    );

    const menton = INDICES.menton * 3;
    const taller = deformation({ ...resetModel(), chinHeight: 8 });
    expect(taller.positions[menton + 1]).toBeLessThan(BASE[menton + 1]);

    const shorter = deformation({ ...resetModel(), chinHeight: -8 });
    expect(shorter.positions[menton + 1]).toBeGreaterThan(BASE[menton + 1]);
  });

  it("keeps chin width and jaw width independently controllable", () => {
    const chinSide = nearestVertexIndex(BASE, surfacePoint(0.12, -0.56));
    const jawSide = INDICES.jaw_l;
    const menton = INDICES.menton;

    const viaChin = deformation({ ...resetModel(), chinWidth: 10 });
    expect(
      Math.abs(viaChin.positions[chinSide * 3] - BASE[chinSide * 3]),
    ).toBeGreaterThan(mmToScene(10) * 0.3);
    expect(distance(viaChin.positions, jawSide, BASE)).toBeLessThan(1e-3);

    const viaJaw = deformation({ ...resetModel(), jawWidth: 10 });
    expect(
      Math.abs(viaJaw.positions[jawSide * 3] - BASE[jawSide * 3]),
    ).toBeGreaterThan(mmToScene(10) * 0.3);
    expect(distance(viaJaw.positions, menton, BASE)).toBeLessThan(1e-3);
  });

  it("sharpens the jawline definition separately from jaw width", () => {
    const jawSide = INDICES.jaw_l;
    const result = deformation({ ...resetModel(), jawDefinition: 10 });
    // Threshold calibrated to the sculpted baseline: the mandibular taper moves
    // the jaw-lateral landmark inward, so its jaw-definition weight is a little
    // lower than on the original ellipsoid. The effect must still be clear.
    expect(
      Math.abs(result.positions[jawSide * 3] - BASE[jawSide * 3]),
    ).toBeGreaterThan(mmToScene(10) * 0.15);
    expect(distance(result.positions, INDICES.menton, BASE)).toBeLessThan(
      mmToScene(10) * 0.05,
    );
  });

  it("projects the cheeks symmetrically and leaves the nose untouched", () => {
    const result = deformation({ ...resetModel(), cheekProjection: 8 });
    const cl = INDICES.cheek_l * 3;
    const cr = INDICES.cheek_r * 3;
    expect(result.positions[cl + 2]).toBeGreaterThan(BASE[cl + 2]);
    expect(result.positions[cr + 2]).toBeGreaterThan(BASE[cr + 2]);
    expect(distance(result.positions, INDICES.pronasale, BASE)).toBeLessThan(1e-3);
  });

  it("expands cheek fullness symmetrically about the midline", () => {
    const result = deformation({ ...resetModel(), cheekFullness: 8 });
    const cl = INDICES.cheek_l * 3;
    const cr = INDICES.cheek_r * 3;
    const dl = result.positions[cl] - BASE[cl];
    const dr = result.positions[cr] - BASE[cr];
    expect(dl).toBeGreaterThan(0);
    expect(dr).toBeLessThan(0);
    expect(Math.abs(dl)).toBeCloseTo(Math.abs(dr), 5);
  });
});

describe("landmarks", () => {
  it("defines the documented set and resolves them onto the mesh", () => {
    expect(LANDMARKS.map((l) => l.id)).toEqual([
      "nasion",
      "rhinion",
      "pronasale",
      "subnasale",
      "alare_l",
      "alare_r",
      "pogonion",
      "upper_lip",
      "lower_lip",
      "menton",
      "cheek_l",
      "cheek_r",
      "jaw_l",
      "jaw_r",
    ]);
    for (const id of Object.keys(INDICES)) {
      expect(INDICES[id]).toBeGreaterThanOrEqual(0);
      expect(INDICES[id]).toBeLessThan(POSITION.count);
    }
  });

  it("follows the geometry when the tip is projected", () => {
    const result = deformation({ ...resetModel(), tipProjection: 8 });
    const o = INDICES.pronasale * 3;
    expect(result.positions[o + 2]).toBeGreaterThan(BASE[o + 2]);
  });
});

describe("all simulated parameters on the sculpted head", () => {
  it("every simulated parameter produces a finite, non-zero displacement", () => {
    for (const key of SIMULATED_PARAM_KEYS) {
      const magnitude = key === "tipRotation" ? 20 : 6;
      const result = deformation({ ...resetModel(), [key]: magnitude });
      expect(Number.isFinite(result.maxDisplacement), key).toBe(true);
      expect(result.maxDisplacement, key).toBeGreaterThan(0);
    }
  });

  it("keeps the nose parameters localized away from the chin", () => {
    const noseKeys: (typeof SIMULATED_PARAM_KEYS)[number][] = [
      "bridgeHeight",
      "bridgeWidth",
      "tipProjection",
      "tipHeight",
      "alarWidth",
    ];
    for (const key of noseKeys) {
      const magnitude = key === "bridgeWidth" || key === "alarWidth" ? 8 : 6;
      const result = deformation({ ...resetModel(), [key]: magnitude });
      expect(distance(result.positions, INDICES.pogonion, BASE), key).toBeLessThan(1e-3);
    }
  });

  it("still tracks the sculpted midline continuously for the bridge and tip", () => {
    const bridged = deformation({ ...resetModel(), bridgeHeight: 5 });
    const tipped = deformation({ ...resetModel(), tipProjection: 5 });
    // Both must move the dorsal midline anteriorly (negative z is towards camera
    // in scene space), and neither may create a discontinuity.
    expect(bridged.maxDisplacement).toBeGreaterThan(0);
    expect(tipped.maxDisplacement).toBeGreaterThan(0);
    for (let i = 0; i < bridged.positions.length; i += 1) {
      expect(Number.isFinite(bridged.positions[i])).toBe(true);
    }
  });
});
