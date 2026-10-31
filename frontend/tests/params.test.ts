import { describe, expect, it } from "vitest";
import {
  PARAM_DESCRIPTORS,
  PARAM_GROUPS,
  descriptorFor,
  descriptorsForGroup,
  paramKeyFor,
  paramKeyForInstruction,
} from "../src/lib/params";
import {
  CLINICAL_PARAMETERS,
  REGISTERED_NOT_SIMULATED_PARAMETERS,
  SIMULATED_CLINICAL_PARAMETERS,
  clinicalParameterFor,
  modelFieldForClinicalKey,
  uniqueClinicalParameterForPair,
} from "../src/lib/clinicalRegistry";
import { SIMULATED_PARAM_KEYS } from "../src/scene/transformations/types";
import { resetModel } from "../src/scene/transformations/logic";

const descriptors = Object.values(PARAM_DESCRIPTORS);

const SIMULATED_FIELDS = [
  "alarWidth",
  "bridgeHeight",
  "bridgeWidth",
  "cheekFullness",
  "cheekProjection",
  "chinHeight",
  "chinProjection",
  "chinWidth",
  "jawDefinition",
  "jawWidth",
  "lowerLipFullness",
  "lowerLipProjection",
  "tipHeight",
  "tipProjection",
  "tipRotation",
  "upperLipFullness",
  "upperLipProjection",
];

describe("parameter registry", () => {
  it("exposes only the 17 geometry-backed controls", () => {
    expect(Object.keys(PARAM_DESCRIPTORS).sort()).toEqual(SIMULATED_FIELDS);
    expect([...SIMULATED_PARAM_KEYS].sort()).toEqual(SIMULATED_FIELDS);
    expect(descriptors).toHaveLength(17);
  });

  it("keeps the clinical catalogue complete and internally consistent", () => {
    expect(CLINICAL_PARAMETERS).toHaveLength(59);
    expect(SIMULATED_CLINICAL_PARAMETERS).toHaveLength(17);
    expect(REGISTERED_NOT_SIMULATED_PARAMETERS).toHaveLength(42);
    expect(new Set(CLINICAL_PARAMETERS.map((p) => p.key)).size).toBe(
      CLINICAL_PARAMETERS.length,
    );

    for (const parameter of SIMULATED_CLINICAL_PARAMETERS) {
      expect(parameter.simulation.modelField).not.toBeNull();
      expect(parameter.simulation.driver).toBeTruthy();
      expect(parameter.reviewable).toBe(true);
      expect(parameter.parser.status).toBe("supported");
    }
    for (const parameter of REGISTERED_NOT_SIMULATED_PARAMETERS) {
      expect(parameter.simulation.modelField).toBeNull();
      expect(parameter.simulation.driver).toBeNull();
      expect(parameter.reviewable).toBe(true);
    }
  });

  it("links every simulated descriptor to exactly one clinical entry", () => {
    const clinicalKeys = new Set<string>();
    for (const d of descriptors) {
      const clinical = clinicalParameterFor(d.clinicalKey);
      expect(clinical).not.toBeNull();
      expect(clinical?.simulation.status).toBe("simulated");
      expect(clinical?.simulation.modelField).toBe(d.key);
      expect(clinical?.parser.target).toBe(d.target);
      expect(clinical?.parser.parameter).toBe(d.parameter);
      expect(clinicalKeys.has(d.clinicalKey)).toBe(false);
      clinicalKeys.add(d.clinicalKey);
      expect(modelFieldForClinicalKey(d.clinicalKey)).toBe(d.key);
    }
  });

  it("uses a valid unit for every simulated parameter", () => {
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
      expect(d.max).toBeGreaterThan(0);
      expect(d.step).toBeGreaterThan(0);
      expect(d.min).toBeLessThan(d.max);
      expect(defaults[d.key]).toBe(0);
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

  it("refuses to resolve descriptors without a geometry driver", () => {
    expect(() => descriptorFor("alarFlare")).toThrow(/no verified geometry driver/);
    expect(() => descriptorFor("dorsalHumpReduction")).toThrow(
      /no verified geometry driver/,
    );
  });
});

describe("clinical concept resolution", () => {
  it("maps a simulated concept to its model field", () => {
    expect(modelFieldForClinicalKey("bridge_height")).toBe("bridgeHeight");
    expect(modelFieldForClinicalKey("alar_width")).toBe("alarWidth");
    expect(modelFieldForClinicalKey("jawline_definition")).toBe("jawDefinition");
  });

  it("never maps a registered-only concept to a model field", () => {
    for (const key of [
      "alar_flare",
      "alar_base_width",
      "dorsal_hump_reduction",
      "tip_definition",
      "nasolabial_angle",
      "lip_asymmetry",
      "facial_thirds",
    ]) {
      expect(clinicalParameterFor(key)).not.toBeNull();
      expect(modelFieldForClinicalKey(key)).toBeNull();
      expect(paramKeyForInstruction({ target: null, parameter: null, clinical_parameter: key })).toBeNull();
    }
  });

  it("does not resolve genuinely ambiguous target/parameter pairs", () => {
    expect(uniqueClinicalParameterForPair("nostril_region", "width")).toBeNull();
    expect(uniqueClinicalParameterForPair("jawline", "definition")).toBeNull();
    expect(uniqueClinicalParameterForPair("chin", "projection")?.key).toBe(
      "chin_projection",
    );
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
    expect(paramKeyFor("nasal_tip", "definition")).toBeNull();
    expect(paramKeyFor("jawline", "rotation")).toBeNull();
    expect(paramKeyFor(null, "width")).toBeNull();
    expect(paramKeyFor("nasal_bridge", null)).toBeNull();
  });
});

describe("paramKeyForInstruction", () => {
  it("prefers the clinical key over a broad legacy pair", () => {
    expect(
      paramKeyForInstruction({
        target: "nostril_region",
        parameter: "width",
        clinical_parameter: "alar_flare",
      }),
    ).toBeNull();
    expect(
      paramKeyForInstruction({
        target: "nostril_region",
        parameter: "width",
        clinical_parameter: "alar_width",
      }),
    ).toBe("alarWidth");
  });

  it("falls back to the simulated pair only when no clinical key exists", () => {
    expect(
      paramKeyForInstruction({
        target: "nostril_region",
        parameter: "width",
        clinical_parameter: null,
      }),
    ).toBe("alarWidth");
    expect(
      paramKeyForInstruction({
        target: "nasal_tip",
        parameter: "definition",
        clinical_parameter: null,
      }),
    ).toBeNull();
  });
});
