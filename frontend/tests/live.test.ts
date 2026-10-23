import { describe, expect, it } from "vitest";
import {
  buildLiveCsv,
  buildLiveJson,
  buildLivePdf,
  buildLiveText,
  evaluateLiveInstruction,
  makeLiveEvent,
} from "../src/scene/live/logic";
import { LIVE_EVENT_CSV_HEADER } from "../src/scene/live/logic";
import type { LiveEvent } from "../src/scene/live/types";
import type { Instruction, ModelState } from "../src/scene/transformations/types";
import { initialModelState } from "../src/scene/transformations/types";

function instruction(overrides: Partial<Instruction> = {}): Instruction {
  return {
    target: "chin",
    parameter: "projection",
    operation: "increase",
    value: 3,
    requested_value: 3,
    requested_unit: "mm",
    unit: "mm",
    direction: null,
    adjusted_value: null,
    confidence: 0.9,
    requires_confirmation: false,
    status: "ok",
    reason: null,
    original_text: "increase the chin projection by 3 mm",
    parser: "rules",
    ...overrides,
  };
}

const ctx = { id: "cmd-1", at: 1_700_000_000_000 };

describe("evaluateLiveInstruction", () => {
  it("auto-applies a clear, in-bounds, mapped instruction", () => {
    const state: ModelState = { ...initialModelState };
    const result = evaluateLiveInstruction(instruction(), state, ctx);
    expect(result.status).toBe("applied");
    expect(result.paramKey).toBe("chinProjection");
    expect(result.before).toBe(0);
    expect(result.after).toBe(3);
    expect(result.command).not.toBeNull();
    expect(result.command?.id).toBe("cmd-1");
    expect(result.command?.source).toBe("voice");
  });

  it("does not apply an instruction the parser flagged as out of range", () => {
    const result = evaluateLiveInstruction(
      instruction({ adjusted_value: 8 }),
      { ...initialModelState },
      ctx,
    );
    expect(result.status).toBe("out_of_range");
    expect(result.command).toBeNull();
    expect(result.reason).toMatch(/outside the supported range/i);
  });

  it("treats a range rejection as out_of_range even when the parser labels it clarification", () => {
    const result = evaluateLiveInstruction(
      instruction({
        status: "needs_clarification",
        adjusted_value: 10,
        requested_value: 100,
        value: 100,
        reason: "Requested 100 mm exceeds the range.",
      }),
      { ...initialModelState },
      ctx,
    );
    expect(result.status).toBe("out_of_range");
    expect(result.command).toBeNull();
  });

  it("records needs_clarification without applying", () => {
    const result = evaluateLiveInstruction(
      instruction({ status: "needs_clarification", reason: "Which side?" }),
      { ...initialModelState },
      ctx,
    );
    expect(result.status).toBe("needs_clarification");
    expect(result.command).toBeNull();
    expect(result.reason).toBe("Which side?");
  });

  it("records unsupported without applying", () => {
    const result = evaluateLiveInstruction(
      instruction({ status: "unsupported" }),
      { ...initialModelState },
      ctx,
    );
    expect(result.status).toBe("unsupported");
    expect(result.command).toBeNull();
  });

  it("rejects a target/parameter pair that has no model field", () => {
    const result = evaluateLiveInstruction(
      instruction({ target: "nasal_dorsum", parameter: "projection" }),
      { ...initialModelState },
      ctx,
    );
    expect(result.status).toBe("unsupported");
    expect(result.paramKey).toBeNull();
    expect(result.reason).toMatch(/no model parameter/i);
  });

  it("treats a zero-magnitude or sign-less instruction as no_change", () => {
    const zero = evaluateLiveInstruction(
      instruction({ operation: null }),
      { ...initialModelState },
      ctx,
    );
    expect(zero.status).toBe("no_change");
    expect(zero.command).toBeNull();

    const none = evaluateLiveInstruction(
      instruction({ status: "no_change" }),
      { ...initialModelState },
      ctx,
    );
    expect(none.status).toBe("no_change");
  });

  it("reports the before/after values relative to the current state", () => {
    const state: ModelState = { ...initialModelState, chinProjection: -2 };
    const result = evaluateLiveInstruction(instruction(), state, ctx);
    expect(result.before).toBe(-2);
    expect(result.after).toBe(1);
  });
});

describe("makeLiveEvent", () => {
  it("captures the requested and normalised values with their units", () => {
    const ev = makeLiveEvent({
      instruction: instruction(),
      evaluation: evaluateLiveInstruction(
        instruction(),
        { ...initialModelState },
        ctx,
      ),
      utterance: "bigger chin",
      source: "live_voice",
      at: 1_700_000_000_000,
    });
    expect(ev.source).toBe("live_voice");
    expect(ev.utterance).toBe("increase the chin projection by 3 mm");
    expect(ev.requestedValue).toBe(3);
    expect(ev.requestedUnit).toBe("mm");
    expect(ev.normalizedValue).toBe(3);
    expect(ev.normalizedUnit).toBe("mm");
    expect(ev.paramKey).toBe("chinProjection");
    expect(ev.before).toBe(0);
    expect(ev.after).toBe(3);
    expect(ev.status).toBe("applied");
    expect(ev.reason).toBeNull();
  });

  it("falls back to the spoken text when the parser omits original_text", () => {
    const ev = makeLiveEvent({
      instruction: instruction({ original_text: "" }),
      evaluation: { status: "applied", reason: null, paramKey: "chinProjection", before: 0, after: 3, command: null },
      utterance: "make the chin bigger",
      source: "typed",
      at: 1,
    });
    expect(ev.utterance).toBe("make the chin bigger");
    expect(ev.source).toBe("typed");
  });
});

function sampleEvents(): LiveEvent[] {
  const appliedInstruction = instruction({ original_text: "increase, chin projection" });
  const ev = makeLiveEvent({
    instruction: appliedInstruction,
    evaluation: evaluateLiveInstruction(
      appliedInstruction,
      { ...initialModelState },
      ctx,
    ),
    utterance: "increase, chin projection",
    source: "live_voice",
    at: 1_700_000_000_000,
  });
  const rejectedInstruction = instruction({
    original_text: "make it bigger",
    status: "needs_clarification",
    reason: "Ambiguous.",
  });
  const rejected = makeLiveEvent({
    instruction: rejectedInstruction,
    evaluation: evaluateLiveInstruction(
      rejectedInstruction,
      { ...initialModelState },
      ctx,
    ),
    utterance: "make it bigger",
    source: "typed",
    at: 1_700_000_100_000,
  });
  return [ev, rejected];
}

describe("exports", () => {
  it("writes a CSV with the full header and one row per event", () => {
    const csv = buildLiveCsv(sampleEvents());
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(LIVE_EVENT_CSV_HEADER.join(","));
    expect(lines).toHaveLength(3);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("quotes CSV cells that contain commas", () => {
    const csv = buildLiveCsv(sampleEvents());
    expect(csv).toContain('"increase, chin projection"');
  });

  it("round-trips through JSON with a count", () => {
    const parsed = JSON.parse(buildLiveJson(sampleEvents()));
    expect(parsed.count).toBe(2);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0].status).toBeDefined();
    expect(parsed.events[0].execution_status).toBeUndefined();
  });

  it("describes each event including its reason", () => {
    const text = buildLiveText(sampleEvents());
    expect(text).toMatch(/Needs clarification/i);
    expect(text).toMatch(/reason: Ambiguous\./);
  });
});

describe("buildLivePdf", () => {
  it("emits a structurally valid PDF 1.4 with correct xref offsets", () => {
    const pdf = buildLivePdf(buildLiveText(sampleEvents()).split("\n"));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.endsWith("%%EOF\n")).toBe(true);

    const startxrefIndex = pdf.lastIndexOf("startxref");
    expect(startxrefIndex).toBeGreaterThan(0);
    const xrefPos = parseInt(pdf.slice(startxrefIndex).trim().split(/\s+/)[1], 10);
    expect(pdf.slice(xrefPos, xrefPos + 4)).toBe("xref");

    const lines = pdf.slice(xrefPos).split("\n");
    const count = parseInt(lines[1].split(/\s+/)[1], 10);
    expect(count).toBeGreaterThan(1);

    for (let id = 1; id < count; id++) {
      const offset = parseInt(lines[2 + id].slice(0, 10), 10);
      expect(Number.isFinite(offset)).toBe(true);
      expect(pdf.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
    }

    // Byte offsets are only meaningful if every character is single-byte.
    for (const ch of pdf) expect(ch.charCodeAt(0)).toBeLessThan(128);
  });

  it("adds a new page when the report is long", () => {
    const many = Array.from({ length: 140 }, (_, i) => `line ${i}`);
    const pdf = buildLivePdf(many);
    const startxrefIndex = pdf.lastIndexOf("startxref");
    const xrefPos = parseInt(pdf.slice(startxrefIndex).trim().split(/\s+/)[1], 10);
    const count = parseInt(pdf.slice(xrefPos).split("\n")[1].split(/\s+/)[1], 10);
    // xref size = 1 free entry + 3 fixed objects + 2 per page; 3 pages => 10.
    expect(count).toBe(10);
  });

  it("escapes parentheses and backslashes in report text", () => {
    const pdf = buildLivePdf(["a (b) c", "back\\slash"]);
    expect(pdf).toContain("(a \\(b\\) c)");
    expect(pdf).toContain("(back\\\\slash)");
  });
});
