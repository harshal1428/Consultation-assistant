import { Icon } from "./Icon";
import type { ArchivedConsultation } from "../lib/historyStore";
import type { ConsultationStorage } from "../lib/consultationRepository";

interface ConsultationHistoryPanelProps {
  entries: ArchivedConsultation[];
  canArchive: boolean;
  /** Where the records currently live. Defaults to the local browser cache. */
  storage?: ConsultationStorage;
  onArchive: () => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onRefresh?: () => void;
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Previous consultations. The SQLite database is the primary archive; the
 * browser cache is only used when the backend is unreachable. Purely
 * presentational: storage lives in `lib/consultationRepository.ts`.
 */
export function ConsultationHistoryPanel({
  entries,
  canArchive,
  storage = "local",
  onArchive,
  onRestore,
  onDelete,
  onClear,
  onRefresh,
}: ConsultationHistoryPanelProps) {
  const usingDatabase = storage === "database";

  return (
    <section className="panel archive" aria-label="Saved consultations">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">
            <Icon name="history" size={16} />
            Previous consultations
          </h2>
          <p className="panel__subtitle">Stored consultations and their saved simulations</p>
        </div>
        <span className={`chip ${usingDatabase ? "chip--ok" : "chip--warning"}`}>
          {usingDatabase ? "SQLite database" : "Browser fallback"}
        </span>
      </div>

      <div className="archive__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onArchive}
          disabled={!canArchive}
          title={
            canArchive
              ? "Store the current consultation in the consultation database"
              : "Nothing to archive yet"
          }
        >
          <Icon name="download" size={15} />
          Archive current
        </button>
        {onRefresh ? (
          <button type="button" className="link-button" onClick={onRefresh}>
            Refresh archive
          </button>
        ) : null}
        {entries.length > 0 ? (
          <button type="button" className="link-button" onClick={onClear}>
            Clear all
          </button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="archive__empty">
          No saved consultations yet. Archives are stored in the local SQLite database and are
          never uploaded to a cloud service.
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
                  {entry.status === "ended" ? " · ended" : " · in progress"}
                </span>
                {entry.summary ? (
                  <details className="archive__details">
                    <summary>View consultation summary</summary>
                    <pre className="archive__summary">{entry.summary}</pre>
                  </details>
                ) : null}
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
        Stored in the local SQLite consultation database on this machine. If the backend is
        offline, new records are kept in the browser cache and the text is never uploaded.
      </p>
    </section>
  );
}
