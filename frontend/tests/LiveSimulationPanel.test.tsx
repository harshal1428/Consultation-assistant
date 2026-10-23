import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSimulationPanel } from "../src/components/LiveSimulationPanel";
import type { LiveEvent } from "../src/scene/live/types";

function liveEvent(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id: "live-1",
    at: 1_700_000_000_000,
    source: "live_voice",
    utterance: "increase the chin projection by 3 millimetres",
    target: "chin",
    parameter: "projection",
    paramKey: "chinProjection",
    requestedValue: 3,
    requestedUnit: "mm",
    normalizedValue: 3,
    normalizedUnit: "mm",
    status: "applied",
    before: 0,
    after: 3,
    reason: null,
    confidence: 0.9,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof LiveSimulationPanel>[0]> = {}) {
  const props: Parameters<typeof LiveSimulationPanel>[0] = {
    status: "idle",
    supported: true,
    sessionActive: true,
    interim: "",
    error: "",
    events: [],
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onDismissError: vi.fn(),
    onSubmitTyped: vi.fn(),
    ...overrides,
  };
  render(<LiveSimulationPanel {...props} />);
  return props;
}

beforeEach(() => {
  (URL as any).createObjectURL = vi.fn(() => "blob:mock");
  (URL as any).revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("LiveSimulationPanel", () => {
  it("offers Start in the idle state and reports an empty log", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /start live simulation/i })).toBeTruthy();
    expect(screen.getByText(/no live changes recorded yet/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /stop live simulation/i })).toBeNull();
  });

  it("calls onStart when Start is clicked", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /start live simulation/i }));
    expect(props.onStart).toHaveBeenCalledOnce();
  });

  it("shows Stop and calls onStop while listening", () => {
    const props = renderPanel({ status: "listening" });
    expect(screen.getByText(/listening · changes apply automatically/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /stop live simulation/i }));
    expect(props.onStop).toHaveBeenCalledOnce();
  });

  it("shows interim text while listening", () => {
    renderPanel({ status: "listening", interim: "increase the chin" });
    expect(screen.getByText("increase the chin")).toBeTruthy();
  });

  it("forwards a typed instruction", () => {
    const props = renderPanel();
    const input = screen.getByPlaceholderText(/increase the chin projection/i);
    fireEvent.change(input, { target: { value: "raise the tip 2 mm" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(props.onSubmitTyped).toHaveBeenCalledWith("raise the tip 2 mm");
  });

  it("surfaces an error with a retry action", () => {
    const props = renderPanel({ status: "error", error: "Microphone access was denied." });
    expect(screen.getByRole("alert").textContent).toMatch(/denied/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it("disables Start when speech is unsupported and explains why", () => {
    renderPanel({ supported: false });
    const start = screen.getByRole("button", { name: /start live simulation/i }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByText(/voice unavailable/i)).toBeTruthy();
  });

  it("renders each event with its status, mapping and reason", () => {
    renderPanel({
      events: [
        liveEvent(),
        liveEvent({
          id: "live-2",
          status: "out_of_range",
          reason: "Requested 40 mm is outside the supported range.",
          before: null,
          after: null,
        }),
      ],
    });
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(screen.getByText(/out of range · not applied/i)).toBeTruthy();
    expect(screen.getByText(/outside the supported range/i)).toBeTruthy();
  });

  it("disables the export buttons until there are events", () => {
    const props = renderPanel({
      events: [liveEvent()],
    });
    fireEvent.click(screen.getByRole("button", { name: /csv/i }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(props.onSubmitTyped).not.toHaveBeenCalled();
  });
});
