import type {
  Command,
  Instruction,
  ModelState,
  ParamKey,
} from "../transformations/types";
import { paramKeyForInstruction } from "../../lib/params";
import { clinicalParameterFor } from "../../lib/clinicalRegistry";
import { applyCommand } from "../transformations/logic";
import { makeId } from "../session/logic";
import type { LiveEvent, LiveEventSource, LiveExecutionStatus } from "./types";

/**
 * ---------------------------------------------------------------------------
 * Live Simulation execution + export logic (Objectives 3 + 4)
 * ---------------------------------------------------------------------------
 * Pure, side-effect free. `evaluateLiveInstruction` decides whether a parsed
 * instruction may auto-apply and, when it may, returns the command together
 * with the before/after values it would produce. The caller is responsible for
 * appending the command to the history.
 *
 * An instruction is auto-applied ONLY when ALL of these hold:
 *   - the parser reports it as `ok`
 *   - no out-of-bounds adjustment was produced (`adjusted_value` is null)
 *   - a registry entry maps its (target, parameter) pair to a model field
 *   - it carries a magnitude that resolves to a non-zero change
 * Anything else is recorded as a live event with an explicit reason.
 */

export interface LiveEvaluation {
  status: LiveExecutionStatus;
  reason: string | null;
  paramKey: ParamKey | null;
  before: number | null;
  after: number | null;
  /** Populated only when `status === "applied"`. */
  command: Command | null;
}

function reject(
  status: LiveExecutionStatus,
  reason: string,
): LiveEvaluation {
  return { status, reason, paramKey: null, before: null, after: null, command: null };
}

export function evaluateLiveInstruction(
  instruction: Instruction,
  state: ModelState,
  context: { id: string; at: number },
): LiveEvaluation {
  if (instruction.status === "unsupported") {
    return reject("unsupported", instruction.reason ?? "Instruction is not supported.");
  }
  if (instruction.status === "not_simulated") {
    const clinical = clinicalParameterFor(instruction.clinical_parameter);
    return reject(
      "unsupported",
      instruction.reason ??
        `${clinical?.clinicalName ?? "This clinical parameter"} is registered and reviewable but has no verified geometry driver, so it was not applied.`,
    );
  }
  // A range rejection carries an adjusted value; report it precisely as
  // out-of-range rather than as a generic clarification request.
  if (instruction.adjusted_value !== null && instruction.adjusted_value !== undefined) {
    const requested = instruction.requested_value ?? instruction.value;
    const requestedUnit = instruction.requested_unit ?? instruction.unit ?? "";
    const key = paramKeyForInstruction(instruction);
    return {
      status: "out_of_range",
      reason: `Requested ${requested} ${requestedUnit} is outside the supported range; suggested ${instruction.adjusted_value} ${instruction.unit ?? requestedUnit}. Not applied.`.replace(/\s+/g, " "),
      paramKey: key,
      before: null,
      after: null,
      command: null,
    };
  }
  if (instruction.status === "needs_clarification") {
    return reject(
      "needs_clarification",
      instruction.reason ?? "Instruction needs clarification before it can be applied.",
    );
  }
  if (instruction.status === "invalid") {
    return reject("not_applied", instruction.reason ?? "Instruction was not valid.");
  }
  if (instruction.status === "no_change") {
    return reject("no_change", instruction.reason ?? "No change was requested.");
  }

  if (instruction.value === null) {
    return reject("no_change", "No magnitude was provided by the parser.");
  }

  const key = paramKeyForInstruction(instruction);
  if (!key) {
    return reject(
      "unsupported",
      `No model parameter maps to ${instruction.target ?? "the requested target"} / ${instruction.parameter ?? "the requested parameter"}.`,
    );
  }

  const command: Command = {
    ...instruction,
    id: context.id,
    source: "voice",
    createdAt: context.at,
  };

  const before = state[key];
  const after = applyCommand(state, command)[key];

  if (after === before) {
    return reject("no_change", "Parsed instruction resolves to a zero change.");
  }

  return { status: "applied", reason: null, paramKey: key, before, after, command };
}

export function makeLiveEvent(input: {
  instruction: Instruction;
  evaluation: LiveEvaluation;
  utterance: string;
  source: LiveEventSource;
  at: number;
}): LiveEvent {
  const { instruction, evaluation } = input;
  return {
    id: makeId("live"),
    at: input.at,
    source: input.source,
    utterance: instruction.original_text || input.utterance,
    target: instruction.target,
    parameter: instruction.parameter,
    paramKey: evaluation.paramKey,
    requestedValue: instruction.requested_value ?? instruction.value,
    requestedUnit: instruction.requested_unit ?? instruction.unit,
    normalizedValue: instruction.value,
    normalizedUnit: instruction.unit,
    status: evaluation.status,
    before: evaluation.before,
    after: evaluation.after,
    reason: evaluation.reason,
    confidence: instruction.confidence ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Export (Objective 4)                                                        */
/* -------------------------------------------------------------------------- */

export const LIVE_EVENT_CSV_HEADER = [
  "id",
  "timestamp",
  "iso",
  "source",
  "utterance",
  "target",
  "parameter",
  "parameter_key",
  "requested_value",
  "requested_unit",
  "normalized_value",
  "normalized_unit",
  "execution_status",
  "before",
  "after",
  "actual_change",
  "reason",
  "confidence",
] as const;

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function liveEventRow(event: LiveEvent): (string | number | null)[] {
  const actualChange =
    event.before !== null && event.after !== null ? event.after - event.before : null;
  return [
    event.id,
    event.at,
    new Date(event.at).toISOString(),
    event.source,
    event.utterance,
    event.target,
    event.parameter,
    event.paramKey,
    event.requestedValue,
    event.requestedUnit,
    event.normalizedValue,
    event.normalizedUnit,
    event.status,
    event.before,
    event.after,
    actualChange,
    event.reason,
    event.confidence,
  ];
}

export function buildLiveCsv(events: LiveEvent[]): string {
  const rows = [LIVE_EVENT_CSV_HEADER.join(",")];
  for (const event of events) {
    rows.push(liveEventRow(event).map(csvCell).join(","));
  }
  return `${rows.join("\r\n")}\r\n`;
}

export function buildLiveJson(events: LiveEvent[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: events.length,
      events,
    },
    null,
    2,
  );
}

export const LIVE_STATUS_LABEL: Record<LiveExecutionStatus, string> = {
  applied: "Applied",
  needs_clarification: "Needs clarification",
  unsupported: "Unsupported",
  out_of_range: "Out of range \u00B7 not applied",
  no_change: "No change",
  not_applied: "Not applied",
};

export function buildLiveText(events: LiveEvent[], title = "VoiceSurg 3D - Live Simulation change log"): string {
  const lines: string[] = [title];
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push(`Events: ${events.length}`);
  lines.push("");
  if (events.length === 0) {
    lines.push("No live changes were recorded.");
    return lines.join("\n");
  }
  events.forEach((event, i) => {
    const change =
      event.before !== null && event.after !== null
        ? `${event.before} -> ${event.after}`
        : "n/a";
    lines.push(
      `${i + 1}. [${new Date(event.at).toLocaleString()}] [${event.source}] ${event.utterance}`,
    );
    lines.push(
      `   ${event.target ?? "-"} / ${event.parameter ?? "-"} (${event.paramKey ?? "-"}): requested ${event.requestedValue ?? "-"} ${event.requestedUnit ?? ""}, normalized ${event.normalizedValue ?? "-"} ${event.normalizedUnit ?? ""}`,
    );
    lines.push(`   status: ${LIVE_STATUS_LABEL[event.status]}; before/after: ${change}`);
    if (event.reason) lines.push(`   reason: ${event.reason}`);
  });
  lines.push("");
  lines.push("This is a simulation change log, not a clinical record.");
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Minimal PDF writer                                                          */
/* -------------------------------------------------------------------------- */

/** Transliterate to printable ASCII so byte offsets match string offsets. */
function pdfEscape(text: string): string {
  const replacements: Record<string, string> = {
    "\u2014": "-",
    "\u2013": "-",
    "\u2018": "'",
    "\u2019": "'",
    "\u201C": '"',
    "\u201D": '"',
    "\u00B0": " deg",
    "\u00B7": "*",
    "\u2026": "...",
    "\u00A0": " ",
  };
  let out = "";
  for (const ch of text) {
    if (replacements[ch] !== undefined) {
      out += replacements[ch];
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) {
      out += "?";
      continue;
    }
    if (ch === "\\" || ch === "(" || ch === ")") out += "\\";
    out += ch;
  }
  return out;
}

const PDF_LINES_PER_PAGE = 58;
const PDF_MAX_LINE_CHARS = 105;

/** Word-wrap a long report line so it fits the A4 text frame. */
function wrapPdfLine(line: string): string[] {
  if (line.length <= PDF_MAX_LINE_CHARS) return [line];
  const out: string[] = [];
  let rest = line;
  while (rest.length > PDF_MAX_LINE_CHARS) {
    const slice = rest.slice(0, PDF_MAX_LINE_CHARS + 1);
    const splitAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("|"));
    const at = splitAt > 20 ? splitAt : PDF_MAX_LINE_CHARS;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  out.push(rest);
  return out;
}

/**
 * Render a text report as a real PDF 1.4 file (single font, Helvetica, one or
 * more A4 pages) with a correctly computed xref table. No external dependency.
 *
 * Returned as a string of printable ASCII; its UTF-8 bytes are identical to the
 * required PDF bytes, so it can be passed straight to `Blob`.
 */
export function buildTextPdf(lines: string[], title: string): string {
  const wrapped = lines.flatMap((line) => wrapPdfLine(line));
  const all = [title, "", ...wrapped];
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(all.length, 1); i += PDF_LINES_PER_PAGE) {
    pages.push(all.slice(i, i + PDF_LINES_PER_PAGE));
  }

  const fontId = 3;
  const pageIds = pages.map((_, i) => 4 + i * 2);
  const streamIds = pages.map((_, i) => 5 + i * 2);

  const objects = new Map<number, string>();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.set(
    fontId,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );

  pages.forEach((pageLines, i) => {
    objects.set(
      pageIds[i],
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamIds[i]} 0 R >>`,
    );
    const content = [
      "BT",
      "/F1 9 Tf",
      "40 806 Td",
      "12 TL",
      ...pageLines.map((line) => `(${pdfEscape(line)}) Tj T*`),
      "ET",
      "",
    ].join("\n");
    objects.set(streamIds[i], `<< /Length ${content.length} >>\nstream\n${content}endstream`);
  });

  const maxId = 3 + pages.length * 2;
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id <= maxId; id++) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }

  const xrefStart = body.length;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return body;
}

/** Live change-log PDF helper retained for the existing export UI. */
export function buildLivePdf(
  lines: string[],
  title = "VoiceSurg 3D - Live Simulation change log",
): string {
  return buildTextPdf(lines, title);
}
