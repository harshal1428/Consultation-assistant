import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Instruction } from "../src/scene/transformations/types";
import type { ArchivedConsultation } from "../src/lib/historyStore";

vi.mock("../src/components/FaceViewer", () => ({
  FaceViewer: () => null,
}));

vi.mock("../src/services/api", () => ({
  parseCommandAPI: vi.fn(),
  checkBackendHealth: vi.fn().mockResolvedValue(true),
}));

// Keep the suite hermetic: never call a developer's running backend.
vi.mock("../src/services/consultationApi", () => ({
  listRemoteConsultations: vi.fn().mockResolvedValue([]),
  getRemoteConsultation: vi.fn(),
  saveRemoteConsultation: vi.fn(async (record: unknown) => record),
  deleteRemoteConsultation: vi.fn().mockResolvedValue(undefined),
  clearRemoteConsultations: vi.fn().mockResolvedValue(undefined),
}));

import App from "../src/App";
import { parseCommandAPI } from "../src/services/api";
import { listRemoteConsultations } from "../src/services/consultationApi";
import { resetModel } from "../src/scene/transformations/logic";

const parseMock = vi.mocked(parseCommandAPI);
const listMock = vi.mocked(listRemoteConsultations);

function instr(overrides: Partial<Instruction> = {}): Instruction {
  return {
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
    ...overrides,
  };
}

async function submitCommand(text = "raise the tip by 2 mm") {
  const input = screen.getByPlaceholderText(/Reduce the bridge/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
}

beforeEach(() => {
  parseMock.mockReset();
  listMock.mockReset();
  listMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("consultation workflow", () => {
  it("parses, reviews, confirms and applies a change", async () => {
    parseMock.mockResolvedValue({ instructions: [instr()], text: "x" });
    render(<App />);

    await submitCommand();
    expect(
      await screen.findByRole("heading", { name: /Proposed change/ }),
    ).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: /Confirm & simulate/i });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(await screen.findByText(/1 change · in-memory only/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Confirm & simulate/i }),
    ).not.toBeInTheDocument();
  });

  it("refuses to apply a partial change set silently, offering an explicit subset action", async () => {
    parseMock.mockResolvedValue({
      instructions: [instr(), instr({ status: "needs_clarification", value: null, reason: "missing" })],
      text: "x",
    });
    render(<App />);

    await submitCommand("raise the tip and the bridge");
    expect(await screen.findByText("Change set")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Confirm & simulate/i })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: /Apply only valid \(1\)/i }),
    );

    expect(await screen.findByText(/1 change · in-memory only/)).toBeInTheDocument();
  });

  it("ends the consultation and disables new instructions", async () => {
    parseMock.mockResolvedValue({ instructions: [instr()], text: "x" });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /End consultation/i }));

    expect(await screen.findByText(/Ended · temporary/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Reduce the bridge/i)).toBeDisabled();
  });

  it("saves a scenario and downloads a truthful consultation summary", async () => {
    parseMock.mockResolvedValue({ instructions: [instr()], text: "x" });
    const createUrl = vi.fn(() => "blob:mock");
    const revokeUrl = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeUrl;

    render(<App />);
    await submitCommand();
    fireEvent.click(
      await screen.findByRole("button", { name: /Confirm & simulate/i }),
    );

    fireEvent.change(screen.getByPlaceholderText(/Conservative tip lift/i), {
      target: { value: "Plan A" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(await screen.findByText(/Plan A.*saved/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Save report/i }));
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/Consultation summary downloaded/),
    ).toBeInTheDocument();
  });
});

describe("patient sessions", () => {
  it("starts an independent workspace for a new patient", async () => {
    parseMock.mockResolvedValue({ instructions: [instr()], text: "x" });
    render(<App />);

    await submitCommand();
    fireEvent.click(
      await screen.findByRole("button", { name: /Confirm & simulate/i }),
    );
    expect(await screen.findByText(/1 change · in-memory only/)).toBeInTheDocument();

    const currentPanel = screen.getByRole("region", { name: /Patient and surgeon/i });
    fireEvent.change(within(currentPanel).getByLabelText(/Patient name/i), {
      target: { value: "Patient A" },
    });
    fireEvent.change(within(currentPanel).getByLabelText(/Surgeon/i), {
      target: { value: "Dr. Alpha" },
    });

    fireEvent.click(screen.getByRole("button", { name: /New consultation/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Patient name/i), {
      target: { value: "Patient B" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Start new consultation/i }),
    );

    // The previous patient's change history must not leak into the new session.
    expect(screen.queryByText(/1 change · in-memory only/)).not.toBeInTheDocument();
    const nextPanel = screen.getByRole("region", { name: /Patient and surgeon/i });
    expect(within(nextPanel).getByLabelText(/Patient name/i)).toHaveValue("Patient B");
    expect(within(nextPanel).getByLabelText(/Surgeon/i)).toHaveValue("Dr. Alpha");
  });

  it("restores a previous patient's identity and saved session state", async () => {
    const record: ArchivedConsultation = {
      id: "session-restored",
      label: "Consultation 09:00",
      savedAt: Date.now(),
      startedAt: Date.now() - 60_000,
      endedAt: Date.now() - 30_000,
      status: "ended",
      patientId: "MRN-77",
      patientName: "Patient Z",
      surgeonName: "Dr. Zed",
      changeCount: 1,
      scenarioCount: 0,
      modelState: { ...resetModel(), tipHeight: 2 },
      summary: "# Saved",
      liveEvents: [],
      transcript: [
        {
          id: "t-restored",
          createdAt: Date.now() - 50_000,
          source: "typed",
          text: "restored instruction",
          status: "parsed",
          outcome: "confirmed",
        },
      ],
      proposals: [],
      events: [],
      scenarios: [],
    };
    listMock.mockResolvedValue([record]);
    render(<App />);

    // The archive is loaded asynchronously from the database.
    await screen.findByRole("heading", { name: /Patient Z/i });
    fireEvent.click(
      screen.getByRole("button", { name: /Restore Consultation 09:00/i }),
    );

    const panel = screen.getByRole("region", { name: /Patient and surgeon/i });
    expect(within(panel).getByLabelText(/Patient name/i)).toHaveValue("Patient Z");
    expect(within(panel).getByLabelText(/Patient ID/i)).toHaveValue("MRN-77");
    expect(within(panel).getByLabelText(/Surgeon/i)).toHaveValue("Dr. Zed");
    expect(await screen.findByText(/1 change · in-memory only/)).toBeInTheDocument();
  });
});

describe("operating modes", () => {
  it("defaults to consultation and switches to live simulation", () => {
    render(<App />);

    expect(
      screen.getByPlaceholderText(/Reduce the bridge/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Live Simulation/i }));

    expect(
      screen.queryByPlaceholderText(/Reduce the bridge/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/Conservative tip lift/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Nose/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Consultation$/i }));

    expect(
      screen.getByPlaceholderText(/Reduce the bridge/i),
    ).toBeInTheDocument();
  });

  it("keeps an in-progress review reachable from live simulation", async () => {
    parseMock.mockResolvedValue({ instructions: [instr()], text: "x" });
    render(<App />);

    await submitCommand();
    await screen.findByRole("heading", { name: /Proposed change/ });

    fireEvent.click(screen.getByRole("button", { name: /Live Simulation/i }));

    expect(
      screen.getByRole("heading", { name: /Proposed change/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirm & simulate/i }),
    ).toBeInTheDocument();
  });
});

describe("multi-view photo personalization workspace", () => {
  it("exposes the View / Change Photos button and no bundled reference gallery", () => {
    render(<App />);

    // The new multi-view photo manager is accessed via the header button
    expect(screen.getByRole("button", { name: /View or change patient photos/i })).toBeInTheDocument();

    // The old bundled reference gallery must be gone.
    expect(screen.queryByRole("heading", { name: /Reference portrait/i })).toBeNull();
    expect(screen.queryByAltText(/Reference 1/i)).toBeNull();
  });

  it("opens the multi-view photo manager when clicking View / Change Photos", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /View or change patient photos/i }));

    // The modal should open with the Patient Photos heading
    expect(screen.getByRole("heading", { name: /Patient Photos/i })).toBeInTheDocument();

    // Close button should work
    fireEvent.click(screen.getByRole("button", { name: /Close/i }));
    expect(screen.queryByRole("heading", { name: /Patient Photos/i })).not.toBeInTheDocument();
  });
});

describe("live simulation workspace", () => {
  function goLive() {
    fireEvent.click(screen.getByRole("button", { name: /Live Simulation/i }));
  }

  it("shows the continuous live panel with a Start control", () => {
    render(<App />);
    goLive();

    expect(
      screen.getByRole("heading", { name: /Live simulation/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /start live simulation/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no live changes recorded yet/i)).toBeInTheDocument();
  });

  it("auto-applies a typed instruction, logging it and updating the model", async () => {
    parseMock.mockResolvedValue({ instructions: [instr()], text: "x" });
    render(<App />);
    goLive();

    const input = screen.getByPlaceholderText(/increase the chin projection/i);
    fireEvent.change(input, { target: { value: "raise the tip 2 mm" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    // No confirmation step in live mode: the change applies immediately.
    expect(await screen.findByText("Applied")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Confirm & simulate/i }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText(/1 change · in-memory only/)).toBeInTheDocument();
  });

  it("records an out-of-range instruction without applying it", async () => {
    parseMock.mockResolvedValue({
      instructions: [instr({ adjusted_value: 8, value: 40, requested_value: 40 })],
      text: "x",
    });
    render(<App />);
    goLive();

    const input = screen.getByPlaceholderText(/increase the chin projection/i);
    fireEvent.change(input, { target: { value: "raise the tip 40 mm" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(await screen.findByText(/out of range · not applied/i)).toBeInTheDocument();
    expect(screen.getByText(/outside the supported range/i)).toBeInTheDocument();
    expect(screen.queryByText(/1 change · in-memory only/)).toBeNull();
  });
});
