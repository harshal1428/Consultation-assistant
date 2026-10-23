import * as THREE from "three";
import type { ModelState } from "../transformations/types";
import { degreesToRadians, mmToScene, safeNumber } from "./config";
import {
  alarWeight,
  bridgeWeight,
  bridgeWidthWeight,
  cheekFullnessWeight,
  cheekProjectionWeight,
  chinHeightWeight,
  chinProjectionWeight,
  chinWidthWeight,
  DEFAULT_REGION_FRAME,
  jawDefinitionWeight,
  jawWidthWeight,
  lowerLipWeight,
  tipWeight,
  upperLipWeight,
  type FaceRegionFrame,
} from "./regions";

/**
 * Parameter -> displacement engine (Phase 4; extended in Phase 7).
 *
 * Positions are always recomputed from the immutable baseline plus the *full*
 * current parameter state, so:
 *   - reset reproduces the baseline exactly,
 *   - applying the same state twice yields identical geometry,
 *   - there is no incremental drift across undo / history replay.
 *
 * Every region's logic is separate and composable: the nasal block, the lip
 * block, the chin block, the jawline block and the cheek block each read only
 * their own parameters and their own baseline weight. All length parameters pass
 * through the single `mmToScene` pathway; angles go through `degreesToRadians`.
 * No other scaling exists.
 */

export interface DeformationResult {
  /** Deformed vertex positions (x, y, z). */
  positions: Float32Array;
  /** Per-vertex displacement magnitude from baseline, in scene units. */
  displacement: Float32Array;
  /** Per-vertex heatmap colour (relative intensity, not physical units). */
  colors: Float32Array;
  /** Largest displacement in this state, in scene units. */
  maxDisplacement: number;
}

/** Tip rotation pivot: the subnasale, on the documented sagittal midline. */
export const TIP_ROTATION_PIVOT = DEFAULT_REGION_FRAME.tipPivot;

/** Upper-lip radial centre used by upper-lip fullness (a smooth "plump"). */
export const UPPER_LIP_CENTER = DEFAULT_REGION_FRAME.upperLipCenter;

/** Lower-lip radial centre used by lower-lip fullness. */
export const LOWER_LIP_CENTER = DEFAULT_REGION_FRAME.lowerLipCenter;

/**
 * Chin-height pivot. The chin's vertical dimension is scaled about this point
 * (roughly the top of the chin mass), so a positive value lengthens the chin
 * downward while leaving the upper boundary in place.
 */
export const CHIN_HEIGHT_PIVOT = DEFAULT_REGION_FRAME.chinHeightPivot;

const COLOR_NEUTRAL = new THREE.Color("#38bdf8");
const COLOR_MILD = new THREE.Color("#22c55e");
const COLOR_MAX = new THREE.Color("#f43f5e");

export function deformPositions(
  base: Float32Array,
  state: ModelState,
  frame: FaceRegionFrame = DEFAULT_REGION_FRAME,
): DeformationResult {
  const count = Math.floor(base.length / 3);
  const positions = new Float32Array(base.length);
  const displacement = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  // --- Nasal -----------------------------------------------------------------
  const dBridgeHeight = mmToScene(safeNumber(state.bridgeHeight));
  const dBridgeWidth = mmToScene(safeNumber(state.bridgeWidth));
  const dTipHeight = mmToScene(safeNumber(state.tipHeight));
  const dTipProjection = mmToScene(safeNumber(state.tipProjection));
  const dTipRotation = degreesToRadians(safeNumber(state.tipRotation));
  const dAlarWidth = mmToScene(safeNumber(state.alarWidth));

  // --- Lips ------------------------------------------------------------------
  const dUpperLipProjection = mmToScene(safeNumber(state.upperLipProjection));
  const dUpperLipFullness = mmToScene(safeNumber(state.upperLipFullness));
  const dLowerLipProjection = mmToScene(safeNumber(state.lowerLipProjection));
  const dLowerLipFullness = mmToScene(safeNumber(state.lowerLipFullness));

  // --- Chin ------------------------------------------------------------------
  const dChinProjection = mmToScene(safeNumber(state.chinProjection));
  const dChinHeight = mmToScene(safeNumber(state.chinHeight));
  const dChinWidth = mmToScene(safeNumber(state.chinWidth));

  // --- Jawline ---------------------------------------------------------------
  const dJawWidth = mmToScene(safeNumber(state.jawWidth));
  const dJawDefinition = mmToScene(safeNumber(state.jawDefinition));

  // --- Cheeks ----------------------------------------------------------------
  const dCheekProjection = mmToScene(safeNumber(state.cheekProjection));
  const dCheekFullness = mmToScene(safeNumber(state.cheekFullness));

  let maxDisplacement = 0;

  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const bx = base[o];
    const by = base[o + 1];
    const bz = base[o + 2];

    let nx = bx;
    let ny = by;
    let nz = bz;

    // Bridge / dorsum: anterior translation.
    nz += dBridgeHeight * bridgeWeight(bx, by, bz, frame);

    // Bridge width: lateral translation of the dorsum sides only.
    const wBridgeWidth = bridgeWidthWeight(bx, by, bz, frame);
    if (wBridgeWidth !== 0 && bx !== 0) {
      nx += Math.sign(bx) * dBridgeWidth * wBridgeWidth;
    }

    // Tip: projection + height + weighted rotation about the subnasale pivot.
    const wTip = tipWeight(bx, by, bz, frame);
    if (wTip !== 0) {
      nz += dTipProjection * wTip;
      ny += dTipHeight * wTip;

      if (dTipRotation !== 0) {
        const { y: pivotY, z: pivotZ } = frame.tipPivot;
        const relY = ny - pivotY;
        const relZ = nz - pivotZ;
        const angle = dTipRotation * wTip;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        // Positive rotation lifts the tip (cranial rotation) about the pivot.
        ny = pivotY + relY * cosA + relZ * sinA;
        nz = pivotZ - relY * sinA + relZ * cosA;
      }
    }

    // Alar wings: symmetric lateral spread. Midline is untouched (sign 0) and
    // the weight is localised, so the bridge and tip do not move.
    if (dAlarWidth !== 0 && bx !== 0) {
      const wAlar = alarWeight(bx, by, bz, frame);
      nx += Math.sign(bx) * dAlarWidth * wAlar;
    }

    // Upper lip: anterior projection plus a smooth radial "plump" (fullness)
    // about the upper-lip centre, so fullness raises/opens the lip rather than
    // only translating it forward like projection.
    const wUpperLip = upperLipWeight(bx, by, bz, frame);
    if (wUpperLip !== 0) {
      nz += dUpperLipProjection * wUpperLip;
      if (dUpperLipFullness !== 0) {
        const ry = by - frame.upperLipCenter.y;
        const rz = bz - frame.upperLipCenter.z;
        const len = Math.hypot(ry, rz) || 1;
        ny += dUpperLipFullness * wUpperLip * (ry / len);
        nz += dUpperLipFullness * wUpperLip * (rz / len);
      }
    }

    // Lower lip: same treatment, independent of the upper lip.
    const wLowerLip = lowerLipWeight(bx, by, bz, frame);
    if (wLowerLip !== 0) {
      nz += dLowerLipProjection * wLowerLip;
      if (dLowerLipFullness !== 0) {
        const ry = by - frame.lowerLipCenter.y;
        const rz = bz - frame.lowerLipCenter.z;
        const len = Math.hypot(ry, rz) || 1;
        ny += dLowerLipFullness * wLowerLip * (ry / len);
        nz += dLowerLipFullness * wLowerLip * (rz / len);
      }
    }

    // Chin: anterior projection.
    nz += dChinProjection * chinProjectionWeight(bx, by, bz, frame);

    // Chin height: vertical scaling about the chin-top pivot (smooth, no crease).
    const wChinHeight = chinHeightWeight(bx, by, bz, frame);
    if (dChinHeight !== 0 && wChinHeight !== 0) {
      ny += dChinHeight * wChinHeight * (by - frame.chinHeightPivot);
    }

    // Chin width: lateral spread localised near the midline.
    if (dChinWidth !== 0 && bx !== 0) {
      nx += Math.sign(bx) * dChinWidth * chinWidthWeight(bx, by, bz, frame);
    }

    // Jaw width: broad lower-lateral spread.
    if (dJawWidth !== 0 && bx !== 0) {
      nx += Math.sign(bx) * dJawWidth * jawWidthWeight(bx, by, bz, frame);
    }

    // Jaw definition: narrow mandibular contour sharpening (lateral + slight
    // anterior), distinct from the broad jaw-width mass.
    if (dJawDefinition !== 0) {
      const wJawDef = jawDefinitionWeight(bx, by, bz, frame);
      if (bx !== 0) {
        nx += Math.sign(bx) * dJawDefinition * wJawDef;
      }
      nz += dJawDefinition * wJawDef * 0.3;
    }

    // Cheeks: anterior projection, then outward fullness (lateral + slight
    // anterior). Both apply symmetrically to the left and right malar regions.
    nz += dCheekProjection * cheekProjectionWeight(bx, by, bz, frame);
    if (dCheekFullness !== 0) {
      const wCheekFull = cheekFullnessWeight(bx, by, bz, frame);
      if (bx !== 0) {
        nx += Math.sign(bx) * dCheekFullness * wCheekFull;
      }
      nz += dCheekFullness * wCheekFull * 0.35;
    }

    positions[o] = nx;
    positions[o + 1] = ny;
    positions[o + 2] = nz;

    const dx = nx - bx;
    const dy = ny - by;
    const dz = nz - bz;
    const magnitude = Math.sqrt(dx * dx + dy * dy + dz * dz);
    displacement[i] = magnitude;
    if (magnitude > maxDisplacement) maxDisplacement = magnitude;
  }

  const invMax = maxDisplacement > 1e-9 ? 1 / maxDisplacement : 0;
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const factor = displacement[i] * invMax;
    if (factor < 0.5) {
      tmp.copy(COLOR_NEUTRAL).lerp(COLOR_MILD, factor * 2);
    } else {
      tmp.copy(COLOR_MILD).lerp(COLOR_MAX, (factor - 0.5) * 2);
    }
    const o = i * 3;
    colors[o] = tmp.r;
    colors[o + 1] = tmp.g;
    colors[o + 2] = tmp.b;
  }

  return { positions, displacement, colors, maxDisplacement };
}
