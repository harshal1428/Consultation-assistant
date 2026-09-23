export interface ModelState {
  bridgeHeight: number;
  bridgeWidth: number;
  tipHeight: number;
  tipProjection: number;
  tipRotation: number;
}

export const initialModelState: ModelState = {
  bridgeHeight: 0,
  bridgeWidth: 0,
  tipHeight: 0,
  tipProjection: 0,
  tipRotation: 0,
};

export type TargetRegion = "nasal_bridge" | "nasal_dorsum" | "nasal_tip" | "nostril_region" | "overall";
export type Operation = "increase" | "decrease" | "rotate" | "narrow" | "widen" | "raise" | "lower";

export interface ParsedCommand {
  target: TargetRegion;
  parameter: string; // "height", "width", "projection", "rotation"
  operation: Operation;
  value: number | null;
  unit: string | null;
  direction: string | null;
  confidence: number;
  requires_confirmation: boolean;
  original_text: string;
}

export interface Command extends ParsedCommand {}
