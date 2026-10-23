import type { Command, InstructionStatus } from "../scene/transformations/types";

/** Turn a canonical target string into a human label. */
export function formatTarget(target: string | null | undefined): string {
  if (!target) return "Unrecognised region";
  return target
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  if (unit === "degrees" || unit === "deg") return "°";
  if (unit === "mm" || unit === "millimeter" || unit === "millimeters")
    return "mm";
  if (unit === "cm") return "cm";
  return unit;
}

export function formatParameter(parameter: string | null | undefined): string {
  if (!parameter) return "Unknown";
  return parameter.replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface ConfidenceLevel {
  label: "Low" | "Medium" | "High";
  tone: "low" | "medium" | "high";
}

/**
 * Coarse qualitative mapping of the backend's confidence score. This
 * deliberately avoids presenting a precise probability that the parser does
 * not actually provide.
 */
export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.85) return { label: "High", tone: "high" };
  if (confidence >= 0.6) return { label: "Medium", tone: "medium" };
  return { label: "Low", tone: "low" };
}

export interface StatusMeta {
  label: string;
  tone: "ok" | "warning" | "error" | "neutral" | "info";
}

const STATUS_META: Record<InstructionStatus, StatusMeta> = {
  ok: { label: "Ready to apply", tone: "ok" },
  needs_clarification: { label: "Needs clarification", tone: "warning" },
  unsupported: { label: "Not supported", tone: "error" },
  invalid: { label: "Invalid", tone: "error" },
  no_change: { label: "No change", tone: "neutral" },
};

export function statusMeta(status: InstructionStatus): StatusMeta {
  return STATUS_META[status] ?? { label: status, tone: "neutral" };
}

/** Whether an instruction may be applied to the model. */
export function isApplicable(cmd: Command): boolean {
  return cmd.status === "ok" && cmd.value !== null && cmd.target !== null;
}

/** Signed display string for a command magnitude, e.g. "−2 mm". */
export function describeCommand(cmd: Command): string {
  const unit = formatUnit(cmd.unit);
  const suffix = unit === "°" ? "°" : unit ? ` ${unit}` : "";

  if (cmd.source === "manual") {
    const value = cmd.value ?? 0;
    const sign = value > 0 ? "+" : "";
    return `Set to ${sign}${value}${suffix}`;
  }

  if (cmd.value === null) return "Missing measurement";

  const sign =
    cmd.operation === "decrease" || cmd.operation === "lower" || cmd.operation === "narrow"
      ? "−"
      : cmd.operation === "increase" || cmd.operation === "raise" || cmd.operation === "widen"
        ? "+"
        : cmd.operation === "rotate" && cmd.direction === "down"
          ? "−"
          : "+";
  return `${sign}${cmd.value}${suffix}`;
}

/**
 * When the requested value differs from the normalized value (unit conversion)
 * describe both, so the requested and the applied values are never conflated.
 */
export function describeRequested(cmd: Command): string | null {
  if (cmd.requested_value == null || cmd.requested_unit == null) return null;
  if (cmd.requested_value === cmd.value && cmd.requested_unit === cmd.unit)
    return null;
  return `${cmd.requested_value} ${formatUnit(cmd.requested_unit)}`;
}
