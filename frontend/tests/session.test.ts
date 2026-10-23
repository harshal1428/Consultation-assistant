import { describe, expect, it } from "vitest";
import {
  allInstructionsApplicable,
  appendEvent,
  appendProposal,
  applicableInstructions,
  buildConsultationReport,
  buildProposal,
  buildTranscriptEntry,
  createScenario,
  createSession,
  deleteScenario,
  deriveProposalStatus,
  endSession,
  isActiveSession,
  paramDiff,
  refreshProposalStatus,
  renameScenario,
  resolveProposal,
  scenarioById,
  stateToCommands,
  updateProposal,
  updateTranscriptEntry,
} from "../src/scene/session/logic";
import { isTerminalProposal } from "../src/scene/session/types";
import { applyAllCommands, resetModel } from "../src/scene/transformations/logic";
import { SIMULATED_PARAM_KEYS } from "../src/scene/transformations/types";
import type { Command } from "../src/scene/transformations/types";
import type { ConsultationSession } from "../src/scene/session/types";

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: `cmd-${Math.random().toString(36).slice(2)}`,
    source: "voice",
    target: "nasal_bridge",
    parameter: "height",
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
    original_text: "increase the bridge by 2 mm",
    parser: "rules",
    createdAt: 1000,
    ...overrides,
  };
}

function sessionWithProposal(
  instructions: Command[],
): { session: ConsultationSession; proposalId: string; entryId: string } {
  const entry = buildTranscriptEntry({ source: "voice", text: "test utterance" });
  const proposal = buildProposal({
    transcriptId: entry.id,
    originalText: "test utterance",
    source: "voice",
  });
  const session = updateProposal(
    appendProposal(createSession(), entry, proposal),
    proposal.id,
    { instructions, status: deriveProposalStatus(instructions) },
  );
  return { session, proposalId: proposal.id, entryId: entry.id };
}

describe("session lifecycle", () => {
  it("starts active with a session_started event and ends once", () => {
    const session = createSession(500);
    expect(isActiveSession(session)).toBe(true);
    expect(session.events).toHaveLength(1);
    expect(session.events[0].type).toBe("session_started");

    const ended = endSession(session, 900);
    expect(ended.status).toBe("ended");
    expect(ended.endedAt).toBe(900);
    expect(ended.events.at(-1)?.type).toBe("session_ended");

    // Ending twice is a no-op (no duplicate event).
    expect(endSession(ended, 950).events).toHaveLength(ended.events.length);
  });
});

describe("proposal status derivation", () => {
  it("derives blocked for empty, clarification, ready and blocked", () => {
    expect(deriveProposalStatus([])).toBe("blocked");
    expect(
      deriveProposalStatus([makeCommand({ status: "needs_clarification", value: null })]),
    ).toBe("needs_clarification");
    expect(deriveProposalStatus([makeCommand()])).toBe("ready");
    expect(deriveProposalStatus([makeCommand({ status: "invalid" })])).toBe("blocked");
  });

  it("treats only fully-applicable non-empty sets as confirmed-able", () => {
    expect(allInstructionsApplicable([])).toBe(false);
    expect(allInstructionsApplicable([makeCommand()])).toBe(true);
    expect(
      allInstructionsApplicable([makeCommand(), makeCommand({ status: "invalid" })]),
    ).toBe(false);
  });

  it("filters applicable instructions to status ok with a value and target", () => {
    const applicable = applicableInstructions([
      makeCommand(),
      makeCommand({ status: "needs_clarification", value: null }),
      makeCommand({ status: "ok", value: null }),
    ]);
    expect(applicable).toHaveLength(1);
  });

  it("does not re-derive terminal or processing proposals", () => {
    const { session, proposalId } = sessionWithProposal([makeCommand()]);
    const terminal = resolveProposal(session, proposalId, "confirmed", {
      appliedCommandCount: 1,
      appliedAll: true,
    });
    const afterTerminal = refreshProposalStatus(terminal, proposalId);
    expect(afterTerminal.proposals.find((p) => p.id === proposalId)?.status).toBe(
      "confirmed",
    );

    const fresh = createSession();
    const entry = buildTranscriptEntry({ source: "voice", text: "x" });
    const proposal = buildProposal({
      transcriptId: entry.id,
      originalText: "x",
      source: "voice",
    });
    const processing = appendProposal(fresh, entry, proposal);
    const afterProcessing = refreshProposalStatus(processing, proposal.id);
    expect(afterProcessing.proposals.find((p) => p.id === proposal.id)?.status).toBe(
      "processing",
    );
  });
});

describe("resolving proposals", () => {
  it("records a terminal outcome, transcript outcome and event", () => {
    const { session, proposalId, entryId } = sessionWithProposal([makeCommand()]);
    const resolved = resolveProposal(session, proposalId, "confirmed", {
      appliedCommandCount: 1,
      appliedAll: true,
    });
    const proposal = resolved.proposals.find((p) => p.id === proposalId)!;
    expect(proposal.status).toBe("confirmed");
    expect(isTerminalProposal(proposal.status)).toBe(true);
    expect(proposal.resolvedAt).not.toBeNull();
    expect(proposal.appliedCommandCount).toBe(1);
    expect(proposal.appliedAll).toBe(true);
    expect(resolved.transcript.find((t) => t.id === entryId)?.outcome).toBe("confirmed");
    expect(resolved.events.at(-1)?.type).toBe("proposal_confirmed");

    // A terminal proposal cannot be resolved again.
    expect(resolveProposal(resolved, proposalId, "rejected")).toBe(resolved);
  });

  it("distinguishes partial from full confirmation truthfully", () => {
    const { session, proposalId } = sessionWithProposal([
      makeCommand(),
      makeCommand({ status: "invalid" }),
    ]);
    const resolved = resolveProposal(session, proposalId, "confirmed", {
      appliedCommandCount: 1,
      appliedAll: false,
    });
    expect(resolved.events.at(-1)?.detail).toContain("Applied 1 of 2");
  });

  it("sets the transcript outcome for rejection and cancellation", () => {
    const rejected = sessionWithProposal([makeCommand()]);
    const r = resolveProposal(rejected.session, rejected.proposalId, "rejected");
    expect(r.transcript.find((t) => t.id === rejected.entryId)?.outcome).toBe("rejected");

    const cancelled = sessionWithProposal([makeCommand()]);
    const c = resolveProposal(cancelled.session, cancelled.proposalId, "cancelled");
    expect(c.transcript.find((t) => t.id === cancelled.entryId)?.outcome).toBe("cancelled");
  });
});

describe("events", () => {
  it("coalesces consecutive manual_edit events for the same parameter", () => {
    let session = createSession();
    session = appendEvent(session, {
      type: "manual_edit",
      label: "Manual adjustment",
      commandIds: ["manual-bridgeHeight-1"],
    });
    session = appendEvent(session, {
      type: "manual_edit",
      label: "Manual adjustment",
      commandIds: ["manual-bridgeHeight-1"],
    });
    const manualEvents = session.events.filter((e) => e.type === "manual_edit");
    expect(manualEvents).toHaveLength(1);

    // A different parameter starts a new event.
    session = appendEvent(session, {
      type: "manual_edit",
      label: "Manual adjustment",
      commandIds: ["manual-tipHeight-1"],
    });
    expect(session.events.filter((e) => e.type === "manual_edit")).toHaveLength(2);
  });
});

describe("transcript entries", () => {
  it("updates an entry without overwriting its original text", () => {
    const entry = buildTranscriptEntry({ source: "typed", text: "original words" });
    const session = appendProposal(
      createSession(),
      entry,
      buildProposal({ transcriptId: entry.id, originalText: entry.text, source: "typed" }),
    );
    const updated = updateTranscriptEntry(session, entry.id, { status: "parsed" });
    const stored = updated.transcript.find((t) => t.id === entry.id)!;
    expect(stored.status).toBe("parsed");
    expect(stored.text).toBe("original words");
  });
});

describe("scenarios", () => {
  it("saves, renames, loads-by-id and deletes a scenario", () => {
    let session = createSession();
    const result = createScenario(session, {
      name: "  Tip lift  ",
      state: { ...resetModel(), bridgeHeight: 1, tipHeight: 3 },
      commandIds: ["a"],
    });
    session = result.session;
    expect(result.scenario.name).toBe("Tip lift");
    expect(session.events.at(-1)?.type).toBe("scenario_saved");

    session = renameScenario(session, result.scenario.id, "Tip lift v2");
    expect(scenarioById(session, result.scenario.id)?.name).toBe("Tip lift v2");

    session = deleteScenario(session, result.scenario.id);
    expect(scenarioById(session, result.scenario.id)).toBeNull();
    expect(session.events.at(-1)?.type).toBe("scenario_deleted");
  });

  it("round-trips a state through commands", () => {
    const state = {
      ...resetModel(),
      bridgeWidth: -4,
      tipHeight: 2,
      tipRotation: 15,
      alarWidth: -3,
    };
    const commands = stateToCommands(state);
    expect(commands).toHaveLength(4);
    expect(commands.every((c) => c.source === "manual")).toBe(true);
    // Re-applying the generated commands reproduces the state exactly.
    expect(applyAllCommands(commands)).toEqual(state);
  });
});

describe("comparison + report", () => {
  it("computes per-parameter deltas", () => {
    const a = resetModel();
    const b = { ...resetModel(), bridgeHeight: 2, tipHeight: -1 };
    const diff = paramDiff(a, b);
    expect(diff).toHaveLength(SIMULATED_PARAM_KEYS.length);
    expect(diff.find((d) => d.key === "bridgeHeight")?.delta).toBe(2);
    expect(diff.find((d) => d.key === "tipHeight")?.delta).toBe(-1);
    expect(diff.find((d) => d.key === "tipRotation")?.unit).toBe("\u00B0");
  });

  it("never reports unresolved proposals as confirmed", () => {
    const { session } = sessionWithProposal([makeCommand()]);
    const report = buildConsultationReport({
      session,
      history: [],
      modelState: resetModel(),
      now: 0,
    });
    expect(report).toContain("# VoiceSurg 3D");
    expect(report).toContain(session.id);
    expect(report).toContain("Storage: temporary");
    // The pending proposal is listed as unresolved, never inside confirmed changes.
    expect(report).toContain("## Rejected / unresolved proposals");
    expect(report).toContain('"test utterance" - ready');
    expect(report).toContain("No changes were applied.");
    expect(report).toContain("illustrative scale");
  });

  it("names the final selected scenario when one is chosen", () => {
    const result = createScenario(createSession(), {
      name: "Chosen",
      state: { ...resetModel(), bridgeHeight: 1 },
      commandIds: [],
    });
    const report = buildConsultationReport({
      session: result.session,
      history: [],
      modelState: result.scenario.state,
      finalScenarioId: result.scenario.id,
      now: 0,
    });
    expect(report).toContain("Final selected scenario: Chosen");
  });
});
