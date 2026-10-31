import type { Command } from "../scene/transformations/types";
import { describeCommand, formatParameter, formatTarget } from "../lib/format";
import { Icon } from "./Icon";

interface ChangeHistoryProps {
  history: Command[];
  onUndo: (index: number) => void;
  onSaveReport: () => void;
  onSavePdf: () => void;
  onReset: () => void;
}

export function ChangeHistory({
  history,
  onUndo,
  onSaveReport,
  onSavePdf,
  onReset,
}: ChangeHistoryProps) {
  return (
    <section className="panel history" aria-label="Session history">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">
            <Icon name="history" size={16} /> Session History
          </h2>
          <p className="panel__subtitle">
            {history.length === 0
              ? "No changes applied yet"
              : `${history.length} change${history.length === 1 ? "" : "s"} · in-memory only`}
          </p>
        </div>
        <div className="history__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onSavePdf}
            disabled={history.length === 0}
          >
            <Icon name="download" size={15} />
            Save PDF
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onSaveReport}
            disabled={history.length === 0}
          >
            <Icon name="download" size={15} />
            Save report
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onReset}
            disabled={history.length === 0}
          >
            <Icon name="resetView" size={15} />
            Reset
          </button>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="empty-state">
          <Icon name="history" size={22} />
          <p>Confirmed changes and manual adjustments will appear here.</p>
          <span>History is held in memory and is cleared on reload.</span>
        </div>
      ) : (
        <ol className="history-list">
          {history.map((cmd, idx) => (
            <li key={cmd.id} className="history-item">
              <span
                className={`history-item__source history-item__source--${cmd.source}`}
                title={cmd.source === "manual" ? "Manual adjustment" : "Voice command"}
              >
                <Icon name={cmd.source === "manual" ? "sliders" : "mic"} size={14} />
              </span>
              <div className="history-item__body">
                <span className="history-item__target">
                  {formatTarget(cmd.target)}
                </span>
                <span className="history-item__detail">
                  {formatParameter(cmd.parameter)} · {describeCommand(cmd)}
                </span>
              </div>
              <time className="history-item__time" dateTime={new Date(cmd.createdAt).toISOString()}>
                {new Date(cmd.createdAt).toLocaleTimeString()}
              </time>
              <button
                type="button"
                className="icon-btn"
                onClick={() => onUndo(idx)}
                aria-label={`Undo ${formatTarget(cmd.target)} ${formatParameter(cmd.parameter)} change`}
                title="Undo this change"
              >
                <Icon name="undo" size={15} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
