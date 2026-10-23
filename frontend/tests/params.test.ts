import { describe, expect, it } from "vitest";
import {
  PARAM_DESCRIPTORS,
  PARAM_GROUPS,
  descriptorFor,
  descriptorsForGroup,
  paramKeyFor,
} from "../src/lib/params";
import { SIMULATED_PARAM_KEYS } from "../src/scene/transformations/types";
import { resetModel } from "../src/scene/transformations/logic";

const descriptors = Object.values(PARAM_DESCRIPTORS);

describe("parameter registry", () => {
  it("defines exactly the intended multi-region parameters", () => {
    expect(Object.keys(PARAM_DESCRIPTORS).sort()).toEqual(
      [
        "bridgeHeight",
        "bridgeWidth",
        "tipHeight",
        "tipProjection",
        "tipRotation",
        "alarWidth",
        "upperLipProjection",
        "upperLipFullness",
        "lowerLipProjection",
        "lowerLipFullness",
        "chinProjection",
        "chinHeight",
        "chinWidth",
        "jawWidth",
        "jawDefinition",
        "cheekProjection",
        "cheekFullness",
      ].sort(),
    );
  });

  it("uses unique keys that match their registry entry", () => {
    const keys = descriptors.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of descriptors) {
      expect(descriptorFor(d.key)).toBe(d);
    }
  });

  it("uses a valid unit for every parameter", () => {
    for (const d of descriptors) {
      expect(["mm", "degrees"]).toContain(d.unit);
    }
    expect(descriptorFor("tipRotation").unit).toBe("degrees");
    expect(descriptorFor("alarWidth").unit).toBe("mm");
  });

  it("has ordered, finite bounds with a positive step and zero default", () => {
    const defaults = resetModel() as Record<string, number>;
    for (const d of descriptors) {
      expect(Number.isFinite(d.min)).toBe(true);
      expect(Number.isFinite(d.max)).toBe(true);
      expect(d.min).toBeLessThan(0);
      expect(d.max).toBeGreaterThan(0);
      expect(d.step).toBeGreaterThan(0);
      expect(d.min).toBeLessThan(d.max);
      expect(defaults[d.key]).toBe(0);
    }
  });

  it("maps every descriptor to a supported parser target/parameter pair", () => {
    for (const d of descriptors) {
      expect(paramKeyFor(d.target, d.parameter)).toBe(d.key);
    }
  });

  it("groups every descriptor and orders the groups for the panel", () => {
    expect(PARAM_GROUPS.map((g) => g.id)).toEqual([
      "nose",
      "lips",
      "chin",
      "jawline",
      "cheeks",
    ]);
    const grouped = PARAM_GROUPS.flatMap((g) =>
      descriptorsForGroup(g.id).map((d) => d.key),
    );
    expect(grouped.sort()).toEqual(descriptors.map((d) => d.key).sort());
    expect(descriptorsForGroup("nose").map((d) => d.key)).toEqual([
      "bridgeHeight",
      "bridgeWidth",
      "tipProjection",
      "tipHeight",
      "tipRotation",
      "alarWidth",
    ]);
    expect(descriptorsForGroup("cheeks").map((d) => d.key)).toEqual([
      "cheekProjection",
      "cheekFullness",
    ]);
  });

  it("exposes every descriptor in the panel key list", () => {
    for (const d of descriptors) {
      expect(SIMULATED_PARAM_KEYS).toContain(d.key);
      expect(d.manual).toBe(true);
    }
  });
});

describe("paramKeyFor", () => {
  it("maps the alar width independently of the bridge width", () => {
    expect(paramKeyFor("nostril_region", "width")).toBe("alarWidth");
    expect(paramKeyFor("nasal_bridge", "width")).toBe("bridgeWidth");
  });

  it("maps each tip operation to a distinct field", () => {
    expect(paramKeyFor("nasal_tip", "height")).toBe("tipHeight");
    expect(paramKeyFor("nasal_tip", "projection")).toBe("tipProjection");
    expect(paramKeyFor("nasal_tip", "rotation")).toBe("tipRotation");
  });

  it("treats the dorsum as the bridge region", () => {
    expect(paramKeyFor("nasal_dorsum", "height")).toBe("bridgeHeight");
    expect(paramKeyFor("nasal_dorsum", "width")).toBe("bridgeWidth");
  });

  it("refuses unsupported combinations instead of guessing", () => {
    expect(paramKeyFor("nasal_tip", "width")).toBeNull();
    expect(paramKeyFor("nostril_region", "height")).toBeNull();
    expect(paramKeyFor("nostril_region", "rotation")).toBeNull();
    expect(paramKeyFor("nasal_bridge", "projection")).toBeNull();
    expect(paramKeyFor(null, "width")).toBeNull();
    expect(paramKeyFor("nasal_bridge", null)).toBeNull();
  });
});
