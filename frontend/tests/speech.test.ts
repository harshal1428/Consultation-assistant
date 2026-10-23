import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechService } from "../src/services/speech";

/**
 * Controllable stand-in for the browser SpeechRecognition, installed before
 * each SpeechService instance is constructed (the service reads `window` in its
 * constructor).
 */
class MockRecognition {
  static last: MockRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = "en-US";
  started = false;
  stopped = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    MockRecognition.last = this;
  }

  start() {
    this.started = true;
  }

  stop() {
    this.stopped = true;
  }
}

function resultEvent(items: { transcript: string; final: boolean }[], startIndex = 0) {
  return {
    resultIndex: startIndex,
    results: items.map((item) => {
      const result = [{ transcript: item.transcript }] as unknown as { transcript: string } & {
        isFinal: boolean;
      };
      (result as any).isFinal = item.final;
      return result;
    }),
  };
}

function makeService() {
  return new SpeechService();
}

beforeEach(() => {
  MockRecognition.last = null;
  (window as any).SpeechRecognition = MockRecognition;
  (window as any).webkitSpeechRecognition = MockRecognition;
});

describe("SpeechService continuous mode", () => {
  it("defaults to non-continuous recognition", () => {
    const service = makeService();
    service.startListening({ onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });
    expect(MockRecognition.last?.continuous).toBe(false);
  });

  it("enables continuous recognition when asked", () => {
    const service = makeService();
    service.startListening({
      continuous: true,
      onTranscript: vi.fn(),
      onError: vi.fn(),
      onEnd: vi.fn(),
    });
    expect(MockRecognition.last?.continuous).toBe(true);
    expect(MockRecognition.last?.started).toBe(true);
  });

  it("emits one onFinalSegment per finalized utterance", () => {
    const service = makeService();
    const onFinalSegment = vi.fn();
    service.startListening({
      continuous: true,
      onTranscript: vi.fn(),
      onFinalSegment,
      onError: vi.fn(),
      onEnd: vi.fn(),
    });
    const rec = MockRecognition.last!;
    rec.onresult!(resultEvent([{ transcript: "raise the tip", final: true }]));
    rec.onresult!(resultEvent([{ transcript: "and widen the jaw", final: true }]));
    expect(onFinalSegment).toHaveBeenNthCalledWith(1, "raise the tip");
    expect(onFinalSegment).toHaveBeenNthCalledWith(2, "and widen the jaw");
  });

  it("does not emit a final segment for interim-only results", () => {
    const service = makeService();
    const onFinalSegment = vi.fn();
    const onInterim = vi.fn();
    service.startListening({
      continuous: true,
      interimResults: true,
      onInterim,
      onTranscript: vi.fn(),
      onFinalSegment,
      onError: vi.fn(),
      onEnd: vi.fn(),
    } as any);
    MockRecognition.last!.onresult!(
      resultEvent([{ transcript: "raise the", final: false }]),
    );
    expect(onFinalSegment).not.toHaveBeenCalled();
    expect(onInterim).toHaveBeenCalledWith("raise the");
  });

  it("maps recognizer errors to human messages", () => {
    const service = makeService();
    const onError = vi.fn();
    service.startListening({
      onTranscript: vi.fn(),
      onError,
      onEnd: vi.fn(),
    });
    MockRecognition.last!.onerror!({ error: "not-allowed" });
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/denied/i));
  });

  it("fires onEnd and ignores stale callbacks after stop", () => {
    const service = makeService();
    const onEnd = vi.fn();
    const onFinalSegment = vi.fn();
    service.startListening({
      continuous: true,
      onTranscript: vi.fn(),
      onFinalSegment,
      onError: vi.fn(),
      onEnd,
    });
    const rec = MockRecognition.last!;
    service.stopListening();
    expect(rec.stopped).toBe(true);
    // A late result from the stopped session must not be delivered.
    rec.onresult!(resultEvent([{ transcript: "late", final: true }]));
    expect(onFinalSegment).not.toHaveBeenCalled();
  });
});
