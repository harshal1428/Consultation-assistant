/**
 * Patient / surgeon identity for one consultation.
 *
 * A consultation always belongs to one patient and one surgeon. The patient id
 * is optional (many clinics use a local id or MRN that may not be available at
 * the point of care); the patient name and surgeon name are required before a
 * record can be archived.
 */
export interface PatientIdentity {
  patientId: string;
  patientName: string;
  surgeonName: string;
}

export const EMPTY_PATIENT_IDENTITY: PatientIdentity = {
  patientId: "",
  patientName: "",
  surgeonName: "",
};

export function isPatientIdentityComplete(identity: PatientIdentity): boolean {
  return identity.patientName.trim().length > 0 && identity.surgeonName.trim().length > 0;
}

/** Display label for a patient, including records saved before patient fields existed. */
export function patientDisplayName(identity: { patientName?: string }): string {
  return (identity.patientName ?? "").trim() || "Unassigned patient";
}

/**
 * Stable grouping key for the previous-consultations list. Prefer the explicit
 * patient id; fall back to a case-insensitive name so a patient's consultations
 * stay together even when the id was not entered.
 */
export function patientGroupKey(identity: {
  patientId?: string;
  patientName?: string;
}): string {
  const id = (identity.patientId ?? "").trim().toLowerCase();
  if (id) return `id:${id}`;
  const name = (identity.patientName ?? "").trim().toLowerCase();
  return `name:${name || "unassigned"}`;
}

/** Normalize free-form form input before storing it in a record. */
export function normalizePatientIdentity(identity: PatientIdentity): PatientIdentity {
  return {
    patientId: identity.patientId.trim(),
    patientName: identity.patientName.trim(),
    surgeonName: identity.surgeonName.trim(),
  };
}
