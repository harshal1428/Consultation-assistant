import type { SessionStatus } from "../scene/session/types";
import type { WorkspaceMode } from "../scene/transformations/types";
import { Icon } from "./Icon";

interface AppHeaderProps {
  sessionLabel: string;
  sessionStatus: SessionStatus;
  backendOnline: boolean | null;
  canReset: boolean;
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  onNewConsultation: () => void;
  onEndConsultation: () => void;
  onResetSimulation: () => void;
}

const MODES: { value: WorkspaceMode; label: string }[] = [
  { value: "live", label: "Live Simulation" },
  { value: "consultation", label: "Consultation" },
];

export function AppHeader({
  sessionLabel,
  sessionStatus,
  backendOnline,
  canReset,
  mode,
  onModeChange,
  onNewConsultation,
  onEndConsultation,
  onResetSimulation,
}: AppHeaderProps) {
  const backendState =
    backendOnline === null
      ? { className: "is-unknown", label: "Parsing service: checking…" }
      : backendOnline
        ? { className: "is-online", label: "Parsing service: online" }
        : { className: "is-offline", label: "Parsing service: offline" };

  const ended = sessionStatus === "ended";

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <span className="app-header__mark" aria-hidden="true">
          <Icon name="activity" size={20} />
        </span>
        <div className="app-header__titles">
          <h1>VoiceSurg 3D</h1>
          <p>Facial Consultation Workspace</p>
        </div>
      </div>

      <div className="app-header__session">
        <span className="badge badge--neutral">{sessionLabel}</span>
        <span
          className={`badge ${ended ? "badge--ended" : "badge--active"}`}
          title="This session is held only in browser memory and is lost on reload."
        >
          <Icon name={ended ? "stop" : "activity"} size={13} />
          {ended ? "Ended · temporary" : "Active · temporary"}
        </span>
        <span
          className="badge badge--prototype"
          title="This is an assistive simulation prototype, not a clinical device."
        >
          <Icon name="shield" size={13} />
          Simulation prototype
        </span>
      </div>

      <div className="app-header__mode">
        <div className="segmented" role="group" aria-label="Operating mode">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`segmented__item ${mode === m.value ? "is-active" : ""}`}
              aria-pressed={mode === m.value}
              onClick={() => onModeChange(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="app-header__actions">
        <div className={`service-status ${backendState.className}`}>
          <span className="service-status__dot" aria-hidden="true" />
          <span>{backendState.label}</span>
        </div>

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onResetSimulation}
          disabled={!canReset || ended}
          title={canReset ? "Reset working parameters to baseline" : "No changes to reset"}
        >
          <Icon name="resetView" size={15} />
          Reset simulation
        </button>

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onEndConsultation}
          disabled={ended}
        >
          <Icon name="stop" size={15} />
          End consultation
        </button>

        <button type="button" className="btn btn--primary btn--sm" onClick={onNewConsultation}>
          <Icon name="newSession" size={15} />
          New consultation
        </button>
      </div>
    </header>
  );
}
