import { useCallback, useEffect, useRef, useState } from "react";
import { speechService } from "../services/speech";

/**
 * ---------------------------------------------------------------------------
 * Continuous Live Simulation voice loop (Objective 3)
 * ---------------------------------------------------------------------------
 * Drives the Web Speech API as a *continuous* conversation:
 *
 *  - `start()` opens a continuous recognition session;
 *  - every finalized utterance is emitted exactly once through `onUtterance`
 *    (immediate duplicates within 1s are collapsed so the same utterance can
 *    never trigger two geometry/parser requests);
 *  - browsers close recognition sessions on their own, so after `onEnd` the
 *    loop restarts automatically while live mode remains active;
 *  - `stop()` stops listening but never touches the consultation session, the
 *    applied history or the change log;
 *  - permission denial / missing microphone / unsupported browsers stop the
 *    loop with a typed error instead of retrying forever.
 */

export type LiveStatus = "idle" | "listening" | "error";

export interface UseLiveSimulationArgs {
  /** BCP-47 language tag. */
  lang: string;
  onUtterance: (text: string) => void;
  onError: (message: string) => void;
}

const RESTART_DELAY_MS = 300;
const DUPLICATE_WINDOW_MS = 1000;

function isFatal(message: string): boolean {
  return (
    /denied|not supported|no microphone|permission/i.test(message)
  );
}

export function useLiveSimulation({ lang, onUtterance, onError }: UseLiveSimulationArgs) {
  const [active, setActive] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  const activeRef = useRef(false);
  const restartTimer = useRef<number | null>(null);
  const lastUtterance = useRef<{ text: string; at: number } | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  const handlers = useRef({ onUtterance, onError });
  handlers.current = { onUtterance, onError };

  const clearRestart = useCallback(() => {
    if (restartTimer.current !== null) {
      window.clearTimeout(restartTimer.current);
      restartTimer.current = null;
    }
  }, []);

  const beginSession = useCallback(() => {
    speechService.startListening({
      lang: langRef.current,
      continuous: true,
      onInterim: (text) => setInterim(text),
      onFinalSegment: (text) => {
        const now = Date.now();
        const last = lastUtterance.current;
        if (last && last.text === text && now - last.at < DUPLICATE_WINDOW_MS) {
          return;
        }
        lastUtterance.current = { text, at: now };
        setInterim("");
        handlers.current.onUtterance(text);
      },
      onTranscript: () => {
        /* Live mode works per finalized segment, not per cumulative session text. */
      },
      onError: (message) => {
        if (!activeRef.current) return;
        setError(message);
        handlers.current.onError(message);
        if (isFatal(message)) {
          activeRef.current = false;
          clearRestart();
          speechService.stopListening();
          setActive(false);
        }
      },
      onEnd: () => {
        if (!activeRef.current) return;
        clearRestart();
        restartTimer.current = window.setTimeout(() => {
          restartTimer.current = null;
          if (activeRef.current) beginSession();
        }, RESTART_DELAY_MS);
      },
    });
  }, [clearRestart]);

  const start = useCallback(() => {
    if (activeRef.current) return;
    if (!speechService.isSupported) {
      const message =
        "Live voice simulation is not supported in this browser. Use the typed command field instead.";
      setError(message);
      handlers.current.onError(message);
      return;
    }
    activeRef.current = true;
    lastUtterance.current = null;
    setError("");
    setInterim("");
    setActive(true);
    beginSession();
  }, [beginSession]);

  const stop = useCallback(() => {
    activeRef.current = false;
    clearRestart();
    lastUtterance.current = null;
    speechService.stopListening();
    setActive(false);
    setInterim("");
  }, [clearRestart]);

  const clearError = useCallback(() => setError(""), []);

  const restart = useCallback(() => {
    stop();
    setError("");
    start();
  }, [start, stop]);

  // Unmount safety: never leave a recognition session running.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (restartTimer.current !== null) {
        window.clearTimeout(restartTimer.current);
        restartTimer.current = null;
      }
      speechService.stopListening();
    };
  }, []);

  const status: LiveStatus = active ? "listening" : error ? "error" : "idle";

  return {
    active,
    interim,
    error,
    status,
    supported: speechService.isSupported,
    start,
    stop,
    restart,
    clearError,
  };
}
