import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ConfirmDialog } from "../src/components/ConfirmDialog";
import { TranscriptLog } from "../src/components/TranscriptLog";
import { SessionTimeline } from "../src/components/SessionTimeline";
import { ScenarioPanel } from "../src/components/ScenarioPanel";
import type {
  Proposal,
  SessionEvent,
  TranscriptEntry,
} from "../src/scene/session/types";
import type { Scenario } from "../src/scene/session/types";
import type { Command, ModelState } from "../src/scene/transformations/types";

const zeroState: ModelState = {
  bridgeHeight: 0,
  bridgeWidth: 0,
  tipHeight: 0,
  tipProjection: 0,
  tipRotation: 0,
  alarWidth: 0,
};

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: "c1",
    source: "voice",
    target: "nasal_tip",
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
    original_text: "raise the tip by 2 mm",
    parser: "rules",
    createdAt: 1,
    ...overrides,
  };
}

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog open={false} title="t" onConfirm={vi.fn()} onCancel={vi.fn()}>
        body
      </ConfirmDialog>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("cancels on Escape and backdrop, confirms on the button", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open title="Reset?" onConfirm={onConfirm} onCancel={onCancel}>
        Are you sure?
      </ConfirmDialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("TranscriptLog", () => {
  it("shows an empty state with no entries", () => {
    render(<TranscriptLog entries={[]} proposals={[]} />);
    expect(screen.getByText(/consultation transcript/i)).toBeInTheDocument();
  });

  it("keeps original text and shows the interpretation separately", () => {
    const entry: TranscriptEntry = {
      id: "t1",
      createdAt: 1,
      source: "voice",
      text: "raise the tip by 2 mm",
      status: "parsed",
      proposalId: "p1",
      outcome: "pending",
      error: null,
    };
    const proposal: Proposal = {
      id: "p1",
      createdAt: 1,
      transcriptId: "t1",
      originalText: entry.text,
      source: "voice",
      status: "ready",
      instructions: [makeCommand()],
      error: null,
      resolvedAt: null,
      appliedCommandCount: 0,
      appliedAll: false,
    };
    render(<TranscriptLog entries={[entry]} proposals={[proposal]} />);
    expect(screen.getByText(/raise the tip by 2 mm/)).toBeInTheDocument();
    expect(screen.getByText(/Interpretation/i)).toBeInTheDocument();
    expect(screen.getByText(/Voice/)).toBeInTheDocument();
  });
});

describe("SessionTimeline", () => {
  it("lists events newest first", () => {
    const events: SessionEvent[] = [
      {
        id: "e1",
        at: 1,
        type: "session_started",
        label: "Consultation started",
        detail: null,
        proposalId: null,
        commandIds: [],
        scenarioId: null,
      },
      {
        id: "e2",
        at: 2,
        type: "proposal_confirmed",
        label: "Proposal confirmed",
        detail: "Applied all 1 instruction(s).",
        proposalId: "p1",
        commandIds: ["c1"],
        scenarioId: null,
      },
    ];
    render(<SessionTimeline events={events} />);
    const labels = screen.getAllByText(/Proposal confirmed|Consultation started/);
    expect(labels[0]).toHaveTextContent("Proposal confirmed");
  });
});

describe("ScenarioPanel", () => {
  const scenarios: Scenario[] = [
    {
      id: "s1",
      name: "Conservative",
      createdAt: 1,
      state: { ...zeroState, tipHeight: 3 },
      commandIds: ["c1"],
      notes: "",
    },
  ];

  it("saves the current state under a typed name", () => {
    const onSave = vi.fn();
    render(
      <ScenarioPanel
        scenarios={[]}
        selectedId={null}
        modelState={zeroState}
        disabled={false}
        onSave={onSave}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onLoad={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Conservative tip lift/i), {
      target: { value: "My plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));
    expect(onSave).toHaveBeenCalledWith("My plan");
  });

  it("loads a scenario and guards delete behind confirmation", () => {
    const onLoad = vi.fn();
    const onDelete = vi.fn();
    render(
      <ScenarioPanel
        scenarios={scenarios}
        selectedId={null}
        modelState={zeroState}
        disabled={false}
        onSave={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
        onLoad={onLoad}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Load/i }));
    expect(onLoad).toHaveBeenCalledWith("s1");

    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });
});
