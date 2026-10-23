import { beforeEach, describe, expect, it } from "vitest";
import {
  clearArchivedConsultations,
  deleteArchivedConsultation,
  listArchivedConsultations,
  resetArchivedConsultationsMemory,
  saveArchivedConsultation,
} from "../src/lib/historyStore";
import type { ArchivedConsultation } from "../src/lib/historyStore";
import { resetModel } from "../src/scene/transformations/logic";

function record(id: string, savedAt: number): ArchivedConsultation {
  return {
    id,
    label: `Consultation ${id}`,
    savedAt,
    startedAt: savedAt - 1000,
    status: "ended",
    changeCount: 2,
    scenarioCount: 1,
    modelState: { ...resetModel(), tipHeight: 3 },
    summary: "# summary",
  };
}

beforeEach(() => {
  resetArchivedConsultationsMemory();
});

describe("consultation history store", () => {
  it("starts empty", async () => {
    expect(await listArchivedConsultations()).toEqual([]);
  });

  it("saves and lists consultations newest first", async () => {
    await saveArchivedConsultation(record("a", 1000));
    await saveArchivedConsultation(record("b", 3000));
    await saveArchivedConsultation(record("c", 2000));

    const entries = await listArchivedConsultations();
    expect(entries.map((e) => e.id)).toEqual(["b", "c", "a"]);
    expect(entries[0].modelState.tipHeight).toBe(3);
  });

  it("overwrites a record with the same id", async () => {
    await saveArchivedConsultation(record("a", 1000));
    await saveArchivedConsultation({ ...record("a", 5000), changeCount: 9 });
    const entries = await listArchivedConsultations();
    expect(entries).toHaveLength(1);
    expect(entries[0].changeCount).toBe(9);
  });

  it("deletes a single consultation", async () => {
    await saveArchivedConsultation(record("a", 1000));
    await saveArchivedConsultation(record("b", 2000));
    await deleteArchivedConsultation("a");
    const entries = await listArchivedConsultations();
    expect(entries.map((e) => e.id)).toEqual(["b"]);
  });

  it("clears everything", async () => {
    await saveArchivedConsultation(record("a", 1000));
    await saveArchivedConsultation(record("b", 2000));
    await clearArchivedConsultations();
    expect(await listArchivedConsultations()).toEqual([]);
  });
});
