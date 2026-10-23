import type {
  ParamKey,
  Parameter,
  TargetRegion,
  Unit,
} from "../transformations/types";

/**
 * ---------------------------------------------------------------------------
 * Live Simulation change log (Objective 4)
 * ---------------------------------------------------------------------------
 * A chronological, append-only record of every instruction the continuous Live
 * Simulation mode handled, whether or not it changed the model.
 *
 * Each entry carries the original instruction, the region/parameter it targeted
 * the requested and the normalised value with their units, the execution
 * status, the actual before/after value, and the reason it was not applied.
 * Nothing is ever silently dropped: an instruction that could not run is still
 * recorded with a reason.
 */

/** Where an instruction came from. */
export type LiveEventSource = "live_voice" | "typed" | "manual";

/**
 * How an instruction ended up. `applied` is the only status that changed the
 * model; everything else is recorded with a reason instead of being hidden.
 */
export type LiveExecutionStatus =
  | "applied"
  | "needs_clarification"
  | "unsupported"
  | "out_of_range"
  | "no_change"
  | "not_applied";

export interface LiveEvent {
  /** Monotonically unique id. */
  id: string;
  /** Epoch milliseconds when the instruction was handled. */
  at: number;
  source: LiveEventSource;
  /** The exact original instruction / utterance text. */
  utterance: string;
  target: TargetRegion | null;
  parameter: Parameter | null;
  /** Resolved model field, when one exists. */
  paramKey: ParamKey | null;
  /** Value exactly as requested, in `requestedUnit`. */
  requestedValue: number | null;
  requestedUnit: Unit | null;
  /** Normalised magnitude the parser produced, in `normalizedUnit`. */
  normalizedValue: number | null;
  normalizedUnit: Unit | null;
  status: LiveExecutionStatus;
  /** Model value immediately before the change. */
  before: number | null;
  /** Model value immediately after the change. */
  after: number | null;
  /** Clarification / error / rejection reason, when status is not `applied`. */
  reason: string | null;
  /** Parser confidence at capture time, for auditability. */
  confidence: number | null;
}
