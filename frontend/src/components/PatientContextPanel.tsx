import { Icon } from "./Icon";
import type { PatientIdentity } from "../lib/patient";
import { isPatientIdentityComplete } from "../lib/patient";

interface PatientContextPanelProps {
  identity: PatientIdentity;
  onChange: (identity: PatientIdentity) => void;
}

/**
 * Identity of the patient and surgeon the current consultation belongs to.
 * These values are written into every archived record and restored when the
 * consultation is opened again.
 */
export function PatientContextPanel({ identity, onChange }: PatientContextPanelProps) {
  const complete = isPatientIdentityComplete(identity);

  return (
    <section className="panel patient-context" aria-label="Patient and surgeon">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">
            <Icon name="user" size={16} />
            Patient &amp; surgeon
          </h2>
          <p className="panel__subtitle">Every consultation is stored against this patient</p>
        </div>
        <span className={`chip ${complete ? "chip--ok" : "chip--warning"}`}>
          {complete ? "Ready to archive" : "Details required"}
        </span>
      </div>

      <div className="patient-context__grid">
        <label className="field" htmlFor="patient-name">
          <span className="field__label">Patient name *</span>
          <input
            id="patient-name"
            className="input"
            type="text"
            value={identity.patientName}
            placeholder="e.g. Asha Rao"
            autoComplete="off"
            onChange={(event) =>
              onChange({ ...identity, patientName: event.target.value })
            }
          />
        </label>

        <label className="field" htmlFor="patient-id">
          <span className="field__label">Patient ID / MRN</span>
          <input
            id="patient-id"
            className="input"
            type="text"
            value={identity.patientId}
            placeholder="Optional local identifier"
            autoComplete="off"
            onChange={(event) => onChange({ ...identity, patientId: event.target.value })}
          />
        </label>

        <label className="field" htmlFor="surgeon-name">
          <span className="field__label">Surgeon *</span>
          <input
            id="surgeon-name"
            className="input"
            type="text"
            value={identity.surgeonName}
            placeholder="e.g. Dr. Mehta"
            autoComplete="off"
            onChange={(event) =>
              onChange({ ...identity, surgeonName: event.target.value })
            }
          />
        </label>
      </div>

      <p className="patient-context__note">
        Patient name and surgeon are required before this consultation can be archived.
        Changing these details only updates the current consultation; stored records for
        other patients are untouched.
      </p>
    </section>
  );
}
