import type { Command, ModelState, ParamKey } from "./types";
import { initialModelState } from "./types";
import {
  descriptorFor,
  paramKeyFor,
  paramKeyForInstruction,
} from "../../lib/params";

/**
 * ---------------------------------------------------------------------------
 * Command semantics contract (Phase 3)
 * ---------------------------------------------------------------------------
 * - A spoken/parsed command carries a non-negative magnitude in `value` plus an
 *   `operation` that determines the sign.
 * - The magnitude is applied directly as a delta on the mapped model field.
 *   There is NO hidden visual scaling: the displayed proposed value, the
 *   confirmed command, the history entry and the state update all agree.
 * - Manual slider edits are absolute values for a single parameter.
 * - Only instructions with status `ok` are ever applied. Anything else
 *   (needs_clarification / unsupported / invalid / no_change) is a no-op here,
 *   so a partially understood utterance can never change the model.
 */

/** Signed delta magnitude for a voice operation, in the parameter's unit. */
export function signedMagnitude(command: Command): number {
  const magnitude = command.value ?? 0;
  switch (command.operation) {
    case "increase":
    case "raise":
    case "widen":
      return magnitude;
    case "decrease":
    case "lower":
    case "narrow":
      return -magnitude;
    case "rotate":
      return command.direction === "down" ? -magnitude : magnitude;
    default:
      return 0;
  }
}

export function applyCommand(state: ModelState, command: Command): ModelState {
  const newState = { ...state };

  if (command.value === null) {
    return newState;
  }

  if (command.source === "manual") {
    const key = paramKeyFor(command.target, command.parameter);
    if (key) newState[key] = command.value;
    return newState;
  }

  if (command.status !== "ok") {
    return newState;
  }

  const field = paramKeyForInstruction(command);
  if (!field) {
    return newState;
  }

  newState[field] += signedMagnitude(command);
  return newState;
}

export function applyAllCommands(commands: Command[]): ModelState {
  let state = resetModel();
  for (const cmd of commands) {
    state = applyCommand(state, cmd);
  }
  return state;
}

export function resetModel(): ModelState {
  return { ...initialModelState };
}

let manualSeq = 0;

/** Build an absolute-value manual adjustment command for a single parameter. */
export function createManualCommand(key: ParamKey, value: number): Command {
  const d = descriptorFor(key);
  manualSeq += 1;
  return {
    id: `manual-${key}-${Date.now()}-${manualSeq}`,
    source: "manual",
    target: d.target,
    parameter: d.parameter,
    clinical_parameter: d.clinicalKey,
    operation: value >= 0 ? "increase" : "decrease",
    value,
    requested_value: value,
    requested_unit: d.unit,
    unit: d.unit,
    direction: null,
    adjusted_value: null,
    confidence: 1,
    requires_confirmation: false,
    status: "ok",
    reason: null,
    original_text: `Manual adjustment · ${d.label}`,
    parser: "rules",
    createdAt: Date.now(),
  };
}

export function isManualFor(cmd: Command, key: ParamKey): boolean {
  return cmd.source === "manual" && paramKeyFor(cmd.target, cmd.parameter) === key;
}
