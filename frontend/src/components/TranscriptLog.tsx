import type { Proposal, TranscriptEntry } from "../scene/session/types";
import { Icon } from "./Icon";

interface TranscriptLogProps {
  entries: TranscriptEntry[];
  proposals: Proposal[];
}

const OUTCOME_META: Record<
  string,
  { label: string; tone: "neutral" | "ok" | "warning" | "error" | "info" }
> = {
  pending: { label: "Awaiting review", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "ok" },
  rejected: { label: "Rejected", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "error" },
  processing: { label: "Processing…", tone: "info" },
  parsed: { label: "Parsed", tone: "info" },
  error: { label: "Error", tone: "error" },
};

function outcomeKey(entry: TranscriptEntry): string {
  if (entry.status === "processing") return "processing";
  if (entry.status === "error") return "error";
  return entry.outcome ?? "parsed";
}

export function TranscriptLog({ entries, proposals }: TranscriptLogProps) {
  if (entries.length === 0) {
    return (
      <div className="empty-state empty-state--compact">
        <Icon name="history" size={20} />
        <p>The consultation transcript will appear here.</p>
        <span>Original text and its interpretation are kept separate.</span>
      </div>
    );
  }

  return (
    <ol className="transcript-log" aria-label="Consultation transcript">
      {entries.map((entry) => {
        const proposal = entry.proposalId
          ? proposals.find((p) => p.id === entry.proposalId) ?? null
          : null;
        const meta = OUTCOME_META[outcomeKey(entry)] ?? OUTCOME_META.parsed;
        return (
          <li key={entry.id} className="transcript-entry">
            <div className="transcript-entry__head">
              <span
                className={`source-badge source-badge--${entry.source}`}
                title={entry.source === "voice" ? "Spoken input" : "Typed input"}
              >
                <Icon name={entry.source === "voice" ? "mic" : "send"} size={12} />
                {entry.source === "voice" ? "Voice" : "Typed"}
              </span>
              <time
                className="transcript-entry__time"
                dateTime={new Date(entry.createdAt).toISOString()}
              >
                {new Date(entry.createdAt).toLocaleTimeString()}
              </time>
              <span className={`chip chip--${meta.tone}`}>{meta.label}</span>
            </div>

            <p className="transcript-entry__text">“{entry.text}”</p>

            {proposal && proposal.instructions.length > 0 ? (
              <div className="transcript-entry__interpretation">
                <span className="transcript-entry__interpretation-label">
                  Interpretation
                </span>
                <ul className="transcript-entry__instructions">
                  {proposal.instructions.map((cmd) => (
                    <li key={cmd.id} className={`mini-intent mini-intent--${cmd.status}`}>
                      {cmd.target ?? "unclear region"} · {cmd.parameter ?? "—"}
                      {cmd.value !== null ? ` · ${cmd.value}${cmd.unit === "degrees" ? "°" : " mm"}` : ""}
                      {cmd.status !== "ok" ? ` — ${cmd.status.replace(/_/g, " ")}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {entry.error ? (
              <p className="transcript-entry__error">
                <Icon name="alertCircle" size={13} /> {entry.error}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
