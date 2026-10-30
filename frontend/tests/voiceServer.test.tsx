import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSimulationPanel } from "../src/components/LiveSimulationPanel";
import { parseCommandAPI } from "../src/services/api";
import { VOICE_AUTOAPPLY, VOICE_MODE } from "../src/lib/voiceConfig";
import type { ServerVoiceFinal } from "../src/hooks/useServerVoice";

function final(overrides: Partial<ServerVoiceFinal> = {}): ServerVoiceFinal {
  return {
    rawText: "um raise the bridge by two point five millimeters",
    text: "raise the bridge by 2.5 mm",
    normalizedText: "raise the bridge by 2.5 mm",
    corrections: [{ from: "aller base", to: "alar base" }],
    numbers: [{ value: 2.5, unit: "mm" }],
    lowConfidenceNumbers: [{ token: "2.5", probability: 0.4 }],
    durationS: 1.2,
    latencyMs: 120,
    totalLatencyMs: 150,
    vad: "energy-fallback",
    ...overrides,
  };
}

function renderPanel(
  overrides: Partial<Parameters<typeof LiveSimulationPanel>[0]> = {},
) {
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
    voiceMode: "server",
    serverState: "idle",
    onPttStart: vi.fn(),
    onPttEnd: vi.fn(),
    onToggleMute: vi.fn(),
    ...overrides,
  };
  render(<LiveSimulationPanel {...props} />);
  return props;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("server voice mode", () => {
  it("defaults to server capture and review-first voice", () => {
    expect(VOICE_MODE).toBe("server");
    expect(VOICE_AUTOAPPLY).toBe(false);
  });

  it("posts the provenance to the existing parse endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ instructions: [], text: "x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await parseCommandAPI("raise the bridge by 2 mm", [], "voice");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.source).toBe("voice");
    expect(body.text).toBe("raise the bridge by 2 mm");
  });

  it("shows hold-to-talk and mute controls", () => {
    const props = renderPanel();
    fireEvent.pointerDown(screen.getByRole("button", { name: /hold to talk/i }), {
      button: 0,
    });
    expect(props.onPttStart).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: /mute microphone/i }));
    expect(props.onToggleMute).toHaveBeenCalledOnce();
  });

  it("releases hold-to-talk on pointer up and while active", () => {
    const props = renderPanel({ pttActive: true });
    const button = screen.getByRole("button", { name: /release to transcribe/i });
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.pointerUp(button);
    expect(props.onPttEnd).toHaveBeenCalledOnce();
  });

  it("shows the cleaned transcript, raw text, corrections and number warning", () => {
    renderPanel({ status: "listening", lastFinal: final() });

    expect(screen.getByText("raise the bridge by 2.5 mm")).toBeInTheDocument();
    expect(screen.getByText(/raw: um raise the bridge/i)).toBeInTheDocument();
    expect(screen.getByText(/aller base → alar base/i)).toBeInTheDocument();
    expect(screen.getByText(/check number: 2.5/i)).toBeInTheDocument();
    expect(screen.getByText(/energy-fallback/i)).toBeInTheDocument();
  });

  it("renders a discarded hallucination without pretending it was heard", () => {
    renderPanel({
      status: "listening",
      lastDiscard: { rawText: "Thank you for watching", reason: "stock hallucination" },
    });
    expect(screen.getByText(/ignored .*thank you for watching/i)).toBeInTheDocument();
    expect(screen.getByText(/stock hallucination/i)).toBeInTheDocument();
  });

  it("explains review-first behaviour when auto-apply is off", () => {
    renderPanel({ autoApply: false });
    expect(screen.getByText(/voice opens for review before applying/i)).toBeInTheDocument();
  });

  it("keeps the review note hidden when auto-apply is enabled", () => {
    renderPanel({ autoApply: true });
    expect(screen.queryByText(/voice opens for review before applying/i)).toBeNull();
  });
});
