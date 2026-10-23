import { Icon } from "./Icon";
import type { ArchivedConsultation } from "../lib/historyStore";

interface ConsultationHistoryPanelProps {
  entries: ArchivedConsultation[];
  canArchive: boolean;
  onArchive: () => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Local consultation archive (IndexedDB). Purely presentational; the storage
 * layer lives in `lib/historyStore.ts`.
 */
export function ConsultationHistoryPanel({
  entries,
  canArchive,
  onArchive,
  onRestore,
  onDelete,
  onClear,
}: ConsultationHistoryPanelProps) {
  return (
    <section className="panel archive" aria-label="Saved consultations">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">
            <Icon name="history" size={16} />
            Saved consultations
          </h2>
          <p className="panel__subtitle">Keep a consultation across reloads</p>
        </div>
        <span className="chip chip--muted">On this device</span>
      </div>

      <div className="archive__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onArchive}
          disabled={!canArchive}
          title={
            canArchive
              ? "Store the current consultation in this browser"
              : "Nothing to archive yet"
          }
        >
          <Icon name="download" size={15} />
          Archive current
        </button>
        {entries.length > 0 ? (
          <button type="button" className="link-button" onClick={onClear}>
            Clear all
          </button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="archive__empty">
          No saved consultations yet. Archived consultations stay in this browser
          and are never uploaded.
        </p>
      ) : (
        <ul className="archive__list">
          {entries.map((entry) => (
            <li key={entry.id} className="archive__item">
              <div className="archive__meta">
                <span className="archive__label">{entry.label}</span>
                <span className="archive__sub">
                  {formatWhen(entry.savedAt)} · {entry.changeCount}{" "}
                  {entry.changeCount === 1 ? "change" : "changes"}
                  {entry.scenarioCount > 0
                    ? ` · ${entry.scenarioCount} scenario${entry.scenarioCount === 1 ? "" : "s"}`
                    : ""}
                </span>
              </div>
              <div className="archive__item-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => onRestore(entry.id)}
                  aria-label={`Restore ${entry.label}`}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => onDelete(entry.id)}
                  aria-label={`Delete ${entry.label}`}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="archive__note">
        Stored locally in your browser (IndexedDB). Never uploaded or sent to the
        parsing service.
      </p>
    </section>
  );
}
