import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Instruction } from "../src/scene/transformations/types";

const voiceMock = vi.hoisted(() => ({
  onUtterance: null as ((text: string) => void) | null,
  startCalls: 0,
  start: () => {
    voiceMock.startCalls += 1;
  },
  stop: () => undefined,
  restart: () => undefined,
  clearError: () => undefined,
  pttStart: () => undefined,
  pttEnd: () => undefined,
  toggleMute: () => undefined,
}));

vi.mock("../src/components/FaceViewer", () => ({
  FaceViewer: () => null,
}));

vi.mock("../src/services/api", () => ({
  API_BASE: "http://127.0.0.1:8000",
  voiceWebSocketUrl: () => "ws://127.0.0.1:8000/ws/voice",
  parseCommandAPI: vi.fn(),
  checkBackendHealth: vi.fn().mockResolvedValue(true),
}));

vi.mock("../src/services/consultationApi", () => ({
  listRemoteConsultations: vi.fn().mockResolvedValue([]),
  getRemoteConsultation: vi.fn(),
  saveRemoteConsultation: vi.fn(async (record: unknown) => record),
  deleteRemoteConsultation: vi.fn().mockResolvedValue(undefined),
  clearRemoteConsultations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/hooks/useServerVoice", () => ({
  useServerVoice: (args: { onUtterance: (text: string) => void }) => {
    voiceMock.onUtterance = args.onUtterance;
    return {
      active: false,
      interim: "",
      error: "",
      status: "idle" as const,
      supported: true,
      serverState: "idle",
      muted: false,
      pttActive: false,
      lastFinal: null,
      lastDiscard: null,
      ...voiceMock,
    };
  },
}));

import App from "../src/App";
import { parseCommandAPI } from "../src/services/api";

const parseMock = vi.mocked(parseCommandAPI);

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

beforeEach(() => {
  parseMock.mockReset();
  voiceMock.onUtterance = null;
  voiceMock.startCalls = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("server voice", () => {
  it("uses the server capture path from the consultation microphone", async () => {
    parseMock.mockResolvedValue({ instructions: [instr()], text: "x" });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /start listening/i }));
    expect(voiceMock.startCalls).toBe(1);

    await act(async () => {
      voiceMock.onUtterance?.("raise the tip by 2 mm");
    });

    expect(
      await screen.findByRole("heading", { name: /Proposed change/ }),
    ).toBeInTheDocument();
    expect(parseMock).toHaveBeenCalledWith(
      "raise the tip by 2 mm",
      expect.any(Array),
      "voice",
    );
  });

  it("opens review instead of auto-applying by default", async () => {
    parseMock.mockResolvedValue({ instructions: [instr()], text: "x" });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Live Simulation/i }));
    expect(voiceMock.onUtterance).toBeTypeOf("function");

    await act(async () => {
      voiceMock.onUtterance?.("raise the tip by 2 mm");
    });

    expect(
      await screen.findByRole("heading", { name: /Proposed change/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirm & simulate/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Applied")).toBeNull();
    expect(parseMock).toHaveBeenCalledWith(
      "raise the tip by 2 mm",
      expect.any(Array),
      "voice",
    );
  });
});
