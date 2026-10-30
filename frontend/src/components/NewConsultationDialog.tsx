import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Icon } from "./Icon";
import type { PatientIdentity } from "../lib/patient";

interface NewConsultationDialogProps {
  open: boolean;
  /** Surgeon is carried over because the same clinician usually starts the next consultation. */
  initialSurgeon: string;
  /** Whether the current workspace has work worth archiving. */
  hasCurrentWork: boolean;
  /** Whether the current consultation has patient/surgeon details and can be archived. */
  currentCanBeArchived: boolean;
  currentPatientName: string;
  onCancel: () => void;
  onConfirm: (identity: PatientIdentity) => void;
}

/**
 * Collects the new patient's identity before the workspace is replaced. The
 * patient fields are intentionally blank so a new consultation cannot silently
 * inherit the previous patient.
 */
export function NewConsultationDialog({
  open,
  initialSurgeon,
  hasCurrentWork,
  currentCanBeArchived,
  currentPatientName,
  onCancel,
  onConfirm,
}: NewConsultationDialogProps) {
  const [patientName, setPatientName] = useState("");
  const [patientId, setPatientId] = useState("");
  const [surgeonName, setSurgeonName] = useState(initialSurgeon);
  const [error, setError] = useState("");
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPatientName("");
    setPatientId("");
    setSurgeonName(initialSurgeon);
    setError("");
    firstInputRef.current?.focus();
  }, [open, initialSurgeon]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = patientName.trim();
    const trimmedSurgeon = surgeonName.trim();
    if (!trimmedName) {
      setError("Enter the patient name.");
      return;
    }
    if (!trimmedSurgeon) {
      setError("Enter the surgeon name.");
      return;
    }
    onConfirm({
      patientId: patientId.trim(),
      patientName: trimmedName,
      surgeonName: trimmedSurgeon,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-consultation-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <h2 className="modal__title" id="new-consultation-title">
              <Icon name="newSession" size={16} />
              New consultation
            </h2>
            <p className="modal__subtitle">
              Start a fresh, independent workspace for a new patient.
            </p>
          </div>
        </div>

        <form onSubmit={submit}>
          <div className="modal__body">
            <p className="patient-dialog__intro">
              {hasCurrentWork
                ? currentCanBeArchived
                  ? `The current consultation${
                      currentPatientName ? ` for ${currentPatientName}` : ""
                    } is archived first, then its workspace is cleared.`
                  : "The current consultation has no complete patient/surgeon details, so it will not be archived. Enter them before starting a new consultation if you need to keep it."
                : "A fresh consultation workspace will be created."}
            </p>

            <div className="patient-dialog__grid">
              <label className="field" htmlFor="new-patient-name">
                <span className="field__label">Patient name *</span>
                <input
                  ref={firstInputRef}
                  id="new-patient-name"
                  className="input"
                  type="text"
                  value={patientName}
                  placeholder="e.g. Asha Rao"
                  autoComplete="off"
                  onChange={(event) => setPatientName(event.target.value)}
                />
              </label>

              <label className="field" htmlFor="new-patient-id">
                <span className="field__label">Patient ID / MRN</span>
                <input
                  id="new-patient-id"
                  className="input"
                  type="text"
                  value={patientId}
                  placeholder="Optional local identifier"
                  autoComplete="off"
                  onChange={(event) => setPatientId(event.target.value)}
                />
              </label>

              <label className="field" htmlFor="new-surgeon-name">
                <span className="field__label">Surgeon *</span>
                <input
                  id="new-surgeon-name"
                  className="input"
                  type="text"
                  value={surgeonName}
                  placeholder="e.g. Dr. Mehta"
                  autoComplete="off"
                  onChange={(event) => setSurgeonName(event.target.value)}
                />
              </label>
            </div>

            {error ? (
              <p className="patient-dialog__error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="modal__footer">
            <button type="button" className="btn btn--ghost" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary">
              Start new consultation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
