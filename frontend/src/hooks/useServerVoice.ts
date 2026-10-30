import { useCallback, useEffect, useRef, useState } from "react";
import { voiceWebSocketUrl } from "../services/api";
import type { LiveStatus } from "./useLiveSimulation";

/**
 * Server-based microphone capture for Live Simulation.
 *
 * Audio is captured with an AudioWorklet when available (ScriptProcessor is the
 * compatibility fallback), converted to 16 kHz PCM16 and streamed to
 * `/ws/voice`. The backend owns VAD, ASR, normalisation and hallucination
 * guards; the frontend only displays the final text and hands it to the existing
 * parse endpoint.
 *
 * Controls:
 *  - `start` opens a continuous microphone session;
 *  - `pttStart` / `pttEnd` are hold-to-talk and work without continuous mode;
 *  - `toggleMute` releases the microphone and keeps the socket open.
 *
 * The hook never applies geometry. Decisions stay in App / the live logic.
 */

const WORKLET_URL = new URL("../audio/pcm-worklet.js", import.meta.url).href;
const CONNECT_TIMEOUT_MS = 10000;
const DUPLICATE_WINDOW_MS = 1000;

export type ServerVoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "processing"
  | "muted";

export interface VoiceCorrection {
  from: string;
  to: string;
  reason?: string;
}

export interface VoiceNumber {
  value: number;
  unit: string | null;
  raw?: string;
}

export interface VoiceNumberHint {
  token: string;
  probability: number;
}

export interface ServerVoiceFinal {
  rawText: string;
  text: string;
  normalizedText: string;
  corrections: VoiceCorrection[];
  numbers: VoiceNumber[];
  lowConfidenceNumbers: VoiceNumberHint[];
  durationS: number | null;
  latencyMs: number | null;
  totalLatencyMs: number | null;
  vad: string;
}

export interface ServerVoiceDiscard {
  rawText: string;
  reason: string;
}

export interface UseServerVoiceArgs {
  onUtterance: (text: string) => void;
  onError?: (message: string) => void;
}

interface AudioCaptureRefs {
  stream: MediaStream | null;
  context: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  sink: GainNode | null;
  processor: AudioWorkletNode | ScriptProcessorNode | null;
}

function canUseServerVoice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const AudioContextCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Boolean(
    typeof navigator.mediaDevices?.getUserMedia === "function" && AudioContextCtor,
  );
}

function floatToPcm16(samples: Float32Array, inputRate: number, targetRate = 16000): Int16Array {
  const ratio = inputRate / targetRate;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const current = samples[index] ?? 0;
    const next = samples[Math.min(index + 1, samples.length - 1)] ?? current;
    const sample = Math.max(-1, Math.min(1, current + (next - current) * fraction));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function friendlyCaptureError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone permission was denied. Allow microphone access and try again.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No microphone was found. Connect a microphone and try again.";
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return message || "Could not start microphone capture.";
}

export function useServerVoice({ onUtterance, onError }: UseServerVoiceArgs) {
  const supported = canUseServerVoice();

  const [active, setActive] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [serverState, setServerState] = useState<ServerVoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [pttActive, setPttActive] = useState(false);
  const [lastFinal, setLastFinal] = useState<ServerVoiceFinal | null>(null);
  const [lastDiscard, setLastDiscard] = useState<ServerVoiceDiscard | null>(null);

  const activeRef = useRef(false);
  const openRef = useRef(false);
  const pttRef = useRef(false);
  const mutedRef = useRef(false);
  const runIdRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const connectPromiseRef = useRef<Promise<WebSocket> | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const capturePromiseRef = useRef<Promise<void> | null>(null);
  const startCaptureRef = useRef<(() => Promise<void>) | null>(null);
  const lastUtteranceRef = useRef<{ text: string; at: number } | null>(null);
  const captureRef = useRef<AudioCaptureRefs>({
    stream: null,
    context: null,
    source: null,
    sink: null,
    processor: null,
  });
  const handlers = useRef({ onUtterance, onError });
  handlers.current = { onUtterance, onError };

  const hardStopAudio = useCallback(() => {
    const capture = captureRef.current;
    if (capture.processor) {
      if ("port" in capture.processor) {
        capture.processor.port.onmessage = null;
      } else {
        capture.processor.onaudioprocess = null;
      }
      try {
        capture.processor.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    try {
      capture.source?.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      capture.sink?.disconnect();
    } catch {
      /* already disconnected */
    }
    capture.stream?.getTracks().forEach((track) => track.stop());
    if (capture.context) {
      void capture.context.close().catch(() => undefined);
    }
    captureRef.current = {
      stream: null,
      context: null,
      source: null,
      sink: null,
      processor: null,
    };
  }, []);

  const sendControl = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }, []);

  const sendPcm = useCallback((buffer: ArrayBuffer) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(buffer);
    }
  }, []);

  const closeSocket = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    connectPromiseRef.current = null;
    if (socket) {
      try {
        socket.close(1000, "client stopped");
      } catch {
        /* already closed */
      }
    }
  }, []);

  const failCapture = useCallback((message: string) => {
    setError(message);
    handlers.current.onError?.(message);
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (payload.type === "state" && typeof payload.state === "string") {
        const state = payload.state as ServerVoiceState;
        setServerState(state);
        if (state === "processing") {
          setInterim("Transcribing…");
        } else if (state === "listening") {
          setInterim("");
          if (openRef.current && !captureRef.current.stream && !capturePromiseRef.current) {
            // Resuming after unmute: the server still has the mic open, so
            // reacquire local capture without opening a second server session.
            void (async () => {
              try {
                const capture = captureRef.current;
                if (!capture.stream) await startCaptureRef.current?.();
              } catch (err) {
                failCapture(friendlyCaptureError(err));
              }
            })();
          }
        } else if (state === "muted") {
          setMuted(true);
          mutedRef.current = true;
          activeRef.current = false;
          openRef.current = false;
          pttRef.current = false;
          setActive(false);
          setPttActive(false);
          setInterim("");
          hardStopAudio();
        } else if (state === "idle") {
          setInterim("");
          if (!openRef.current && !pttRef.current) {
            activeRef.current = false;
            setActive(false);
          }
        }
        return;
      }

      if (payload.type === "utterance_final" && typeof payload.text === "string") {
        const final: ServerVoiceFinal = {
          rawText: String(payload.raw_text ?? payload.text),
          text: payload.text,
          normalizedText: String(payload.normalized_text ?? payload.text),
          corrections: Array.isArray(payload.corrections)
            ? (payload.corrections as VoiceCorrection[])
            : [],
          numbers: Array.isArray(payload.numbers) ? (payload.numbers as VoiceNumber[]) : [],
          lowConfidenceNumbers: Array.isArray(payload.low_confidence_numbers)
            ? (payload.low_confidence_numbers as VoiceNumberHint[])
            : [],
          durationS: typeof payload.duration_s === "number" ? payload.duration_s : null,
          latencyMs: typeof payload.latency_ms === "number" ? payload.latency_ms : null,
          totalLatencyMs:
            typeof payload.total_latency_ms === "number" ? payload.total_latency_ms : null,
          vad: String(payload.vad ?? ""),
        };
        setInterim("");
        setLastFinal(final);
        setLastDiscard(null);

        const now = Date.now();
        const previous = lastUtteranceRef.current;
        if (
          !previous ||
          previous.text !== final.text ||
          now - previous.at >= DUPLICATE_WINDOW_MS
        ) {
          lastUtteranceRef.current = { text: final.text, at: now };
          handlers.current.onUtterance(final.text);
        }

        if (!openRef.current && !pttRef.current) {
          activeRef.current = false;
          setActive(false);
        }
        return;
      }

      if (payload.type === "utterance_discarded") {
        setInterim("");
        setLastDiscard({
          rawText: String(payload.raw_text ?? ""),
          reason: String(payload.reason ?? "discarded"),
        });
        if (!openRef.current && !pttRef.current) {
          activeRef.current = false;
          setActive(false);
        }
        return;
      }

      if (payload.type === "error") {
        const message = String(payload.message ?? "Voice service error.");
        setError(message);
        handlers.current.onError?.(message);
      }
    },
    [failCapture, hardStopAudio],
  );

  const ensureSocket = useCallback((): Promise<WebSocket> => {
    const existing = socketRef.current;
    if (existing && existing.readyState === WebSocket.OPEN) {
      return Promise.resolve(existing);
    }
    if (connectPromiseRef.current) return connectPromiseRef.current;

    const promise = new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(voiceWebSocketUrl());
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        connectPromiseRef.current = null;
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        reject(new Error("Voice connection timed out. Check that the backend is running."));
      }, CONNECT_TIMEOUT_MS);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        connectPromiseRef.current = null;
        resolve(socket);
      };
      socket.onerror = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          connectPromiseRef.current = null;
          reject(new Error("Could not reach the voice service on port 8000."));
        } else {
          failCapture("Voice connection error. Press Retry to reconnect.");
        }
      };
      socket.onmessage = handleMessage;
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        connectPromiseRef.current = null;
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          reject(new Error("Voice connection closed."));
          return;
        }
        if (socketRef.current === null && activeRef.current) {
          activeRef.current = false;
          openRef.current = false;
          pttRef.current = false;
          setActive(false);
          setPttActive(false);
          setServerState("idle");
          failCapture("Voice connection closed. Press Retry to reconnect.");
        }
      };
    });
    connectPromiseRef.current = promise;
    return promise;
  }, [failCapture, handleMessage]);

  const startCapture = useCallback(async (): Promise<void> => {
    if (captureRef.current.stream) return;
    if (capturePromiseRef.current) return capturePromiseRef.current;

    const attempt = (async () => {
      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!navigator.mediaDevices?.getUserMedia || !AudioContextCtor) {
        throw new Error("Server voice capture is not supported in this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      captureRef.current.stream = stream;

      let context: AudioContext;
      try {
        context = new AudioContextCtor({ sampleRate: 16000 });
      } catch {
        // Some browsers reject a forced sample rate; resampling still handles it.
        context = new AudioContextCtor();
      }
      captureRef.current.context = context;
      if (context.state === "suspended") await context.resume();

      const source = context.createMediaStreamSource(stream);
      captureRef.current.source = source;
      const sink = context.createGain();
      sink.gain.value = 0;
      sink.connect(context.destination);
      captureRef.current.sink = sink;

      if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
        try {
          await context.audioWorklet.addModule(WORKLET_URL);
          const node = new AudioWorkletNode(context, "pcm16-processor");
          node.port.onmessage = (event: MessageEvent) => {
            const data = event.data as { type?: string; buffer?: ArrayBuffer };
            if (data?.type === "pcm" && data.buffer instanceof ArrayBuffer) {
              sendPcm(data.buffer);
            }
          };
          source.connect(node);
          node.connect(sink);
          captureRef.current.processor = node;
          return;
        } catch {
          /* fall through to ScriptProcessor */
        }
      }

      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        sendPcm(
          floatToPcm16(event.inputBuffer.getChannelData(0), context.sampleRate)
            .buffer as ArrayBuffer,
        );
      };
      source.connect(processor);
      processor.connect(sink);
      captureRef.current.processor = processor;
    })();

    capturePromiseRef.current = attempt;
    try {
      await attempt;
    } catch (err) {
      hardStopAudio();
      throw err;
    } finally {
      capturePromiseRef.current = null;
    }
  }, [hardStopAudio, sendPcm]);

  // `handleMessage` may need to resume capture, but startCapture is defined
  // afterwards. A ref keeps the dependency graph acyclic.
  startCaptureRef.current = startCapture;

  const start = useCallback(() => {
    if (activeRef.current || startPromiseRef.current) return;
    if (mutedRef.current) {
      failCapture("Microphone is muted. Unmute before starting.");
      return;
    }

    const runId = ++runIdRef.current;
    const run = (async () => {
      setError("");
      setLastDiscard(null);
      setInterim("");
      setServerState("connecting");
      openRef.current = true;
      activeRef.current = true;
      setActive(true);

      try {
        await ensureSocket();
        if (runIdRef.current !== runId) {
          closeSocket();
          return;
        }
        sendControl({ type: "open_mic" });
        await startCapture();
        if (runIdRef.current !== runId) {
          hardStopAudio();
          return;
        }
        setServerState("listening");
      } catch (err) {
        if (runIdRef.current !== runId) return;
        openRef.current = false;
        activeRef.current = false;
        setActive(false);
        setServerState("idle");
        hardStopAudio();
        closeSocket();
        failCapture(friendlyCaptureError(err));
      } finally {
        if (runIdRef.current === runId) startPromiseRef.current = null;
      }
    })();
    startPromiseRef.current = run;
  }, [closeSocket, ensureSocket, failCapture, hardStopAudio, sendControl, startCapture]);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    startPromiseRef.current = null;
    openRef.current = false;
    pttRef.current = false;
    activeRef.current = false;
    sendControl({ type: "close_mic" });
    closeSocket();
    hardStopAudio();
    setActive(false);
    setPttActive(false);
    setServerState("idle");
    setInterim("");
  }, [closeSocket, hardStopAudio, sendControl]);

  const pttStart = useCallback(() => {
    if (pttRef.current || openRef.current || startPromiseRef.current) return;
    if (mutedRef.current) {
      failCapture("Microphone is muted. Unmute before talking.");
      return;
    }

    const runId = ++runIdRef.current;
    const run = (async () => {
      setError("");
      setLastDiscard(null);
      setInterim("");
      setServerState("connecting");
      pttRef.current = true;
      activeRef.current = true;
      setPttActive(true);
      setActive(true);

      try {
        await ensureSocket();
        if (runIdRef.current !== runId) {
          closeSocket();
          return;
        }
        sendControl({ type: "ptt_start" });
        await startCapture();
        if (runIdRef.current !== runId) {
          hardStopAudio();
          return;
        }
        setServerState("listening");
      } catch (err) {
        if (runIdRef.current !== runId) return;
        pttRef.current = false;
        activeRef.current = false;
        setPttActive(false);
        setActive(false);
        setServerState("idle");
        hardStopAudio();
        closeSocket();
        failCapture(friendlyCaptureError(err));
      } finally {
        if (runIdRef.current === runId) startPromiseRef.current = null;
      }
    })();
    startPromiseRef.current = run;
  }, [closeSocket, ensureSocket, failCapture, hardStopAudio, sendControl, startCapture]);

  const pttEnd = useCallback(() => {
    if (!pttRef.current) return;
    runIdRef.current += 1;
    pttRef.current = false;
    setPttActive(false);
    sendControl({ type: "ptt_end" });
    hardStopAudio();
    if (openRef.current) {
      activeRef.current = true;
      setActive(true);
    } else {
      // Keep the UI in a listening/processing state until the server emits the
      // final transcript (or a discarded result), then it returns to idle.
      activeRef.current = true;
      setActive(true);
    }
  }, [hardStopAudio, sendControl]);

  const toggleMute = useCallback(() => {
    if (mutedRef.current) {
      mutedRef.current = false;
      setMuted(false);
      sendControl({ type: "unmute" });
      if (openRef.current) {
        activeRef.current = true;
        setActive(true);
        void startCapture().catch((err) => failCapture(friendlyCaptureError(err)));
      }
      return;
    }

    mutedRef.current = true;
    setMuted(true);
    sendControl({ type: "mute" });
    pttRef.current = false;
    openRef.current = false;
    activeRef.current = false;
    setPttActive(false);
    setActive(false);
    setServerState("muted");
    setInterim("");
    hardStopAudio();
  }, [failCapture, hardStopAudio, sendControl, startCapture]);

  const clearError = useCallback(() => setError(""), []);

  const restart = useCallback(() => {
    stop();
    setError("");
    start();
  }, [start, stop]);

  useEffect(() => {
    setMuted(false);
    mutedRef.current = false;
    return () => {
      runIdRef.current += 1;
      activeRef.current = false;
      openRef.current = false;
      pttRef.current = false;
      closeSocket();
      hardStopAudio();
    };
  }, [closeSocket, hardStopAudio]);

  const status: LiveStatus = error ? "error" : active ? "listening" : "idle";

  return {
    active,
    interim,
    error,
    status,
    supported,
    serverState,
    muted,
    pttActive,
    lastFinal,
    lastDiscard,
    start,
    stop,
    restart,
    clearError,
    pttStart,
    pttEnd,
    toggleMute,
  };
}
