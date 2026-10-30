import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useServerVoice } from "../src/hooks/useServerVoice";

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];

  url: string;
  readyState = FakeSocket.CONNECTING;
  binaryType = "blob";
  sent: Array<string | ArrayBuffer> = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  controls(): Array<Record<string, unknown>> {
    return this.sent
      .filter((item): item is string => typeof item === "string")
      .map((item) => JSON.parse(item) as Record<string, unknown>);
  }
}

class FakeProcessor {
  onaudioprocess: ((event: unknown) => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static processor = new FakeProcessor();

  state = "running";
  sampleRate = 16000;
  destination = {};
  audioWorklet = undefined;
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }

  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  }

  createScriptProcessor() {
    return FakeAudioContext.processor;
  }
}

const stopTrack = vi.fn();
const stream = {
  getTracks: () => [{ stop: stopTrack }],
} as unknown as MediaStream;

function installBrowser() {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  (window as any).AudioContext = FakeAudioContext;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
}

async function openSocket() {
  await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
  act(() => socket.open());
  return socket;
}

beforeEach(() => {
  FakeSocket.instances = [];
  FakeAudioContext.instances = [];
  FakeAudioContext.processor = new FakeProcessor();
  stopTrack.mockClear();
  installBrowser();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useServerVoice", () => {
  it("opens the server microphone and forwards a final transcript", async () => {
    const onUtterance = vi.fn();
    const { result, unmount } = renderHook(() => useServerVoice({ onUtterance }));

    act(() => result.current.start());
    const socket = await openSocket();

    await waitFor(() =>
      expect(socket.controls()).toContainEqual({ type: "open_mic" }),
    );
    expect(result.current.supported).toBe(true);
    expect(result.current.active).toBe(true);

    act(() => {
      socket.emit({
        type: "utterance_final",
        raw_text: "um raise the bridge by two point five millimeters",
        text: "raise the bridge by 2.5 mm",
        normalized_text: "raise the bridge by 2.5 mm",
        corrections: [],
        numbers: [{ value: 2.5, unit: "mm" }],
        low_confidence_numbers: [],
        duration_s: 1.2,
        latency_ms: 120,
        total_latency_ms: 130,
        vad: "energy-fallback",
      });
    });

    expect(onUtterance).toHaveBeenCalledWith("raise the bridge by 2.5 mm");
    expect(result.current.lastFinal?.text).toBe("raise the bridge by 2.5 mm");
    expect(result.current.lastFinal?.lowConfidenceNumbers).toEqual([]);

    unmount();
    expect(stopTrack).toHaveBeenCalled();
  });

  it("streams PCM chunks from the ScriptProcessor fallback", async () => {
    const { result, unmount } = renderHook(() =>
      useServerVoice({ onUtterance: vi.fn() }),
    );
    act(() => result.current.start());
    const socket = await openSocket();
    await waitFor(() =>
      expect(socket.controls()).toContainEqual({ type: "open_mic" }),
    );

    act(() => {
      FakeAudioContext.processor.onaudioprocess?.({
        inputBuffer: { getChannelData: () => new Float32Array(4096) },
      });
    });

    const binary = socket.sent.filter((item): item is ArrayBuffer => item instanceof ArrayBuffer);
    expect(binary).toHaveLength(1);
    expect(binary[0].byteLength).toBe(8192);
    unmount();
  });

  it("supports hold-to-talk without continuous mode", async () => {
    const { result, unmount } = renderHook(() =>
      useServerVoice({ onUtterance: vi.fn() }),
    );

    act(() => result.current.pttStart());
    const socket = await openSocket();
    await waitFor(() =>
      expect(socket.controls()).toContainEqual({ type: "ptt_start" }),
    );
    expect(result.current.pttActive).toBe(true);

    act(() => result.current.pttEnd());
    expect(socket.controls()).toContainEqual({ type: "ptt_end" });
    expect(result.current.pttActive).toBe(false);

    act(() => {
      socket.emit({
        type: "utterance_final",
        text: "raise the tip 1 mm",
        raw_text: "raise the tip 1 mm",
        corrections: [],
        numbers: [],
        low_confidence_numbers: [],
      });
      socket.emit({ type: "state", state: "idle" });
    });
    expect(result.current.active).toBe(false);
    unmount();
  });

  it("reports discarded audio instead of forwarding it", async () => {
    const onUtterance = vi.fn();
    const { result, unmount } = renderHook(() => useServerVoice({ onUtterance }));
    act(() => result.current.start());
    const socket = await openSocket();

    act(() => {
      socket.emit({
        type: "utterance_discarded",
        raw_text: "Thank you for watching",
        reason: "stock hallucination",
      });
    });

    expect(onUtterance).not.toHaveBeenCalled();
    expect(result.current.lastDiscard?.reason).toBe("stock hallucination");
    unmount();
  });

  it("mutes and unmutes through the server", async () => {
    const { result, unmount } = renderHook(() =>
      useServerVoice({ onUtterance: vi.fn() }),
    );
    act(() => result.current.start());
    const socket = await openSocket();
    await waitFor(() =>
      expect(socket.controls()).toContainEqual({ type: "open_mic" }),
    );

    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(true);
    expect(socket.controls()).toContainEqual({ type: "mute" });
    expect(stopTrack).toHaveBeenCalled();

    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(false);
    expect(socket.controls()).toContainEqual({ type: "unmute" });
    unmount();
  });

  it("stops capture and closes the socket", async () => {
    const { result, unmount } = renderHook(() =>
      useServerVoice({ onUtterance: vi.fn() }),
    );
    act(() => result.current.start());
    const socket = await openSocket();
    await waitFor(() =>
      expect(socket.controls()).toContainEqual({ type: "open_mic" }),
    );

    act(() => result.current.stop());
    expect(socket.controls()).toContainEqual({ type: "close_mic" });
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
    expect(result.current.active).toBe(false);
    unmount();
  });

  it("is unsupported when the browser cannot capture audio", () => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() =>
      useServerVoice({ onUtterance: vi.fn() }),
    );
    expect(result.current.supported).toBe(false);
  });
});
