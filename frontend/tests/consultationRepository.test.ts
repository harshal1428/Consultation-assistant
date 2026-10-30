import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listArchivedConsultations,
  resetArchivedConsultationsMemory,
  saveArchivedConsultation,
} from "../src/lib/historyStore";
import type { ArchivedConsultation } from "../src/lib/historyStore";
import { loadConsultationArchive } from "../src/lib/consultationRepository";
import { resetModel } from "../src/scene/transformations/logic";

function record(id: string, savedAt: number): ArchivedConsultation {
  return {
    id,
    label: `Consultation ${id}`,
    savedAt,
    startedAt: savedAt - 1000,
    endedAt: savedAt,
    status: "ended",
    changeCount: 1,
    scenarioCount: 0,
    modelState: { ...resetModel(), tipHeight: 2 },
    summary: "# summary",
  };
}

beforeEach(() => {
  resetArchivedConsultationsMemory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consultation repository", () => {
  it("uses the SQLite database as the primary archive and caches it locally", async () => {
    const remote = record("session-a", 3000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [remote] }),
    );

    const archive = await loadConsultationArchive();

    expect(archive.storage).toBe("database");
    expect(archive.entries.map((entry) => entry.id)).toEqual(["session-a"]);
    expect((await listArchivedConsultations()).map((entry) => entry.id)).toEqual([
      "session-a",
    ]);
  });

  it("falls back to the browser cache when the database is unreachable", async () => {
    await saveArchivedConsultation(record("offline", 5000));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const archive = await loadConsultationArchive();

    expect(archive.storage).toBe("local");
    expect(archive.error).toMatch(/connection refused/);
    expect(archive.entries.map((entry) => entry.id)).toEqual(["offline"]);
  });

  it("uploads cached records that are missing or newer than the database", async () => {
    await saveArchivedConsultation(record("newer", 5000));
    await saveArchivedConsultation(record("local-only", 4000));

    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, json: async () => JSON.parse(String(init.body)) };
      }
      return {
        ok: true,
        json: async () => [record("newer", 1000), record("remote-only", 2000)],
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const archive = await loadConsultationArchive();
    const posted = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)).id);

    expect(posted.sort()).toEqual(["local-only", "newer"]);
    expect(archive.storage).toBe("database");
    expect(archive.entries.map((entry) => entry.id)).toEqual([
      "newer",
      "local-only",
      "remote-only",
    ]);
  });
});
