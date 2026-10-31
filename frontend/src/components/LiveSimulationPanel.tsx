import { useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import { StatusMessage } from "./StatusMessage";
import type { LiveEvent, LiveExecutionStatus } from "../scene/live/types";
import type { LiveStatus } from "../hooks/useLiveSimulation";
import type { ServerVoiceDiscard, ServerVoiceFinal } from "../hooks/useServerVoice";
import type { VoiceMode } from "../lib/voiceConfig";
import { VoiceGoldRecorder } from "./VoiceGoldRecorder";
import {
  LIVE_STATUS_LABEL,
  buildLiveCsv,
  buildLiveJson,
  buildLivePdf,
  buildLiveText,
} from "../scene/live/logic";

interface LiveSimulationPanelProps {
  status: LiveStatus;
  supported: boolean;
  sessionActive: boolean;
  interim: string;
  error: string;
  events: LiveEvent[];
  onStart: () => void;
  onStop: () => void;
  onRetry: () => void;
  onDismissError: () => void;
  onSubmitTyped: (text: string) => void;
  voiceMode?: VoiceMode;
  serverState?: string;
  pttActive?: boolean;
  muted?: boolean;
  /** False means live voice opens the normal proposal review instead of applying. */
  autoApply?: boolean;
  lastFinal?: ServerVoiceFinal | null;
  lastDiscard?: ServerVoiceDiscard | null;
  onPttStart?: () => void;
  onPttEnd?: () => void;
  onToggleMute?: () => void;
  devTools?: boolean;
  autoApplyEnabled?: boolean;
  onToggleAutoApply?: () => void;
}

const STATUS_LABEL: Record<LiveStatus, string> = {
  idle: "Live simulation off",
  listening: "Listening · changes apply automatically",
  error: "Attention needed",
};

const EXEC_TONE: Record<LiveExecutionStatus, string> = {
  applied: "chip--ok",
  needs_clarification: "chip--warning",
  unsupported: "chip--warning",
  out_of_range: "chip--error",
  no_change: "chip--neutral",
  not_applied: "chip--error",
};

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function stamp(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function LiveSimulationPanel({
  status,
  supported,
  sessionActive,
  interim,
  error,
  events,
  onStart,
  onStop,
  onRetry,
  onDismissError,
  onSubmitTyped,
  voiceMode = "legacy",
  serverState,
  pttActive = false,
  muted = false,
  autoApply = true,
  lastFinal = null,
  lastDiscard = null,
  onPttStart,
  onPttEnd,
  onToggleMute,
  devTools = false,
  autoApplyEnabled,
  onToggleAutoApply,
}: LiveSimulationPanelProps) {
  const [typed, setTyped] = useState("");
  const [exportNotice, setExportNotice] = useState("");

  const handleTyped = (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    onSubmitTyped(text);
    setTyped("");
  };

  const exportAs = (kind: "csv" | "json" | "pdf") => {
    if (events.length === 0) return;
    try {
      if (kind === "csv") {
        download("VoiceSurg_LiveChangeLog.csv", buildLiveCsv(events), "text/csv;charset=utf-8");
      } else if (kind === "json") {
        download("VoiceSurg_LiveChangeLog.json", buildLiveJson(events), "application/json");
      } else {
        download(
          "VoiceSurg_LiveChangeLog.pdf",
          buildLivePdf(buildLiveText(events).split("\n")),
          "application/pdf",
        );
      }
      setExportNotice(`Change log downloaded as ${kind.toUpperCase()}.`);
    } catch {
      setExportNotice(`Could not generate the ${kind.toUpperCase()} change log.`);
    }
  };

  const appliedCount = events.filter((e) => e.status === "applied").length;
  const subtitle =
    status === "listening" && !autoApply
      ? "Listening · voice results open for review"
      : STATUS_LABEL[status];
  const pttDisabled =
    !supported || !sessionActive || muted || (status === "listening" && !pttActive);

  return (
    <section className="panel live-panel" aria-label="Live simulation">
      <header className="panel__header">
        <div>
          <h2 className="panel__title">
            <Icon name="activity" size={16} /> Live simulation
          </h2>
          <p className="panel__subtitle">{subtitle}</p>
        </div>
        <span className={`chip ${status === "listening" ? "chip--ok" : status === "error" ? "chip--error" : "chip--muted"}`}>
          {voiceMode === "server" && serverState ? serverState : status}
        </span>
      </header>

      <div className="live-panel__controls">
        {status === "listening" ? (
          <button type="button" className="btn btn--danger" onClick={onStop} disabled={!sessionActive}>
            <Icon name="stop" size={16} /> Stop live simulation
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={onStart}
            disabled={!supported || !sessionActive || muted}
            title={supported ? undefined : "Voice capture is unavailable in this browser."}
          >
            <Icon name="mic" size={16} /> Start live simulation
          </button>
        )}

        {voiceMode === "server" ? (
          <>
            <button
              type="button"
              className={`btn ${pttActive ? "btn--danger" : "btn--soft"}`}
              disabled={pttDisabled}
              aria-pressed={pttActive}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                onPttStart?.();
              }}
              onPointerUp={() => onPttEnd?.()}
              onPointerLeave={() => {
                if (pttActive) onPttEnd?.();
              }}
              onPointerCancel={() => onPttEnd?.()}
              onKeyDown={(event) => {
                if (event.key !== " " && event.key !== "Enter") return;
                event.preventDefault();
                if (!event.repeat) onPttStart?.();
              }}
              onKeyUp={(event) => {
                if (event.key !== " " && event.key !== "Enter") return;
                event.preventDefault();
                onPttEnd?.();
              }}
            >
              <Icon name="mic" size={16} />{" "}
              {pttActive ? "Release to transcribe" : "Hold to talk"}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onToggleMute}
              aria-pressed={muted}
              disabled={!supported}
            >
              {muted ? "Unmute microphone" : "Mute microphone"}
            </button>
          </>
        ) : null}

        {!supported ? (
          <span className="chip chip--warning">Voice unavailable — use the typed field below.</span>
        ) : null}
        {onToggleAutoApply ? (
          <label className="toggle" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input
              type="checkbox"
              checked={autoApplyEnabled ?? autoApply}
              onChange={onToggleAutoApply}
            />
            <span>Auto-apply correct changes</span>
          </label>
        ) : null}
        {(autoApplyEnabled ?? autoApply) === false ? (
          <span className="chip chip--warning">Voice opens for review before applying.</span>
        ) : null}
        {muted ? <span className="chip chip--muted">Microphone muted</span> : null}
      </div>

      {error ? (
        <StatusMessage variant="error" title="Live voice" onDismiss={onDismissError}>
          <div className="live-panel__error">
            <span>{error}</span>
            <button type="button" className="btn btn--sm btn--soft" onClick={onRetry}>
              Retry
            </button>
          </div>
        </StatusMessage>
      ) : null}

      <div className="live-panel__transcript" aria-live="polite">
        <span className="field__label">Heard</span>
        {lastDiscard ? (
          <p className="live-transcript live-transcript--discarded">
            Ignored “{lastDiscard.rawText || "audio"}” — {lastDiscard.reason}.
          </p>
        ) : null}
        {lastFinal ? (
          <div className="live-transcript__final">
            <p className="live-transcript">{lastFinal.text}</p>
            {lastFinal.rawText !== lastFinal.text ? (
              <p className="live-transcript__raw">Raw: {lastFinal.rawText}</p>
            ) : null}
            {lastFinal.corrections.length > 0 ? (
              <p className="live-transcript__raw">
                Corrected:{" "}
                {lastFinal.corrections
                  .map((correction) => `${correction.from} → ${correction.to}`)
                  .join("; ")}
              </p>
            ) : null}
            {lastFinal.lowConfidenceNumbers.length > 0 ? (
              <p className="live-transcript__raw">
                Check number{lastFinal.lowConfidenceNumbers.length > 1 ? "s" : ""}:{" "}
                {lastFinal.lowConfidenceNumbers
                  .map((hint) => hint.token)
                  .join(", ")}
              </p>
            ) : null}
            {lastFinal.totalLatencyMs !== null ? (
              <p className="live-transcript__raw">
                Transcribed in {Math.round(lastFinal.totalLatencyMs)} ms ·{" "}
                {lastFinal.vad || "VAD"}
              </p>
            ) : null}
          </div>
        ) : null}
        {interim ? (
          <p className="live-transcript live-transcript--interim">{interim}</p>
        ) : !lastFinal && !lastDiscard ? (
          <p className="live-transcript live-transcript--empty">
            {status === "listening"
              ? "Listening… speak an instruction."
              : "Nothing heard yet."}
          </p>
        ) : null}
      </div>

      <form className="live-panel__typed" onSubmit={handleTyped}>
        <label className="field field--block">
          <span className="field__label">Type an instruction instead</span>
          <input
            className="input"
            value={typed}
            placeholder="e.g. increase the chin projection by 3 millimetres"
            onChange={(e) => setTyped(e.target.value)}
            disabled={!sessionActive}
          />
        </label>
        <button type="submit" className="btn btn--soft" disabled={!sessionActive || !typed.trim()}>
          <Icon name="send" size={16} /> Apply
        </button>
      </form>

      <div className="live-log">
        <div className="live-log__head">
          <h3 className="live-log__title">
            Change log <span className="chip chip--muted">{events.length}</span>{" "}
            <span className="chip chip--ok">{appliedCount} applied</span>
          </h3>
          <div className="live-log__actions">
            <button type="button" className="btn btn--sm btn--ghost" disabled={events.length === 0} onClick={() => exportAs("csv")}>
              <Icon name="download" size={14} /> CSV
            </button>
            <button type="button" className="btn btn--sm btn--ghost" disabled={events.length === 0} onClick={() => exportAs("json")}>
              <Icon name="download" size={14} /> JSON
            </button>
            <button type="button" className="btn btn--sm btn--ghost" disabled={events.length === 0} onClick={() => exportAs("pdf")}>
              <Icon name="download" size={14} /> PDF
            </button>
          </div>
        </div>

        {exportNotice ? (
          <StatusMessage variant="info" onDismiss={() => setExportNotice("")}>
            {exportNotice}
          </StatusMessage>
        ) : null}

        {events.length === 0 ? (
          <p className="live-log__empty">
            No live changes recorded yet. Every instruction you speak is logged
            here — applied or not.
          </p>
        ) : (
          <ol className="live-log__list">
            {[...events].reverse().map((event) => {
              const change =
                event.before !== null && event.after !== null
                  ? `${event.before} → ${event.after} ${event.normalizedUnit ?? ""}`.trim()
                  : "no model change";
              return (
                <li key={event.id} className="live-event">
                  <div className="live-event__head">
                    <span className={`chip ${EXEC_TONE[event.status]}`}>{LIVE_STATUS_LABEL[event.status]}</span>
                    <span className="live-event__meta">
                      {stamp(event.at)} · {event.source}
                    </span>
                  </div>
                  <p className="live-event__utterance">“{event.utterance}”</p>
                  <p className="live-event__detail">
                    {(event.target ?? "—").replace(/_/g, " ")} / {event.parameter ?? "—"} (
                    {event.paramKey ?? "no mapping"}) · requested {event.requestedValue ?? "—"}{" "}
                    {event.requestedUnit ?? ""} → normalised {event.normalizedValue ?? "—"}{" "}
                    {event.normalizedUnit ?? ""} · <strong>{change}</strong>
                  </p>
                  {event.reason ? <p className="live-event__reason">{event.reason}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {devTools ? <VoiceGoldRecorder /> : null}
    </section>
  );
}
