import type { ArchivedConsultation } from "../lib/historyStore";

/**
 * REST client for the local SQLite consultation archive.
 *
 * The records live in ``backend/app/data/voicesurg.db`` (or whatever
 * ``VOICESURG_DB_PATH`` points at). This module only speaks to the local
 * FastAPI process; nothing is sent to a cloud service.
 */

const API_BASE = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 6000;

function isArchivedConsultation(value: unknown): value is ArchivedConsultation {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ArchivedConsultation>;
  return (
    typeof record.id === "string" &&
    typeof record.label === "string" &&
    typeof record.savedAt === "number" &&
    typeof record.startedAt === "number" &&
    !!record.modelState &&
    typeof record.modelState === "object"
  );
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.detail === "string") return body.detail;
  } catch {
    /* not JSON */
  }
  return `Consultation service failed (HTTP ${response.status}).`;
}

export async function listRemoteConsultations(): Promise<ArchivedConsultation[]> {
  const response = await request("/api/consultations");
  if (!response.ok) throw new Error(await readError(response));
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Consultation service returned an unexpected response shape.");
  }
  return data.filter(isArchivedConsultation);
}

export async function getRemoteConsultation(id: string): Promise<ArchivedConsultation> {
  const response = await request(`/api/consultations/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(await readError(response));
  const data: unknown = await response.json();
  if (!isArchivedConsultation(data)) {
    throw new Error("Consultation service returned an unexpected response shape.");
  }
  return data;
}

export async function saveRemoteConsultation(
  record: ArchivedConsultation,
): Promise<ArchivedConsultation> {
  const response = await request("/api/consultations", {
    method: "POST",
    body: JSON.stringify(record),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data: unknown = await response.json();
  if (!isArchivedConsultation(data)) {
    throw new Error("Consultation service returned an unexpected response shape.");
  }
  return data;
}

export async function deleteRemoteConsultation(id: string): Promise<void> {
  const response = await request(`/api/consultations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(await readError(response));
  }
}

export async function clearRemoteConsultations(): Promise<void> {
  const response = await request("/api/consultations", { method: "DELETE" });
  if (!response.ok) throw new Error(await readError(response));
}
