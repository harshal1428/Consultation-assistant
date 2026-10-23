import { describe, expect, it } from "vitest";
import {
  applyAllCommands,
  createManualCommand,
  signedMagnitude,
} from "../src/scene/transformations/logic";
import type { Command } from "../src/scene/transformations/types";

function voiceCommand(overrides: Partial<Command>): Command {
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

describe("command application semantics", () => {
  it("applies the requested magnitude directly (no hidden scaling)", () => {
    const state = applyAllCommands([voiceCommand({})]);
    expect(state.bridgeHeight).toBe(2);
  });

  it("derives sign from the operation", () => {
    expect(signedMagnitude(voiceCommand({ operation: "decrease", value: 3 }))).toBe(-3);
    expect(signedMagnitude(voiceCommand({ operation: "raise", value: 3 }))).toBe(3);
    expect(signedMagnitude(voiceCommand({ operation: "narrow", value: 1 }))).toBe(-1);
    expect(signedMagnitude(voiceCommand({ operation: "widen", value: 1 }))).toBe(1);
    expect(signedMagnitude(voiceCommand({ operation: "lower", value: 4 }))).toBe(-4);
  });

  it("maps narrow/widen onto the bridge width field", () => {
    const state = applyAllCommands([
      voiceCommand({ operation: "narrow", parameter: "width", value: 2 }),
    ]);
    expect(state.bridgeWidth).toBe(-2);
  });

  it("uses direction for rotation", () => {
    const up = applyAllCommands([
      voiceCommand({
        target: "nasal_tip",
        parameter: "rotation",
        operation: "rotate",
        direction: "up",
        unit: "degrees",
        value: 5,
      }),
    ]);
    const down = applyAllCommands([
      voiceCommand({
        target: "nasal_tip",
        parameter: "rotation",
        operation: "rotate",
        direction: "down",
        unit: "degrees",
        value: 5,
      }),
    ]);
    expect(up.tipRotation).toBe(5);
    expect(down.tipRotation).toBe(-5);
  });

  it("never applies an instruction that is not status ok", () => {
    const state = applyAllCommands([
      voiceCommand({ status: "needs_clarification" }),
      voiceCommand({ status: "unsupported", value: 5 }),
      voiceCommand({ status: "invalid" }),
    ]);
    expect(state.bridgeHeight).toBe(0);
  });

  it("applies manual slider values as absolute values", () => {
    const state = applyAllCommands([
      voiceCommand({ value: 4 }),
      createManualCommand("bridgeHeight", -5),
    ]);
    expect(state.bridgeHeight).toBe(-5);
  });
});

describe("alar width mapping", () => {
  it("routes nostril widening to alarWidth, never bridgeWidth", () => {
    const state = applyAllCommands([
      voiceCommand({
        target: "nostril_region",
        parameter: "width",
        operation: "widen",
        value: 2,
      }),
    ]);
    expect(state.alarWidth).toBe(2);
    expect(state.bridgeWidth).toBe(0);
  });

  it("does not move alarWidth when the bridge is widened", () => {
    const state = applyAllCommands([
      voiceCommand({ parameter: "width", operation: "widen", value: 2 }),
    ]);
    expect(state.bridgeWidth).toBe(2);
    expect(state.alarWidth).toBe(0);
  });

  it("applies a manual alar width as an absolute value", () => {
    const state = applyAllCommands([
      voiceCommand({
        target: "nostril_region",
        parameter: "width",
        operation: "widen",
        value: 5,
      }),
      createManualCommand("alarWidth", -3),
    ]);
    expect(state.alarWidth).toBe(-3);
  });
});

describe("history correctness", () => {
  it("preserves a manual alar edit when a voice command is later confirmed", () => {
    const state = applyAllCommands([
      createManualCommand("alarWidth", 4),
      voiceCommand({ target: "nasal_bridge", parameter: "height", value: 3 }),
    ]);
    expect(state.alarWidth).toBe(4);
    expect(state.bridgeHeight).toBe(3);
  });

  it("replays a mixed history deterministically", () => {
    const history = [
      voiceCommand({
        target: "nostril_region",
        parameter: "width",
        operation: "widen",
        value: 3,
      }),
      createManualCommand("tipHeight", 2),
      voiceCommand({
        target: "nasal_tip",
        parameter: "rotation",
        operation: "rotate",
        direction: "up",
        unit: "degrees",
        value: 8,
      }),
    ];
    const a = applyAllCommands(history);
    const b = applyAllCommands(history);
    expect(a).toEqual(b);
    expect(a.alarWidth).toBe(3);
    expect(a.tipHeight).toBe(2);
    expect(a.tipRotation).toBe(8);
  });
});
