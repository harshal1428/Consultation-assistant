import { useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import { StatusMessage } from "./StatusMessage";
import type { LiveEvent, LiveExecutionStatus } from "../scene/live/types";
import type { LiveStatus } from "../hooks/useLiveSimulation";
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

  return (
    <section className="panel live-panel" aria-label="Live simulation">
      <header className="panel__header">
        <div>
          <h2 className="panel__title">
            <Icon name="activity" size={16} /> Live simulation
          </h2>
          <p className="panel__subtitle">{STATUS_LABEL[status]}</p>
        </div>
        <span className={`chip ${status === "listening" ? "chip--ok" : status === "error" ? "chip--error" : "chip--muted"}`}>
          {status}
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
            disabled={!supported || !sessionActive}
            title={supported ? undefined : "Speech recognition is unavailable in this browser."}
          >
            <Icon name="mic" size={16} /> Start live simulation
          </button>
        )}
        {!supported ? (
          <span className="chip chip--warning">Voice unavailable — use the typed field below.</span>
        ) : null}
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
        {interim ? (
          <p className="live-transcript live-transcript--interim">{interim}</p>
        ) : (
          <p className="live-transcript live-transcript--empty">
            {status === "listening"
              ? "Listening… speak an instruction."
              : "Nothing heard yet."}
          </p>
        )}
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
    </section>
  );
}
