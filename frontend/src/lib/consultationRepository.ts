import {
  clearArchivedConsultations,
  deleteArchivedConsultation,
  listArchivedConsultations,
  saveArchivedConsultation,
} from "./historyStore";
import type { ArchivedConsultation } from "./historyStore";
import {
  clearRemoteConsultations,
  deleteRemoteConsultation,
  listRemoteConsultations,
  saveRemoteConsultation,
} from "../services/consultationApi";

/**
 * Consultation archive facade.
 *
 * The SQLite database behind the local FastAPI service is the primary store.
 * IndexedDB is kept as an on-device cache/fallback so the archive still works
 * when the backend is not running. Records created in the old browser-only
 * store are migrated to SQLite the first time the backend is reachable.
 */

export type ConsultationStorage = "database" | "local";

export interface ConsultationArchive {
  entries: ArchivedConsultation[];
  storage: ConsultationStorage;
  /** Present when the database was unreachable and the local cache was used. */
  error: string | null;
}

function byNewest(a: ArchivedConsultation, b: ArchivedConsultation): number {
  return b.savedAt - a.savedAt;
}

export async function loadConsultationArchive(): Promise<ConsultationArchive> {
  let local: ArchivedConsultation[] = [];
  try {
    local = await listArchivedConsultations();
  } catch {
    local = [];
  }

  try {
    const remote = await listRemoteConsultations();
    const remoteById = new Map(remote.map((record) => [record.id, record]));

    // Upload records that exist only in the offline cache, plus cached copies
    // that are newer than the database (for example an edit made while the
    // backend was down and the debounced save never reached it).
    const pendingUpload = local.filter((record) => {
      const stored = remoteById.get(record.id);
      return !stored || record.savedAt > stored.savedAt;
    });
    await Promise.allSettled(
      pendingUpload.map((record) => saveRemoteConsultation(record)),
    );

    const effective = new Map(remoteById);
    for (const record of pendingUpload) effective.set(record.id, record);
    const entries = [...effective.values()].sort(byNewest);

    // Mirror the reconciled archive locally for offline reads.
    await Promise.allSettled(
      entries.map((record) => saveArchivedConsultation(record)),
    );

    return { entries, storage: "database", error: null };
  } catch (error) {
    return {
      entries: local.sort(byNewest),
      storage: "local",
      error:
        error instanceof Error
          ? error.message
          : "The consultation database is unavailable.",
    };
  }
}

export async function persistConsultation(
  record: ArchivedConsultation,
): Promise<{ storage: ConsultationStorage; error: string | null }> {
  // Always keep the local cache so the record survives a backend restart.
  await saveArchivedConsultation(record);
  try {
    await saveRemoteConsultation(record);
    return { storage: "database", error: null };
  } catch (error) {
    return {
      storage: "local",
      error:
        error instanceof Error
          ? error.message
          : "The consultation database is unavailable.",
    };
  }
}

export async function deleteConsultationRecord(
  id: string,
): Promise<ConsultationStorage> {
  await deleteArchivedConsultation(id);
  try {
    await deleteRemoteConsultation(id);
    return "database";
  } catch {
    return "local";
  }
}

export async function clearConsultationArchive(): Promise<ConsultationStorage> {
  await clearArchivedConsultations();
  try {
    await clearRemoteConsultations();
    return "database";
  } catch {
    return "local";
  }
}
