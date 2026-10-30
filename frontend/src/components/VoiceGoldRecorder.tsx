import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../services/api";
import { encodeWavMono } from "../lib/wav";

/**
 * Development-only gold recording UI.
 *
 * Enable with `DEV_TOOLS=1` on the backend and `VITE_DEV_TOOLS=true` on the
 * frontend. Clips are saved by the backend into the gitignored
 * `backend/tests/audio_local/` directory together with a manifest row.
 */

interface GoldRow {
  key: string;
  text: string;
  label: string;
  category: string;
  split: string;
}

type RecorderState = "idle" | "recording" | "ready" | "saving" | "saved";

export function VoiceGoldRecorder() {
  const [rows, setRows] = useState<GoldRow[]>([]);
  const [split, setSplit] = useState("test");
  const [selected, setSelected] = useState("");
  const [state, setState] = useState<RecorderState>("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [clip, setClip] = useState<Blob | null>(null);
  const [clipUrl, setClipUrl] = useState("");
  const [clipRate, setClipRate] = useState(16000);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clipUrlRef = useRef("");
  const chunksRef = useRef<Blob[]>([]);

  const loading = state === "recording" || state === "saving";

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const loadRows = async (nextSplit = split) => {
    setError("");
    try {
      const response = await fetch(
        `${API_BASE}/api/dev/gold-utterances?split=${encodeURIComponent(nextSplit)}`,
      );
      if (!response.ok) throw new Error(`Gold rows unavailable (HTTP ${response.status}).`);
      const payload = (await response.json()) as { rows?: GoldRow[] };
      const nextRows = payload.rows ?? [];
      setRows(nextRows);
      setSelected(nextRows[0]?.key ?? "");
      setStatus(`${nextRows.length} gold utterances loaded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load gold utterances.");
    }
  };

  useEffect(() => {
    void loadRows("test");
    return () => {
      recorderRef.current?.stop();
      stopTracks();
      if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    };
    // The component mounts only when development tools are enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRow = rows.find((row) => row.key === selected) ?? null;

  const finishRecording = async () => {
    stopTracks();
    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (chunks.length === 0) {
      setState("idle");
      setError("No audio was captured.");
      return;
    }
    const recorded = new Blob(chunks, {
      type: recorderRef.current?.mimeType || chunks[0].type || "audio/webm",
    });
    try {
      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("Audio decoding is not supported in this browser.");
      const context = new AudioContextCtor();
      try {
        const decoded = await context.decodeAudioData(await recorded.arrayBuffer());
        const channels = decoded.numberOfChannels;
        const samples = new Float32Array(decoded.length);
        for (let channel = 0; channel < channels; channel += 1) {
          const data = decoded.getChannelData(channel);
          for (let i = 0; i < data.length; i += 1) {
            samples[i] += data[i] / channels;
          }
        }
        const wav = encodeWavMono(samples, decoded.sampleRate);
        const nextClip = new Blob([wav], { type: "audio/wav" });
        if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
        const nextUrl = URL.createObjectURL(nextClip);
        clipUrlRef.current = nextUrl;
        setClip(nextClip);
        setClipUrl(nextUrl);
        setClipRate(decoded.sampleRate);
        setState("ready");
        setStatus(
          `Recorded ${decoded.duration.toFixed(1)} s at ${decoded.sampleRate} Hz.`,
        );
      } finally {
        void context.close().catch(() => undefined);
      }
    } catch (err) {
      setClip(null);
      setState("idle");
      setError(err instanceof Error ? err.message : "Could not decode the recording.");
    }
  };

  const startRecording = async () => {
    setError("");
    setStatus("");
    setClip(null);
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = "";
    setClipUrl("");
    if (typeof MediaRecorder === "undefined") {
      setError("MediaRecorder is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
      const mimeType = preferred.find((item) => MediaRecorder.isTypeSupported(item));
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("The recorder failed. Try again.");
        setState("idle");
        stopTracks();
      };
      recorder.onstop = () => void finishRecording();
      recorder.start();
      setState("recording");
      setStatus("Recording… read the selected gold utterance aloud.");
    } catch (err) {
      stopTracks();
      setState("idle");
      setError(err instanceof Error ? err.message : "Could not start recording.");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setState("ready");
    }
  };

  const saveClip = async () => {
    if (!clip || !selectedRow) return;
    setState("saving");
    setError("");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? "");
          resolve(result.includes(",") ? result.split(",", 2)[1] : result);
        };
        reader.onerror = () => reject(new Error("Could not read the recording."));
        reader.readAsDataURL(clip);
      });
      const response = await fetch(`${API_BASE}/api/dev/save-clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: selectedRow.key,
          reference_text: selectedRow.text,
          audio_base64: base64,
          sample_rate: clipRate,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Save failed (HTTP ${response.status}).`);
      }
      const payload = (await response.json()) as { file?: string };
      setState("saved");
      setStatus(`Saved ${payload.file ?? "clip"} to the local audio directory.`);
    } catch (err) {
      setState("ready");
      setError(err instanceof Error ? err.message : "Could not save the recording.");
    }
  };

  return (
    <section className="voice-recorder" aria-label="Gold voice recorder">
      <div className="voice-recorder__head">
        <div>
          <h3 className="live-log__title">Gold voice recorder</h3>
          <p className="panel__subtitle">
            Development only. Audio stays in gitignored `backend/tests/audio_local`.
          </p>
        </div>
        <span className="chip chip--warning">DEV</span>
      </div>

      <div className="voice-recorder__controls">
        <label className="field">
          <span className="field__label">Split</span>
          <select
            className="input"
            value={split}
            disabled={loading}
            onChange={(event) => {
              setSplit(event.target.value);
              void loadRows(event.target.value);
            }}
          >
            <option value="test">test</option>
            <option value="dev">dev</option>
            <option value="">all</option>
          </select>
        </label>
        <label className="field voice-recorder__utterance">
          <span className="field__label">Gold utterance</span>
          <select
            className="input"
            value={selected}
            disabled={loading || rows.length === 0}
            onChange={(event) => setSelected(event.target.value)}
          >
            {rows.map((row) => (
              <option key={row.key} value={row.key}>
                {row.key} — {row.text}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedRow ? <p className="live-transcript">“{selectedRow.text}”</p> : null}

      <div className="live-panel__controls">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void startRecording()}
          disabled={loading || !selectedRow}
        >
          {state === "recording" ? "Recording…" : "Record"}
        </button>
        <button
          type="button"
          className="btn btn--soft"
          onClick={stopRecording}
          disabled={state !== "recording"}
        >
          Stop
        </button>
        <button
          type="button"
          className="btn btn--soft"
          onClick={() => void saveClip()}
          disabled={!clip || !selectedRow || state === "saving"}
        >
          Save clip
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void loadRows()}
          disabled={loading}
        >
          Reload gold rows
        </button>
      </div>

      {clipUrl ? <audio className="voice-recorder__audio" controls src={clipUrl} /> : null}
      {status ? <p className="live-transcript__raw">{status}</p> : null}
      {error ? <p className="live-transcript--discarded">{error}</p> : null}
    </section>
  );
}
