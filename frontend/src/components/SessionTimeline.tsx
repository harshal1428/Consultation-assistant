import type { SessionEvent } from "../scene/session/types";
import { Icon, type IconName } from "./Icon";

interface SessionTimelineProps {
  events: SessionEvent[];
}

const EVENT_ICON: Record<string, IconName> = {
  session_started: "activity",
  session_ended: "stop",
  proposal_created: "sparkle",
  proposal_confirmed: "check",
  proposal_rejected: "close",
  proposal_cancelled: "close",
  manual_edit: "sliders",
  undo: "undo",
  reset: "resetView",
  scenario_saved: "download",
  scenario_renamed: "edit",
  scenario_deleted: "trash",
  scenario_loaded: "folder",
  consultation_archived: "download",
  consultation_restored: "history",
};

export function SessionTimeline({ events }: SessionTimelineProps) {
  const ordered = [...events].reverse();

  return (
    <section className="panel timeline" aria-label="Consultation timeline">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">
            <Icon name="history" size={16} /> Consultation Timeline
          </h2>
          <p className="panel__subtitle">
            {events.length === 0
              ? "No consultation events yet"
              : `${events.length} event${events.length === 1 ? "" : "s"} · in-memory only`}
          </p>
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="empty-state">
          <Icon name="history" size={22} />
          <p>Session events will be listed here.</p>
          <span>This is a process log, not a clinical audit trail.</span>
        </div>
      ) : (
        <ol className="timeline-list">
          {ordered.map((event) => (
            <li key={event.id} className={`timeline-item timeline-item--${event.type}`}>
              <span className="timeline-item__dot" aria-hidden="true">
                <Icon name={EVENT_ICON[event.type] ?? "info"} size={13} />
              </span>
              <div className="timeline-item__body">
                <span className="timeline-item__label">{event.label}</span>
                {event.detail ? (
                  <span className="timeline-item__detail">{event.detail}</span>
                ) : null}
              </div>
              <time
                className="timeline-item__time"
                dateTime={new Date(event.at).toISOString()}
              >
                {new Date(event.at).toLocaleTimeString()}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
