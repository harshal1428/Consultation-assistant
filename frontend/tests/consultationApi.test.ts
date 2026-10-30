import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRemoteConsultations,
  deleteRemoteConsultation,
  listRemoteConsultations,
  saveRemoteConsultation,
} from "../src/services/consultationApi";
import type { ArchivedConsultation } from "../src/lib/historyStore";
import { resetModel } from "../src/scene/transformations/logic";

function record(overrides: Partial<ArchivedConsultation> = {}): ArchivedConsultation {
  return {
    id: "session-1",
    label: "Consultation 10:30",
    savedAt: 2000,
    startedAt: 1000,
    endedAt: 2000,
    status: "ended",
    changeCount: 2,
    scenarioCount: 1,
    modelState: { ...resetModel(), tipHeight: 3 },
    summary: "# Summary",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consultation API client", () => {
  it("lists stored consultations from the database endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [record()],
    });
    vi.stubGlobal("fetch", fetchMock);

    const entries = await listRemoteConsultations();
    expect(entries).toHaveLength(1);
    expect(entries[0].modelState.tipHeight).toBe(3);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/consultations");
  });

  it("posts a consultation snapshot as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => record(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveRemoteConsultation(record());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/consultations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).summary).toBe("# Summary");
  });

  it("deletes one consultation and tolerates an already-missing record", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await deleteRemoteConsultation("session-1");
    await deleteRemoteConsultation("session-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears the database archive", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    await clearRemoteConsultations();
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("surfaces a backend error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ detail: "database is locked" }),
      }),
    );

    await expect(listRemoteConsultations()).rejects.toThrow(/database is locked/);
  });
});
