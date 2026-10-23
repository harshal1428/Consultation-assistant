import type {
  ModelField,
  Operation,
  ParamKey,
  Parameter,
  TargetRegion,
  Unit,
} from "../scene/transformations/types";

/**
 * ---------------------------------------------------------------------------
 * Central multi-region parameter registry (Phase 5, extended in Phase 7)
 * ---------------------------------------------------------------------------
 * Single documented source of truth for every supported control. The geometry
 * engine, the parameter panel and the command mapping all read from this
 * registry, so the UI, the parser contract and the geometry can never disagree
 * about a parameter.
 *
 * Each entry declares: a unique canonical key, its canonical target region and
 * parameter name, its unit, bounds, default value, direction semantics, the
 * named geometry deformation it drives, its supported operations and its
 * explicit support status.
 *
 * These are prototype interaction bounds and illustrative units, NOT medically
 * approved limits or clinically accurate millimetres.
 */

export type ParamGroup = "nose" | "lips" | "chin" | "jawline" | "cheeks";

export interface ParamGroupMeta {
  id: ParamGroup;
  label: string;
  description: string;
}

export const PARAM_GROUPS: ParamGroupMeta[] = [
  {
    id: "nose",
    label: "Nose",
    description: "Bridge depth/width, tip projection/height/rotation and alar spread",
  },
  {
    id: "lips",
    label: "Lips",
    description: "Upper- and lower-lip projection and fullness",
  },
  {
    id: "chin",
    label: "Chin",
    description: "Chin projection, height and width",
  },
  {
    id: "jawline",
    label: "Jawline",
    description: "Lower-jaw width and mandibular contour definition",
  },
  {
    id: "cheeks",
    label: "Cheeks",
    description: "Malar projection and fullness (both sides, symmetric)",
  },
];

export interface ParamDescriptor {
  key: ParamKey;
  label: string;
  shortLabel: string;
  unit: Extract<Unit, "mm" | "degrees">;
  target: TargetRegion;
  parameter: Parameter;
  group: ParamGroup;
  min: number;
  max: number;
  step: number;
  /** Default / reset value. */
  default: number;
  /** Short explanation, shown next to the control. */
  hint: string;
  /** Meaning of a positive value. */
  positive: string;
  /** Meaning of a negative value. */
  negative: string;
  /** Parser operations that are valid for this parameter. */
  operations: Operation[];
  /**
   * Name of the geometry weight function this parameter drives, so the
   * registry-to-geometry mapping is explicit and testable.
   */
  deformation: string;
  /** Explicit support status. `false` controls must not be presented as functional. */
  supported: boolean;
  /** Whether this control is reachable from a parsed voice command. */
  voice: boolean;
  /** Whether this control is adjustable from the panel. */
  manual: boolean;
}

export const PARAM_DESCRIPTORS: Record<ParamKey, ParamDescriptor> = {
  /* ------------------------------- Nose -------------------------------- */
  bridgeHeight: {
    key: "bridgeHeight",
    label: "Nasal bridge height",
    shortLabel: "Bridge height",
    unit: "mm",
    target: "nasal_bridge",
    parameter: "height",
    group: "nose",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Anterior / posterior position of the nasal dorsum (reduction / augmentation).",
    positive: "Higher dorsum (augmentation)",
    negative: "Lower dorsum (reduction)",
    operations: ["increase", "decrease", "raise", "lower"],
    deformation: "bridgeWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  bridgeWidth: {
    key: "bridgeWidth",
    label: "Nasal bridge width",
    shortLabel: "Bridge width",
    unit: "mm",
    target: "nasal_bridge",
    parameter: "width",
    group: "nose",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Lateral width of the dorsal bridge sides. Does not widen the nostrils.",
    positive: "Wider bridge sides",
    negative: "Narrower bridge sides",
    operations: ["increase", "decrease", "widen", "narrow"],
    deformation: "bridgeWidthWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  tipProjection: {
    key: "tipProjection",
    label: "Tip projection",
    shortLabel: "Tip projection",
    unit: "mm",
    target: "nasal_tip",
    parameter: "projection",
    group: "nose",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Anterior / posterior position of the tip.",
    positive: "Tip forward (more projection)",
    negative: "Tip back (less projection)",
    operations: ["increase", "decrease"],
    deformation: "tipWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  tipHeight: {
    key: "tipHeight",
    label: "Tip height",
    shortLabel: "Tip height",
    unit: "mm",
    target: "nasal_tip",
    parameter: "height",
    group: "nose",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Superior / inferior position of the tip.",
    positive: "Tip up (superior)",
    negative: "Tip down (inferior)",
    operations: ["increase", "decrease", "raise", "lower"],
    deformation: "tipWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  tipRotation: {
    key: "tipRotation",
    label: "Tip rotation",
    shortLabel: "Tip rotation",
    unit: "degrees",
    target: "nasal_tip",
    parameter: "rotation",
    group: "nose",
    min: -45,
    max: 45,
    step: 1,
    default: 0,
    hint: "Nasolabial-angle rotation about the documented subnasale pivot.",
    positive: "Rotated upward (cranial)",
    negative: "Rotated downward (caudal)",
    operations: ["rotate"],
    deformation: "tipWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  alarWidth: {
    key: "alarWidth",
    label: "Alar width",
    shortLabel: "Alar width",
    unit: "mm",
    target: "nostril_region",
    parameter: "width",
    group: "nose",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Lateral spread of the alar wings, independent of the bridge width.",
    positive: "Wider alar wings",
    negative: "Narrower alar wings",
    operations: ["increase", "decrease", "widen", "narrow"],
    deformation: "alarWeight",
    supported: true,
    voice: true,
    manual: true,
  },

  /* ------------------------------- Lips -------------------------------- */
  upperLipProjection: {
    key: "upperLipProjection",
    label: "Upper-lip projection",
    shortLabel: "Upper-lip projection",
    unit: "mm",
    target: "upper_lip",
    parameter: "projection",
    group: "lips",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Anterior / posterior position of the upper lip.",
    positive: "Upper lip forward",
    negative: "Upper lip back",
    operations: ["increase", "decrease"],
    deformation: "upperLipWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  upperLipFullness: {
    key: "upperLipFullness",
    label: "Upper-lip fullness",
    shortLabel: "Upper-lip fullness",
    unit: "mm",
    target: "upper_lip",
    parameter: "fullness",
    group: "lips",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Outward fullness (plump) of the upper lip, distinct from projection.",
    positive: "Fuller upper lip",
    negative: "Thinner upper lip",
    operations: ["increase", "decrease"],
    deformation: "upperLipWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  lowerLipProjection: {
    key: "lowerLipProjection",
    label: "Lower-lip projection",
    shortLabel: "Lower-lip projection",
    unit: "mm",
    target: "lower_lip",
    parameter: "projection",
    group: "lips",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Anterior / posterior position of the lower lip.",
    positive: "Lower lip forward",
    negative: "Lower lip back",
    operations: ["increase", "decrease"],
    deformation: "lowerLipWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  lowerLipFullness: {
    key: "lowerLipFullness",
    label: "Lower-lip fullness",
    shortLabel: "Lower-lip fullness",
    unit: "mm",
    target: "lower_lip",
    parameter: "fullness",
    group: "lips",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Outward fullness (plump) of the lower lip, distinct from projection.",
    positive: "Fuller lower lip",
    negative: "Thinner lower lip",
    operations: ["increase", "decrease"],
    deformation: "lowerLipWeight",
    supported: true,
    voice: true,
    manual: true,
  },

  /* ------------------------------- Chin -------------------------------- */
  chinProjection: {
    key: "chinProjection",
    label: "Chin projection",
    shortLabel: "Chin projection",
    unit: "mm",
    target: "chin",
    parameter: "projection",
    group: "chin",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Anterior / posterior position of the chin (pogonion).",
    positive: "Chin forward",
    negative: "Chin back",
    operations: ["increase", "decrease"],
    deformation: "chinProjectionWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  chinHeight: {
    key: "chinHeight",
    label: "Chin height",
    shortLabel: "Chin height",
    unit: "mm",
    target: "chin",
    parameter: "height",
    group: "chin",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Vertical dimension of the chin (positive lengthens it downward).",
    positive: "Longer chin (menton lowered)",
    negative: "Shorter chin (menton raised)",
    operations: ["increase", "decrease", "raise", "lower"],
    deformation: "chinHeightWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  chinWidth: {
    key: "chinWidth",
    label: "Chin width",
    shortLabel: "Chin width",
    unit: "mm",
    target: "chin",
    parameter: "width",
    group: "chin",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Lateral width of the chin. Independent of jaw width.",
    positive: "Wider chin",
    negative: "Narrower chin",
    operations: ["increase", "decrease", "widen", "narrow"],
    deformation: "chinWidthWeight",
    supported: true,
    voice: true,
    manual: true,
  },

  /* ----------------------------- Jawline ------------------------------- */
  jawWidth: {
    key: "jawWidth",
    label: "Jaw width",
    shortLabel: "Jaw width",
    unit: "mm",
    target: "jawline",
    parameter: "width",
    group: "jawline",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Lateral width of the lower jaw. Independent of chin width.",
    positive: "Wider jaw",
    negative: "Narrower jaw",
    operations: ["increase", "decrease", "widen", "narrow"],
    deformation: "jawWidthWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  jawDefinition: {
    key: "jawDefinition",
    label: "Jawline definition",
    shortLabel: "Jawline definition",
    unit: "mm",
    target: "jawline",
    parameter: "definition",
    group: "jawline",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Sharpens the outer mandibular contour band (distinct from jaw width).",
    positive: "More defined jawline",
    negative: "Softer jawline",
    operations: ["increase", "decrease"],
    deformation: "jawDefinitionWeight",
    supported: true,
    voice: true,
    manual: true,
  },

  /* ------------------------------ Cheeks ------------------------------- */
  cheekProjection: {
    key: "cheekProjection",
    label: "Cheek projection",
    shortLabel: "Cheek projection",
    unit: "mm",
    target: "cheek",
    parameter: "projection",
    group: "cheeks",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Anterior projection of the malar (cheek) region, both sides.",
    positive: "Cheeks forward",
    negative: "Cheeks back",
    operations: ["increase", "decrease"],
    deformation: "cheekProjectionWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  cheekFullness: {
    key: "cheekFullness",
    label: "Cheek fullness",
    shortLabel: "Cheek fullness",
    unit: "mm",
    target: "cheek",
    parameter: "fullness",
    group: "cheeks",
    min: -10,
    max: 10,
    step: 1,
    default: 0,
    hint: "Outward (lateral) fullness of the malar region, both sides.",
    positive: "Fuller cheeks",
    negative: "Flatter cheeks",
    operations: ["increase", "decrease"],
    deformation: "cheekFullnessWeight",
    supported: true,
    voice: true,
    manual: true,
  },
};

export function descriptorFor(key: ParamKey): ParamDescriptor {
  return PARAM_DESCRIPTORS[key];
}

export interface RegionOption {
  id: TargetRegion;
  label: string;
}

/** Regions an instruction can be re-targeted to while editing. */
export const REGION_OPTIONS: RegionOption[] = [
  { id: "nasal_bridge", label: "Nasal bridge" },
  { id: "nasal_tip", label: "Nasal tip" },
  { id: "nostril_region", label: "Nostril region" },
  { id: "upper_lip", label: "Upper lip" },
  { id: "lower_lip", label: "Lower lip" },
  { id: "chin", label: "Chin" },
  { id: "jawline", label: "Jawline" },
  { id: "cheek", label: "Cheeks" },
];

/** Parameters that map to a real model field for a given region. */
export function parametersForRegion(region: TargetRegion): Parameter[] {
  const seen: Parameter[] = [];
  for (const d of Object.values(PARAM_DESCRIPTORS) as ParamDescriptor[]) {
    if (d.target === region && !seen.includes(d.parameter)) seen.push(d.parameter);
  }
  return seen;
}

/** Human label for a parameter id, e.g. "projection" -> "Projection". */
export function parameterLabel(parameter: string): string {
  return parameter.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Descriptors for a group, in panel order. */
export function descriptorsForGroup(group: ParamGroup): ParamDescriptor[] {
  return (Object.values(PARAM_DESCRIPTORS) as ParamDescriptor[]).filter(
    (d) => d.group === group,
  );
}

/**
 * Resolve a parsed target/parameter pair to a simulated model field.
 *
 * Mapping is deliberately explicit and never guesses: each supported pair maps
 * to exactly one engine field, and anything else returns `null` so the caller
 * can refuse to apply it. Fields that look similar are kept distinct: bridge
 * width vs alar width, chin width vs jaw width, lip projection vs fullness.
 */
export function paramKeyFor(
  target: TargetRegion | null,
  parameter: string | null,
): ModelField | null {
  if (!target || !parameter) return null;
  const p = parameter.toLowerCase();
  if (target === "nasal_bridge" || target === "nasal_dorsum") {
    if (p === "height") return "bridgeHeight";
    if (p === "width") return "bridgeWidth";
  }
  if (target === "nasal_tip") {
    if (p === "height") return "tipHeight";
    if (p === "projection") return "tipProjection";
    if (p === "rotation") return "tipRotation";
  }
  if (target === "nostril_region") {
    // Alar width is its own field, structurally independent of bridge width.
    if (p === "width") return "alarWidth";
  }
  if (target === "upper_lip") {
    if (p === "projection") return "upperLipProjection";
    if (p === "fullness") return "upperLipFullness";
  }
  if (target === "lower_lip") {
    if (p === "projection") return "lowerLipProjection";
    if (p === "fullness") return "lowerLipFullness";
  }
  if (target === "chin") {
    if (p === "projection") return "chinProjection";
    if (p === "height") return "chinHeight";
    if (p === "width") return "chinWidth";
  }
  if (target === "jawline") {
    // Jaw width and jawline definition are separate fields.
    if (p === "width") return "jawWidth";
    if (p === "definition") return "jawDefinition";
  }
  if (target === "cheek") {
    if (p === "projection") return "cheekProjection";
    if (p === "fullness") return "cheekFullness";
  }
  return null;
}
