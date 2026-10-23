export interface ModelState {
  bridgeHeight: number;
  bridgeWidth: number;
  tipHeight: number;
  tipProjection: number;
  tipRotation: number;
  /** Lateral spread of the alar wings. Independent of bridgeWidth. */
  alarWidth: number;
  /** Anterior / posterior position of the upper lip. */
  upperLipProjection: number;
  /** Vertical fullness (pout) of the upper lip. */
  upperLipFullness: number;
  /** Anterior / posterior position of the lower lip. */
  lowerLipProjection: number;
  /** Vertical fullness (pout) of the lower lip. */
  lowerLipFullness: number;
  /** Anterior / posterior position of the chin (pogonion). */
  chinProjection: number;
  /** Vertical dimension of the chin (positive lengthens the chin). */
  chinHeight: number;
  /** Lateral width of the chin, independent of jaw width. */
  chinWidth: number;
  /** Lateral width of the lower-lateral jaw region. */
  jawWidth: number;
  /** Outward sharpening of the narrow mandibular contour band. */
  jawDefinition: number;
  /** Anterior projection of the malar (cheek) region, both sides. */
  cheekProjection: number;
  /** Outward fullness of the malar region, both sides. */
  cheekFullness: number;
}

export const initialModelState: ModelState = {
  bridgeHeight: 0,
  bridgeWidth: 0,
  tipHeight: 0,
  tipProjection: 0,
  tipRotation: 0,
  alarWidth: 0,
  upperLipProjection: 0,
  upperLipFullness: 0,
  lowerLipProjection: 0,
  lowerLipFullness: 0,
  chinProjection: 0,
  chinHeight: 0,
  chinWidth: 0,
  jawWidth: 0,
  jawDefinition: 0,
  cheekProjection: 0,
  cheekFullness: 0,
};

/** Any field the deformation engine can actually drive. */
export type ModelField = keyof ModelState;

export type TargetRegion =
  | "nasal_bridge"
  | "nasal_dorsum"
  | "nasal_tip"
  | "nostril_region"
  | "upper_lip"
  | "lower_lip"
  | "chin"
  | "jawline"
  | "cheek";

export type Parameter =
  | "height"
  | "width"
  | "projection"
  | "rotation"
  | "fullness"
  | "definition";

export type Operation =
  | "increase"
  | "decrease"
  | "rotate"
  | "narrow"
  | "widen"
  | "raise"
  | "lower";

export type Unit = "mm" | "cm" | "degrees";

export type InstructionStatus =
  | "ok"
  | "needs_clarification"
  | "unsupported"
  | "invalid"
  | "no_change";

export type ParserSource = "llm" | "rules";

/**
 * Mirrors the backend `Instruction`. Fields the backend may omit or return as
 * null are typed nullable so the frontend contract matches reality.
 */
export interface Instruction {
  target: TargetRegion | null;
  parameter: Parameter | null;
  operation: Operation | null;
  /** Normalized non-negative magnitude, in `unit`. */
  value: number | null;
  /** Magnitude exactly as requested, in `requested_unit`. */
  requested_value: number | null;
  requested_unit: Unit | null;
  unit: Unit | null;
  direction: string | null;
  /** Suggested in-range replacement when `value` exceeds supported bounds. */
  adjusted_value: number | null;
  confidence: number;
  requires_confirmation: boolean;
  status: InstructionStatus;
  reason: string | null;
  original_text: string;
  parser: ParserSource;
}

export interface ContextItem {
  target: TargetRegion | null;
  parameter: Parameter | null;
  operation: Operation | null;
  value: number | null;
  unit: Unit | null;
}

export interface ParseResponse {
  instructions: Instruction[];
  text: string;
}

export type CommandSource = "voice" | "manual";

/**
 * A single applied change. Voice commands carry the parsed instruction; manual
 * commands carry an absolute target value produced by the parameter sliders.
 */
export interface Command extends Instruction {
  id: string;
  source: CommandSource;
  createdAt: number;
}

export type ParamKey =
  | "bridgeHeight"
  | "bridgeWidth"
  | "tipProjection"
  | "tipHeight"
  | "tipRotation"
  | "alarWidth"
  | "upperLipProjection"
  | "upperLipFullness"
  | "lowerLipProjection"
  | "lowerLipFullness"
  | "chinProjection"
  | "chinHeight"
  | "chinWidth"
  | "jawWidth"
  | "jawDefinition"
  | "cheekProjection"
  | "cheekFullness";

/** Parameters that the slider panel can display and adjust. */
export const SIMULATED_PARAM_KEYS: ParamKey[] = [
  "bridgeHeight",
  "bridgeWidth",
  "tipProjection",
  "tipHeight",
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
];

export type ViewMode = "before" | "after" | "compare";

/**
 * Operating lens for the workspace. `live` is an instant, manipulation-first
 * view (face + parameter sliders + change log). `consultation` is the full
 * instruction → review → confirm workflow with the timeline, scenarios and
 * summary export. Both share the same canonical model state, so switching never
 * loses or re-derives work.
 */
export type WorkspaceMode = "live" | "consultation";

export type ConsultationPhase =
  | "ready"
  | "listening"
  | "transcribed"
  | "processing"
  | "review"
  | "error";
