import type { ModelState, Command } from "./types";

export function applyCommand(state: ModelState, command: Command): ModelState {
  const newState = { ...state };
  
  if (command.value === null) {
    return newState;
  }

  // Reasonable visual scaling
  const scale = 0.5; // multiplier for visual effect
  let val = command.value * scale;

  if (command.target === "nasal_bridge" || command.target === "nasal_dorsum") {
    if (command.operation === "increase" || command.operation === "raise") {
      if (command.parameter === "height") newState.bridgeHeight += val;
      if (command.parameter === "width") newState.bridgeWidth += val;
    } else if (command.operation === "decrease" || command.operation === "lower") {
      if (command.parameter === "height") newState.bridgeHeight -= val;
      if (command.parameter === "width") newState.bridgeWidth -= val;
    }
  } else if (command.target === "nasal_tip") {
    if (command.operation === "increase" || command.operation === "raise") {
      if (command.parameter === "height") newState.tipHeight += val;
      if (command.parameter === "projection") newState.tipProjection += val;
    } else if (command.operation === "decrease" || command.operation === "lower") {
      if (command.parameter === "height") newState.tipHeight -= val;
      if (command.parameter === "projection") newState.tipProjection -= val;
    } else if (command.operation === "rotate") {
      if (command.direction === "down") {
        newState.tipRotation -= val;
      } else {
        newState.tipRotation += val;
      }
    }
  }
  
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
  return {
    bridgeHeight: 0,
    bridgeWidth: 0,
    tipHeight: 0,
    tipProjection: 0,
    tipRotation: 0,
  };
}
