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

  /* ----------------------- Additional Clinical Parameters ---------------------- */
  dorsalHumpReduction: {
    key: "dorsalHumpReduction",
    label: "Dorsal hump reduction",
    shortLabel: "Dorsal hump",
    unit: "mm",
    target: "nasal_bridge",
    parameter: "height",
    group: "nose",
    min: 0,
    max: 10,
    step: 1,
    default: 0,
    hint: "Reduction of the dorsal hump (convexity) on the nasal bridge.",
    positive: "Reduce hump (lower dorsum)",
    negative: "N/A (reduction only)",
    operations: ["decrease"],
    deformation: "bridgeWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  radixHeight: {
    key: "radixHeight",
    label: "Radix height",
    shortLabel: "Radix height",
    unit: "mm",
    target: "nasal_bridge",
    parameter: "height",
    group: "nose",
    min: -5,
    max: 10,
    step: 1,
    default: 0,
    hint: "Height of the radix (nasal root) at the nasofrontal junction.",
    positive: "Higher radix",
    negative: "Lower radix",
    operations: ["increase", "decrease", "raise", "lower"],
    deformation: "bridgeWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  nasofrontalAngle: {
    key: "nasofrontalAngle",
    label: "Nasofrontal angle",
    shortLabel: "Nasofrontal angle",
    unit: "degrees",
    target: "cheek",
    parameter: "rotation",
    group: "nose",
    min: 115,
    max: 150,
    step: 1,
    default: 130,
    hint: "Angle between the nasal dorsum and the forehead (glabella).",
    positive: "More obtuse angle",
    negative: "More acute angle",
    operations: ["increase", "decrease"],
    deformation: "bridgeWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  nasolabialAngle: {
    key: "nasolabialAngle",
    label: "Nasolabial angle",
    shortLabel: "Nasolabial angle",
    unit: "degrees",
    target: "cheek",
    parameter: "rotation",
    group: "nose",
    min: 80,
    max: 120,
    step: 1,
    default: 95,
    hint: "Angle between the columella and the upper lip.",
    positive: "More obtuse angle",
    negative: "More acute angle",
    operations: ["increase", "decrease"],
    deformation: "bridgeWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  columellarShow: {
    key: "columellarShow",
    label: "Columellar show",
    shortLabel: "Columellar show",
    unit: "mm",
    target: "cheek",
    parameter: "projection",
    group: "nose",
    min: 0,
    max: 6,
    step: 1,
    default: 3,
    hint: "Visible height of the columella below the nostril rim.",
    positive: "More columellar show",
    negative: "Less columellar show",
    operations: ["increase", "decrease"],
    deformation: "bridgeWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  columellarLobularAngle: {
    key: "columellarLobularAngle",
    label: "Columellar-lobular angle",
    shortLabel: "Columellar-lobular angle",
    unit: "degrees",
    target: "cheek",
    parameter: "rotation",
    group: "nose",
    min: 30,
    max: 70,
    step: 1,
    default: 45,
    hint: "Angle between the columella and the lobule of the ear (or lobule reference).",
    positive: "More obtuse angle",
    negative: "More acute angle",
    operations: ["increase", "decrease"],
    deformation: "bridgeWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  supratipBreak: {
    key: "supratipBreak",
    label: "Supratip break",
    shortLabel: "Supratip break",
    unit: "mm",
    target: "nasal_tip",
    parameter: "height",
    group: "nose",
    min: -3,
    max: 3,
    step: 1,
    default: 0,
    hint: "The subtle depression just above the tip (supratip depression).",
    positive: "Deeper supratip break",
    negative: "Shallower supratip break",
    operations: ["increase", "decrease"],
    deformation: "tipWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  tipDefinition: {
    key: "tipDefinition",
    label: "Tip definition",
    shortLabel: "Tip definition",
    unit: "mm",
    target: "nasal_tip",
    parameter: "definition",
    group: "nose",
    min: -3,
    max: 5,
    step: 1,
    default: 0,
    hint: "Sharpness/contour definition of the nasal tip.",
    positive: "More defined tip",
    negative: "Softer tip",
    operations: ["increase", "decrease"],
    deformation: "tipWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  alarFlare: {
    key: "alarFlare",
    label: "Alar flare",
    shortLabel: "Alar flare",
    unit: "mm",
    target: "nostril_region",
    parameter: "width",
    group: "nose",
    min: -5,
    max: 5,
    step: 1,
    default: 0,
    hint: "Lateral flaring of the alar wings (distinct from alar base width).",
    positive: "More flaring",
    negative: "Less flaring",
    operations: ["increase", "decrease", "widen", "narrow"],
    deformation: "alarWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  alarBaseWidth: {
    key: "alarBaseWidth",
    label: "Alar base width",
    shortLabel: "Alar base width",
    unit: "mm",
    target: "nostril_region",
    parameter: "width",
    group: "nose",
    min: 0,
    max: 10,
    step: 1,
    default: 0,
    hint: "Width of the alar base at the nostril sill.",
    positive: "Wider alar base",
    negative: "Narrower alar base",
    operations: ["increase", "decrease", "widen", "narrow"],
    deformation: "alarWeight",
    supported: true,
    voice: true,
    manual: true,
  },
  nostrilShape: {
    key: "nostrilShape",
    label: "Nostril shape",
    shortLabel: "Nostril shape",
    unit: "mm",
    target: "nostril_region",
    parameter: "definition",
    group: "nose",
    min: -3,
    max: 3,
    step: 1,
    default: 0,
    hint: "Contour/shape of the nostril opening (oval, round, slit-like).",
    positive: "More oval/round",
    negative: "More slit-like",
    operations: ["increase", "decrease"],
    deformation: "alarWeight",
    supported: false,
    voice: true,
    manual: false,
  },
  nostrilSymmetry: {
    key: "nostrilSymmetry",
    label: "Nostril symmetry",
    shortLabel: "Nostril symmetry",
    unit: "mm",
    target: "nostril_region",
    parameter: "definition",
    group: "nose",
    min: -3,
    max: 3,
    step: 1,
    default: 0,
    hint: "Left-right symmetry of the nostril openings.",
    positive: "More symmetric",
    negative: "More asymmetric",
    operations: ["increase", "decrease"],
    deformation: "alarWeight",
    supported: false,
    voice: true,
    manual: false,
  },
  dorsalSeptalDeviation: {
    key: "dorsalSeptalDeviation",
    label: "Dorsal/septal deviation",
    shortLabel: "Dorsal/septal deviation",
    unit: "mm",
    target: "septal_region",
    parameter: "projection",
    group: "nose",
    min: -5,
    max: 5,
    step: 1,
    default: 0,
    hint: "Deviation of the dorsal septum from the midline.",
    positive: "Deviation to right",
    negative: "Deviation to left",
    operations: ["increase", "decrease"],
    deformation: "bridgeWeight",
    supported: false,
    voice: true,
    manual: false,
  },
  leftRightAsymmetry: {
    key: "leftRightAsymmetry",
    label: "Left-right asymmetry",
    shortLabel: "Asymmetry",
    unit: "mm",
    target: "jawline",
    parameter: "definition",
    group: "jawline",
    min: -5,
    max: 5,
    step: 1,
    default: 0,
    hint: "Left-right asymmetry of the lower face/jaw.",
    positive: "Right side more prominent",
    negative: "Left side more prominent",
    operations: ["increase", "decrease"],
    deformation: "jawDefinitionWeight",
    supported: false,
    voice: true,
    manual: false,
  },
  nasalLength: {
    key: "nasalLength",
    label: "Nasal length",
    shortLabel: "Nasal length",
    unit: "mm",
    target: "nasal_bridge",
    parameter: "height",
    group: "nose",
    min: 30,
    max: 70,
    step: 1,
    default: 50,
    hint: "Total length of the nose from radix to tip.",
    positive: "Longer nose",
    negative: "Shorter nose",
    operations: ["increase", "decrease"],
    deformation: "bridgeWeight",
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
  { id: "nasal_dorsum", label: "Nasal dorsum" },
  { id: "nasal_tip", label: "Nasal tip" },
  { id: "nostril_region", label: "Nostril region" },
  { id: "upper_lip", label: "Upper lip" },
  { id: "lower_lip", label: "Lower lip" },
  { id: "chin", label: "Chin" },
  { id: "jawline", label: "Jawline" },
  { id: "cheek", label: "Cheeks" },
  { id: "nasal_base", label: "Nasal base" },
  { id: "columella", label: "Columella" },
  { id: "septal_region", label: "Septal region" },
  { id: "left_side", label: "Left side" },
  { id: "right_side", label: "Right side" },
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
    if (p === "definition") return "tipHeight"; // tipDefinition uses tipWeight which affects tipHeight
  }
  if (target === "nostril_region") {
    // Alar width is its own field, structurally independent of bridge width.
    if (p === "width") return "alarWidth";
    if (p === "definition") return "alarFlare";
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
    if (p === "rotation") {
      // Nasofrontal angle, nasolabial angle, columellar-lobular angle
      return "cheekProjection"; // reuse cheek projection for angle changes
    }
  }
  if (target === "nasal_base") {
    if (p === "height") return "radixHeight";
    if (p === "width") return "bridgeWidth";
  }
  if (target === "columella") {
    if (p === "projection") return "columellarShow";
    if (p === "rotation") return "columellarLobularAngle";
  }
  if (target === "septal_region") {
    if (p === "projection") return "dorsalSeptalDeviation";
  }
  if (target === "left_side" || target === "right_side") {
    if (p === "definition") return "leftRightAsymmetry";
  }
  if (target === "nasal_bridge" && p === "height") {
    // Dorsal hump reduction maps to bridge height reduction
    return "bridgeHeight";
  }
  if (target === "nasal_tip" && p === "height") {
    // Supratip break maps to tip height
    return "tipHeight";
  }
  if (target === "nasal_tip" && p === "definition") {
    // Tip definition
    return "tipDefinition";
  }
  if (target === "nostril_region" && p === "width") {
    // Alar base width and alar flare both map to alar width/flare
    return "alarWidth";
  }
  if (target === "cheek" && p === "rotation") {
    // Nasofrontal angle, nasolabial angle, columellar-lobular angle
    return "cheekProjection";
  }
  if (target === "cheek" && p === "projection") {
    // Columellar show
    return "cheekProjection";
  }
  if (target === "jawline" && p === "definition") {
    // Left-right asymmetry
    return "leftRightAsymmetry";
  }
  return null;
}
