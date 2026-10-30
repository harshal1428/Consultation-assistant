import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateLiveInstruction } from "../src/scene/live/logic";
import { applyCommand } from "../src/scene/transformations/logic";
import { initialModelState } from "../src/scene/transformations/types";
import type { Instruction, ModelState } from "../src/scene/transformations/types";

interface ParseFixtureRow {
  key: string;
  text: string;
  label: string;
  category: string;
  split: string | null;
  instructions: Instruction[];
}

interface ParseFixture {
  rows: ParseFixtureRow[];
}

const backendGold = resolve(process.cwd(), "../backend/tests/gold");
const parsePath = `${backendGold}/parse_results.json`;
const outPath = `${backendGold}/live_decisions.json`;

describe("gold live-decision fixture", () => {
  it("runs the real evaluateLiveInstruction and records every decision", () => {
    const fixture = JSON.parse(readFileSync(parsePath, "utf8")) as ParseFixture;
    expect(fixture.rows.length).toBeGreaterThan(0);

    const rows: Record<string, unknown> = {};
    for (const row of fixture.rows) {
      // Start each gold row from the same initial state, then apply accepted
      // instructions in order. This mirrors one live utterance with multiple
      // clauses; an instruction rejected at the start stays rejected.
      let state: ModelState = { ...initialModelState };
      const decisions = row.instructions.map((instruction, index) => {
        const evaluation = evaluateLiveInstruction(instruction, state, {
          id: `gold-${row.key}-${index}`,
          at: 1_700_000_000_000 + index,
        });
        if (evaluation.status === "applied" && evaluation.command) {
          state = applyCommand(state, evaluation.command);
        }
        return {
          index,
          status: evaluation.status,
          reason: evaluation.reason,
          paramKey: evaluation.paramKey,
          before: evaluation.before,
          after: evaluation.after,
          instruction,
        };
      });
      rows[row.key] = {
        key: row.key,
        text: row.text,
        label: row.label,
        category: row.category,
        split: row.split,
        instructions: decisions,
        would_apply_in_live: decisions.some((item) => item.status === "applied"),
      };
    }

    writeFileSync(
      outPath,
      `${JSON.stringify(
        {
          generated_by: "frontend/tests/goldLiveDecisions.test.ts",
          note:
            "Real evaluateLiveInstruction decisions over parse_results.json. Regenerate after parser changes.",
          rows,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const row of fixture.rows) {
      expect(rows[row.key]).toBeTruthy();
    }
  });
});
