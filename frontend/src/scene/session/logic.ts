import type {
  Command,
  ModelState,
  ParamKey,
} from "../transformations/types";
import { SIMULATED_PARAM_KEYS } from "../transformations/types";
import { createManualCommand } from "../transformations/logic";
import { PARAM_DESCRIPTORS } from "../../lib/params";
import {
  describeCommand,
  formatParameter,
  formatTarget,
  formatUnit,
  isApplicable,
} from "../../lib/format";
import type {
  ConsultationSession,
  InputSource,
  Proposal,
  ProposalStatus,
  Scenario,
  SessionEvent,
  SessionEventType,
  TranscriptEntry,
} from "./types";
import { isTerminalProposal } from "./types";

let idCounter = 0;

/** Stable, unique, readable id for a session entity. */
export function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function createSession(now: number = Date.now()): ConsultationSession {
  const id = makeId("session");
  return {
    id,
    startedAt: now,
    endedAt: null,
    status: "active",
    transcript: [],
    proposals: [],
    events: [
      {
        id: makeId("event"),
        at: now,
        type: "session_started",
        label: "Consultation started",
        detail: "New in-memory consultation session.",
        proposalId: null,
        commandIds: [],
        scenarioId: null,
      },
    ],
    scenarios: [],
  };
}

export function endSession(
  session: ConsultationSession,
  now: number = Date.now(),
): ConsultationSession {
  if (session.status === "ended") return session;
  return {
    ...session,
    status: "ended",
    endedAt: now,
    events: [
      ...session.events,
      makeEvent({
        type: "session_ended",
        label: "Consultation ended",
        detail: null,
        at: now,
      }),
    ],
  };
}

export function isActiveSession(session: ConsultationSession): boolean {
  return session.status === "active";
}

/* -------------------------------------------------------------------------- */
/* Proposals                                                                   */
/* -------------------------------------------------------------------------- */

export function applicableInstructions(instructions: Command[]): Command[] {
  return instructions.filter(isApplicable);
}

export function allInstructionsApplicable(instructions: Command[]): boolean {
  return instructions.length > 0 && instructions.every(isApplicable);
}

/**
 * Derive a non-terminal proposal status from its instructions. Terminal and
 * failed/processing states are preserved by the caller.
 */
export function deriveProposalStatus(instructions: Command[]): ProposalStatus {
  if (instructions.length === 0) return "blocked";
  if (instructions.some((i) => i.status === "needs_clarification")) {
    return "needs_clarification";
  }
  if (applicableInstructions(instructions).length > 0) return "ready";
  return "blocked";
}

/** Whether a proposal can currently be acted on at all. */
export function isProposalActionable(status: ProposalStatus): boolean {
  return status === "ready" || status === "needs_clarification";
}

export function buildProposal(input: {
  transcriptId: string;
  originalText: string;
  source: InputSource;
  now?: number;
}): Proposal {
  return {
    id: makeId("proposal"),
    createdAt: input.now ?? Date.now(),
    transcriptId: input.transcriptId,
    originalText: input.originalText,
    source: input.source,
    status: "processing",
    instructions: [],
    error: null,
    resolvedAt: null,
    appliedCommandCount: 0,
    appliedAll: false,
  };
}

/**
 * Append a prepared transcript entry and proposal together with the matching
 * `proposal_created` event. Accepts already-built entities so callers can keep
 * the ids they need for the async parse continuation without side effects inside
 * a React state updater.
 */
export function appendProposal(
  session: ConsultationSession,
  entry: TranscriptEntry,
  proposal: Proposal,
): ConsultationSession {
  return {
    ...session,
    transcript: [...session.transcript, entry],
    proposals: [...session.proposals, proposal],
    events: [
      ...session.events,
      makeEvent({
        type: "proposal_created",
        label: "Proposal created",
        detail: `\u201C${proposal.originalText}\u201D`,
        at: proposal.createdAt,
        proposalId: proposal.id,
      }),
    ],
  };
}

/** Replace a proposal in the session (immutably). */
export function updateProposal(
  session: ConsultationSession,
  proposalId: string,
  patch: Partial<Proposal>,
): ConsultationSession {
  return {
    ...session,
    proposals: session.proposals.map((p) =>
      p.id === proposalId ? { ...p, ...patch } : p,
    ),
  };
}

/**
 * Recompute a proposal's non-terminal status from its current instructions.
 * Terminal / failed / processing proposals are left untouched.
 */
export function refreshProposalStatus(
  session: ConsultationSession,
  proposalId: string,
): ConsultationSession {
  return {
    ...session,
    proposals: session.proposals.map((p) => {
      if (p.id !== proposalId) return p;
      if (
        p.status === "processing" ||
        p.status === "failed" ||
        isTerminalProposal(p.status)
      ) {
        return p;
      }
      return { ...p, status: deriveProposalStatus(p.instructions) };
    }),
  };
}

export interface ResolveOptions {
  appliedCommandCount?: number;
  appliedAll?: boolean;
  now?: number;
}

/**
 * Move a proposal to a terminal state, update its transcript outcome and add
 * the corresponding audit event. Nothing is applied to the simulation here —
 * that is the caller's responsibility — this only records the outcome.
 */
export function resolveProposal(
  session: ConsultationSession,
  proposalId: string,
  status: Extract<ProposalStatus, "confirmed" | "rejected" | "cancelled">,
  options: ResolveOptions = {},
): ConsultationSession {
  const now = options.now ?? Date.now();
  const proposal = session.proposals.find((p) => p.id === proposalId);
  if (!proposal || isTerminalProposal(proposal.status)) return session;

  const appliedCommandCount = options.appliedCommandCount ?? 0;
  const appliedAll = options.appliedAll ?? false;

  const eventType: SessionEventType =
    status === "confirmed"
      ? "proposal_confirmed"
      : status === "rejected"
        ? "proposal_rejected"
        : "proposal_cancelled";

  const detail =
    status === "confirmed"
      ? appliedAll
        ? `Applied all ${appliedCommandCount} instruction(s).`
        : `Applied ${appliedCommandCount} of ${proposal.instructions.length} instruction(s).`
      : `\u201C${proposal.originalText}\u201D`;

  const outcome: TranscriptEntry["outcome"] =
    status === "confirmed" ? "confirmed" : status;

  return {
    ...session,
    proposals: session.proposals.map((p) =>
      p.id === proposalId
        ? {
            ...p,
            status,
            resolvedAt: now,
            appliedCommandCount,
            appliedAll,
          }
        : p,
    ),
    transcript: session.transcript.map((t) =>
      t.id === proposal.transcriptId || t.proposalId === proposalId
        ? { ...t, outcome }
        : t,
    ),
    events: [
      ...session.events,
      makeEvent({
        type: eventType,
        label:
          status === "confirmed"
            ? "Proposal confirmed"
            : status === "rejected"
              ? "Proposal rejected"
              : "Proposal cancelled",
        detail,
        at: now,
        proposalId,
        commandIds: proposal.instructions.map((i) => i.id),
      }),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Transcript                                                                  */
/* -------------------------------------------------------------------------- */

export function buildTranscriptEntry(input: {
  source: InputSource;
  text: string;
  now?: number;
}): TranscriptEntry {
  return {
    id: makeId("transcript"),
    createdAt: input.now ?? Date.now(),
    source: input.source,
    text: input.text,
    status: "processing",
    proposalId: null,
    outcome: "pending",
    error: null,
  };
}

export function updateTranscriptEntry(
  session: ConsultationSession,
  entryId: string,
  patch: Partial<TranscriptEntry>,
): ConsultationSession {
  return {
    ...session,
    transcript: session.transcript.map((t) =>
      t.id === entryId ? { ...t, ...patch } : t,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

interface EventInput {
  type: SessionEventType;
  label: string;
  detail?: string | null;
  at?: number;
  proposalId?: string | null;
  commandIds?: string[];
  scenarioId?: string | null;
}

function makeEvent(input: EventInput): SessionEvent {
  return {
    id: makeId("event"),
    at: input.at ?? Date.now(),
    type: input.type,
    label: input.label,
    detail: input.detail ?? null,
    proposalId: input.proposalId ?? null,
    commandIds: input.commandIds ?? [],
    scenarioId: input.scenarioId ?? null,
  };
}

/**
 * Append an audit event. Consecutive manual edits to the *same* parameter are
 * coalesced into a single trailing event so dragging a slider does not spam the
 * timeline; the entry still reflects the latest value.
 */
export function appendEvent(
  session: ConsultationSession,
  input: EventInput,
): ConsultationSession {
  const event = makeEvent(input);
  const events = session.events;
  const last = events[events.length - 1];
  if (
    event.type === "manual_edit" &&
    last &&
    last.type === "manual_edit" &&
    last.commandIds.length > 0 &&
    event.commandIds.length > 0 &&
    last.commandIds[0] === event.commandIds[0]
  ) {
    return { ...session, events: [...events.slice(0, -1), { ...event, id: last.id }] };
  }
  return { ...session, events: [...events, event] };
}

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                   */
/* -------------------------------------------------------------------------- */

export function stateToCommands(state: ModelState): Command[] {
  const commands: Command[] = [];
  for (const key of SIMULATED_PARAM_KEYS) {
    if (state[key] !== 0) commands.push(createManualCommand(key, state[key]));
  }
  return commands;
}

export function createScenario(
  session: ConsultationSession,
  input: {
    name: string;
    state: ModelState;
    commandIds: string[];
    notes?: string;
    now?: number;
  },
): { session: ConsultationSession; scenario: Scenario } {
  const now = input.now ?? Date.now();
  const scenario: Scenario = {
    id: makeId("scenario"),
    name: input.name.trim() || "Untitled scenario",
    createdAt: now,
    state: { ...input.state },
    commandIds: [...input.commandIds],
    notes: input.notes ?? "",
  };
  return {
    session: appendEvent(
      { ...session, scenarios: [...session.scenarios, scenario] },
      {
        type: "scenario_saved",
        label: "Scenario saved",
        detail: scenario.name,
        at: now,
        scenarioId: scenario.id,
      },
    ),
    scenario,
  };
}

export function renameScenario(
  session: ConsultationSession,
  scenarioId: string,
  name: string,
  now: number = Date.now(),
): ConsultationSession {
  const trimmed = name.trim();
  if (!trimmed) return session;
  return appendEvent(
    {
      ...session,
      scenarios: session.scenarios.map((s) =>
        s.id === scenarioId ? { ...s, name: trimmed } : s,
      ),
    },
    {
      type: "scenario_renamed",
      label: "Scenario renamed",
      detail: trimmed,
      at: now,
      scenarioId,
    },
  );
}

export function deleteScenario(
  session: ConsultationSession,
  scenarioId: string,
  now: number = Date.now(),
): ConsultationSession {
  const target = session.scenarios.find((s) => s.id === scenarioId);
  if (!target) return session;
  return appendEvent(
    { ...session, scenarios: session.scenarios.filter((s) => s.id !== scenarioId) },
    {
      type: "scenario_deleted",
      label: "Scenario deleted",
      detail: target.name,
      at: now,
      scenarioId,
    },
  );
}

export function scenarioById(
  session: ConsultationSession,
  scenarioId: string | null,
): Scenario | null {
  if (!scenarioId) return null;
  return session.scenarios.find((s) => s.id === scenarioId) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Comparison + report                                                         */
/* -------------------------------------------------------------------------- */

export interface ParamDifference {
  key: ParamKey;
  label: string;
  unit: string;
  a: number;
  b: number;
  delta: number;
}

export function paramDiff(a: ModelState, b: ModelState): ParamDifference[] {
  return SIMULATED_PARAM_KEYS.map((key) => {
    const d = PARAM_DESCRIPTORS[key];
    return {
      key,
      label: d.shortLabel,
      unit: d.unit === "degrees" ? "\u00B0" : "mm",
      a: a[key],
      b: b[key],
      delta: b[key] - a[key],
    };
  });
}

export interface ReportInput {
  session: ConsultationSession;
  history: Command[];
  modelState: ModelState;
  finalScenarioId?: string | null;
  now?: number;
}

/**
 * Build a truthful text/Markdown summary from actual session data. Unresolved
 * proposals are only ever listed as unresolved - never as confirmed.
 */
export function buildConsultationReport(input: ReportInput): string {
  const { session, history, modelState } = input;
  const now = input.now ?? Date.now();
  const finalScenario = scenarioById(session, input.finalScenarioId ?? null);

  const lines: string[] = [];
  lines.push("# VoiceSurg 3D - Consultation Summary");
  lines.push("");
  lines.push(
    "_Exported from the current in-memory session. This is not a saved server record and not a clinical document._",
  );
  lines.push("");
  lines.push(`Generated: ${new Date(now).toLocaleString()}`);
  lines.push(`Session id: ${session.id}`);
  lines.push(`Started: ${new Date(session.startedAt).toLocaleString()}`);
  lines.push(
    `Ended: ${session.endedAt ? new Date(session.endedAt).toLocaleString() : "in progress"}`,
  );
  lines.push(`Status: ${session.status}`);
  lines.push(
    "Storage: temporary - this session lives only in browser memory and is lost on reload.",
  );
  lines.push("");

  lines.push("## Final working parameters");
  lines.push("");
  lines.push("| Parameter | Value |");
  lines.push("|---|---|");
  for (const key of SIMULATED_PARAM_KEYS) {
    const d = PARAM_DESCRIPTORS[key];
    const unit = d.unit === "degrees" ? "degrees" : "mm";
    lines.push(`| ${d.label} | ${modelState[key]} ${unit} |`);
  }
  lines.push("");

  lines.push("## Original instructions (transcript)");
  lines.push("");
  if (session.transcript.length === 0) {
    lines.push("No instructions were recorded.");
  } else {
    session.transcript.forEach((t, i) => {
      const outcome = t.outcome ?? t.status;
      lines.push(`${i + 1}. [${t.source}] "${t.text}" - ${outcome}`);
    });
  }
  lines.push("");

  lines.push("## Confirmed parameter changes");
  lines.push("");
  if (history.length === 0) {
    lines.push("No changes were applied.");
  } else {
    history.forEach((cmd, i) => {
      lines.push(
        `${i + 1}. [${cmd.source}] ${formatTarget(cmd.target)} - ${formatParameter(
          cmd.parameter,
        )} - ${describeCommand(cmd)} (${cmd.value}${formatUnit(cmd.unit)})`,
      );
    });
  }
  lines.push("");

  // Every proposal that was not confirmed is unresolved — including ones still
  // awaiting review — so nothing is ever omitted or mis-labelled as applied.
  const unresolved = session.proposals.filter((p) => p.status !== "confirmed");
  lines.push("## Rejected / unresolved proposals");
  lines.push("");
  if (unresolved.length === 0) {
    lines.push("None.");
  } else {
    unresolved.forEach((p) => {
      lines.push(`- "${p.originalText}" - ${p.status}${p.error ? ` (${p.error})` : ""}`);
    });
  }
  lines.push("");

  lines.push("## Saved scenarios");
  lines.push("");
  if (session.scenarios.length === 0) {
    lines.push("No scenarios saved.");
  } else {
    session.scenarios.forEach((s) => {
      lines.push(
        `- ${s.name} - saved ${new Date(s.createdAt).toLocaleString()}${
          s.notes ? ` - ${s.notes}` : ""
        }`,
      );
    });
  }
  lines.push("");
  lines.push(
    `Final selected scenario: ${finalScenario ? finalScenario.name : "none (working state)"}.`,
  );
  lines.push("");

  const warnings = session.proposals.flatMap((p) =>
    p.instructions
      .filter((i) => i.status !== "ok" && i.reason)
      .map((i) => `- "${i.original_text}" - ${i.status}: ${i.reason}`),
  );
  lines.push("## Validation warnings");
  lines.push("");
  lines.push(warnings.length === 0 ? "None." : warnings.join("\n"));
  lines.push("");

  lines.push("## Limitations");
  lines.push("");
  lines.push(
    "- This is a stylized visualization prototype with an illustrative scale; it has no established clinical validity.",
  );
  lines.push(
    "- It is not an electronic medical record, not a clinical audit trail, and not a diagnostic or surgical-planning tool.",
  );
  lines.push(
    "- No patient-identifying data, diagnoses or clinical recommendations are recorded.",
  );
  lines.push("");

  return lines.join("\n");
}
