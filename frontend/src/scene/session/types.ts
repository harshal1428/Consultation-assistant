import type { Command, ModelState } from "../transformations/types";

/**
 * ---------------------------------------------------------------------------
 * Consultation session model (Phase 6)
 * ---------------------------------------------------------------------------
 * A small, fully typed, in-memory model of a simulated consultation. It is held
 * only in browser memory (no database, no auth, no external storage) and is
 * explicitly temporary — it does not survive a page reload.
 *
 * The applied simulation state stays in the existing `Command[]` history
 * (transformations/logic); this model only records the *narrative* around it:
 * what was said, what was proposed, what was confirmed or rejected, which
 * scenarios were saved, and the resulting audit events.
 */

/** A consultation is either live in memory or has been ended. */
export type SessionStatus = "active" | "ended";

/**
 * Proposal lifecycle. Adapted to the existing parse contract so no unreachable
 * states exist:
 *  - processing            a request is in flight
 *  - needs_clarification   at least one instruction is ambiguous
 *  - ready                 at least one instruction is applicable
 *  - blocked               parsed, but nothing can be applied
 *  - failed                the parse request itself failed
 *  - confirmed/rejected/cancelled  terminal outcome
 */
export type ProposalStatus =
  | "processing"
  | "needs_clarification"
  | "ready"
  | "blocked"
  | "failed"
  | "confirmed"
  | "rejected"
  | "cancelled";

/** Terminal proposal outcomes (set once, never re-derived). */
export const TERMINAL_PROPOSAL_STATUSES: ProposalStatus[] = [
  "confirmed",
  "rejected",
  "cancelled",
];

export function isTerminalProposal(status: ProposalStatus): boolean {
  return TERMINAL_PROPOSAL_STATUSES.includes(status);
}

export type InputSource = "voice" | "typed";

/** How an input was ultimately handled in the consultation. */
export type TranscriptOutcome =
  | "pending"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "failed"
  | null;

export interface TranscriptEntry {
  id: string;
  createdAt: number;
  source: InputSource;
  /** The original recognised or typed text. Never overwritten by edits. */
  text: string;
  status: "processing" | "parsed" | "error";
  /** The proposal produced by this utterance, if parsing succeeded. */
  proposalId: string | null;
  outcome: TranscriptOutcome;
  error: string | null;
}

export interface Proposal {
  id: string;
  createdAt: number;
  transcriptId: string;
  originalText: string;
  source: InputSource;
  status: ProposalStatus;
  /** Parsed/review instructions. Only `ok` instructions ever apply. */
  instructions: Command[];
  /** Parse or backend error text, when `status === "failed"`. */
  error: string | null;
  /** Set when the proposal reaches a terminal state. */
  resolvedAt: number | null;
  /**
   * How a terminal outcome was reached: whether the whole batch was applied or
   * only the valid subset was explicitly accepted by the user.
   */
  appliedCommandCount: number;
  appliedAll: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  createdAt: number;
  /** Full canonical parameter state — never a delta, so it is reproducible. */
  state: ModelState;
  /** Ids of the applied commands that were in effect when it was saved. */
  commandIds: string[];
  notes: string;
}

export type SessionEventType =
  | "session_started"
  | "session_ended"
  | "proposal_created"
  | "proposal_confirmed"
  | "proposal_rejected"
  | "proposal_cancelled"
  | "manual_edit"
  | "live_command"
  | "undo"
  | "reset"
  | "scenario_saved"
  | "scenario_renamed"
  | "scenario_deleted"
  | "scenario_loaded"
  | "consultation_archived"
  | "consultation_restored";

/**
 * A single, immutable audit entry. Stores enough to identify the action and the
 * affected parameters — deliberately not an entire mutable state snapshot.
 */
export interface SessionEvent {
  id: string;
  at: number;
  type: SessionEventType;
  label: string;
  detail: string | null;
  proposalId: string | null;
  commandIds: string[];
  scenarioId: string | null;
}

export interface ConsultationSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  status: SessionStatus;
  transcript: TranscriptEntry[];
  proposals: Proposal[];
  events: SessionEvent[];
  scenarios: Scenario[];
}

/** A selectable model state for side-by-side comparison. */
export type ComparisonSource = "baseline" | "current" | string;
