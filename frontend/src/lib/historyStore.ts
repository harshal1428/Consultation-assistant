import type { ModelState } from "../scene/transformations/types";
import type { FaceMorph } from "../scene/geometry/faceMorph";
import type { FaceProfile } from "../services/faceReconstruction";
import type { LiveEvent } from "../scene/live/types";
import type {
  Proposal,
  Scenario,
  SessionEvent,
  TranscriptEntry,
} from "../scene/session/types";

/**
 * Local consultation archive.
 *
 * Completed (or in-progress) consultations can be archived to the browser's
 * IndexedDB so they survive a reload. This is strictly on-device storage: no
 * network request is made and nothing is sent to the parsing service or any
 * other endpoint. When IndexedDB is unavailable (private mode, older engines,
 * the jsdom test environment) the store transparently falls back to an
 * in-memory map so the UI keeps working without persisting.
 */

/**
 * Personalized baseline captured with an archived consultation. The uploaded
 * photo file itself is never stored — only the derived morph coefficients, the
 * sampled skin tone and the reconstructed proportion profile.
 */
export interface ArchivedPersonalization {
  morph: FaceMorph;
  skinTone: string;
  profile: FaceProfile;
  photoName: string;
}

export interface ArchivedConsultation {
  id: string;
  label: string;
  savedAt: number;
  startedAt: number;
  endedAt?: number | null;
  status: string;
  changeCount: number;
  scenarioCount: number;
  modelState: ModelState;
  summary: string;
  /** Absent on records saved before photo personalization existed. */
  personalization?: ArchivedPersonalization | null;
  /** Live Simulation change log captured with this record. */
  liveEvents?: LiveEvent[];
  /**
   * Full narrative snapshot. These are optional so older archived records
   * (and callers that only need the model state) remain valid.
   */
  transcript?: TranscriptEntry[];
  proposals?: Proposal[];
  events?: SessionEvent[];
  scenarios?: Scenario[];
}

const DB_NAME = "voicesurg-history";
const DB_VERSION = 1;
const STORE = "consultations";

let memoryStore: Map<string, ArchivedConsultation> | null = null;

function memory(): Map<string, ArchivedConsultation> {
  if (!memoryStore) memoryStore = new Map();
  return memoryStore;
}

function indexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    tx.oncomplete = () => db.close();
  });
}

export async function saveArchivedConsultation(
  record: ArchivedConsultation,
): Promise<void> {
  if (!indexedDBAvailable()) {
    memory().set(record.id, record);
    return;
  }
  try {
    await withStore("readwrite", (store) => store.put(record) as IDBRequest<IDBValidKey>);
  } catch {
    memory().set(record.id, record);
  }
}

export async function listArchivedConsultations(): Promise<ArchivedConsultation[]> {
  let records: ArchivedConsultation[];
  if (!indexedDBAvailable()) {
    records = [...memory().values()];
  } else {
    try {
      records = await withStore(
        "readonly",
        (store) => store.getAll() as IDBRequest<ArchivedConsultation[]>,
      );
    } catch {
      records = [...memory().values()];
    }
  }
  return records.sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteArchivedConsultation(id: string): Promise<void> {
  if (!indexedDBAvailable()) {
    memory().delete(id);
    return;
  }
  try {
    await withStore("readwrite", (store) => store.delete(id) as IDBRequest<undefined>);
  } catch {
    memory().delete(id);
  }
}

export async function clearArchivedConsultations(): Promise<void> {
  memory().clear();
  if (!indexedDBAvailable()) return;
  try {
    await withStore("readwrite", (store) => store.clear() as IDBRequest<undefined>);
  } catch {
    /* memory already cleared */
  }
}

/** Test/utility hook: forget the in-memory fallback. */
export function resetArchivedConsultationsMemory(): void {
  memoryStore = null;
}
