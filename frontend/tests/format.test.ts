import { describe, expect, it } from "vitest";
import {
  describeCommand,
  describeRequested,
  isApplicable,
  statusMeta,
} from "../src/lib/format";
import type { Command } from "../src/scene/transformations/types";

function makeCommand(overrides: Partial<Command>): Command {
  return {
    id: "c",
    source: "voice",
    target: "nasal_bridge",
    parameter: "height",
    operation: "increase",
    value: 2,
    requested_value: 2,
    requested_unit: "mm",
    unit: "mm",
    direction: null,
    adjusted_value: null,
    confidence: 0.9,
    requires_confirmation: true,
    status: "ok",
    reason: null,
    original_text: "test",
    parser: "rules",
    createdAt: 0,
    ...overrides,
  };
}

describe("format helpers", () => {
  it("signs the described change by operation", () => {
    expect(describeCommand(makeCommand({}))).toBe("+2 mm");
    expect(describeCommand(makeCommand({ operation: "decrease" }))).toBe("−2 mm");
    expect(describeCommand(makeCommand({ operation: "narrow" }))).toBe("−2 mm");
    expect(
      describeCommand(
        makeCommand({ target: "nasal_tip", parameter: "rotation", operation: "rotate", unit: "degrees", value: 5, direction: "up" }),
      ),
    ).toBe("+5°");
  });

  it("maps statuses to tones", () => {
    expect(statusMeta("ok").tone).toBe("ok");
    expect(statusMeta("needs_clarification").tone).toBe("warning");
    expect(statusMeta("unsupported").tone).toBe("error");
    expect(statusMeta("invalid").tone).toBe("error");
    expect(statusMeta("no_change").tone).toBe("neutral");
  });

  it("only treats ok instructions with a value as applicable", () => {
    expect(isApplicable(makeCommand({}))).toBe(true);
    expect(isApplicable(makeCommand({ status: "invalid" }))).toBe(false);
    expect(isApplicable(makeCommand({ value: null }))).toBe(false);
  });

  it("shows the requested value only when it differs from the applied one", () => {
    expect(describeRequested(makeCommand({}))).toBeNull();
    expect(
      describeRequested(
        makeCommand({
          value: 2,
          unit: "mm",
          requested_value: 0.2,
          requested_unit: "cm",
        }),
      ),
    ).toBe("0.2 cm");
  });
});
