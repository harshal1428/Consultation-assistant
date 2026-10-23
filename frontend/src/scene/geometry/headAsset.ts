/**
 * Realistic head asset (user-supplied 3D model).
 *
 * The default simulation head is the anatomical head mesh supplied by the
 * project owner (`free_head.obj`, converted by
 * `scripts/build-head-asset.mjs`). Embedding the converted buffers keeps
 * `createHeadGeometry` synchronous, which the state-driven viewer and the
 * reconstruction builder depend on.
 *
 * Provenance / licence: the source model was supplied directly by the project
 * owner. Its licence is not independently verified here; see
 * docs/MULTIVIEW_FACE_RECONSTRUCTION_REPORT.md before redistributing it.
 */

import {
  HEAD_ASSET_ANCHORS,
  HEAD_ASSET_BOUNDS,
  HEAD_ASSET_EYE,
  HEAD_ASSET_INDICES_BASE64,
  HEAD_ASSET_POSITIONS_BASE64,
  HEAD_ASSET_TRIANGLE_COUNT,
  HEAD_ASSET_UVS_BASE64,
  HEAD_ASSET_VERTEX_COUNT,
} from "./headAssetData.generated";
import type { FaceRegionFrame, RegionVec3 } from "./regions";

export {
  HEAD_ASSET_ANCHORS,
  HEAD_ASSET_BOUNDS,
  HEAD_ASSET_EYE,
  HEAD_ASSET_TRIANGLE_COUNT,
  HEAD_ASSET_VERTEX_COUNT,
};

/** Decode a base64 payload in the browser, jsdom, and Node. */
function decodeBase64(payload: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const buffer = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (buffer) return new Uint8Array(buffer.from(payload, "base64"));
  throw new Error("No base64 decoder is available in this environment.");
}

function decodeFloat32(payload: string): Float32Array {
  const bytes = decodeBase64(payload);
  const copy = bytes.slice();
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

function decodeUint16(payload: string): Uint16Array {
  const bytes = decodeBase64(payload);
  const copy = bytes.slice();
  return new Uint16Array(copy.buffer, copy.byteOffset, copy.byteLength / 2);
}

export interface HeadAssetBuffers {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
  triangleCount: number;
}

let cached: HeadAssetBuffers | null = null;

/** Decoded, immutable render buffers for the realistic head. */
export function getHeadAssetBuffers(): HeadAssetBuffers {
  if (!cached) {
    const positions = decodeFloat32(HEAD_ASSET_POSITIONS_BASE64);
    const uvs = decodeFloat32(HEAD_ASSET_UVS_BASE64);
    const indices = decodeUint16(HEAD_ASSET_INDICES_BASE64);
    cached = {
      positions,
      uvs,
      indices,
      vertexCount: HEAD_ASSET_VERTEX_COUNT,
      triangleCount: HEAD_ASSET_TRIANGLE_COUNT,
    };
  }
  return cached;
}

/**
 * Area-weighted, seam-welded vertex normals.
 *
 * The render mesh duplicates vertices at UV seams, so three.js's
 * `computeVertexNormals` would create a visible lighting crease along every
 * seam. Positions are welded before accumulating the face normals, which keeps
 * the shading smooth while the UVs stay split.
 */
export function computeSmoothNormals(
  positions: Float32Array,
  indices: ArrayLike<number>,
): Float32Array {
  const count = Math.floor(positions.length / 3);
  const weldedIndex = new Uint32Array(count);
  const weldedPositions: number[] = [];
  const remap = new Map<string, number>();

  for (let v = 0; v < count; v += 1) {
    const o = v * 3;
    const key = `${Math.round(positions[o] * 1e5)},${Math.round(
      positions[o + 1] * 1e5,
    )},${Math.round(positions[o + 2] * 1e5)}`;
    let index = remap.get(key);
    if (index === undefined) {
      index = weldedPositions.length / 3;
      remap.set(key, index);
      weldedPositions.push(positions[o], positions[o + 1], positions[o + 2]);
    }
    weldedIndex[v] = index;
  }

  const accum = new Float32Array(weldedPositions.length);
  const triangleCount = Math.floor(indices.length / 3);
  for (let t = 0; t < triangleCount; t += 1) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    const ao = a * 3;
    const bo = b * 3;
    const co = c * 3;
    const abx = positions[bo] - positions[ao];
    const aby = positions[bo + 1] - positions[ao + 1];
    const abz = positions[bo + 2] - positions[ao + 2];
    const acx = positions[co] - positions[ao];
    const acy = positions[co + 1] - positions[ao + 1];
    const acz = positions[co + 2] - positions[ao + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const wa = weldedIndex[a] * 3;
    const wb = weldedIndex[b] * 3;
    const wc = weldedIndex[c] * 3;
    accum[wa] += nx;
    accum[wa + 1] += ny;
    accum[wa + 2] += nz;
    accum[wb] += nx;
    accum[wb + 1] += ny;
    accum[wb + 2] += nz;
    accum[wc] += nx;
    accum[wc + 1] += ny;
    accum[wc + 2] += nz;
  }

  const normals = new Float32Array(count * 3);
  for (let v = 0; v < count; v += 1) {
    const w = weldedIndex[v] * 3;
    const len = Math.hypot(accum[w], accum[w + 1], accum[w + 2]) || 1;
    normals[v * 3] = accum[w] / len;
    normals[v * 3 + 1] = accum[w + 1] / len;
    normals[v * 3 + 2] = accum[w + 2] / len;
  }
  return normals;
}

/** Estimated height of the hairline on the bald asset (scene units). */
export const HEAD_ASSET_HAIRLINE_Y = 0.4;

const anchor = (id: keyof typeof HEAD_ASSET_ANCHORS): RegionVec3 => [
  HEAD_ASSET_ANCHORS[id][0],
  HEAD_ASSET_ANCHORS[id][1],
  HEAD_ASSET_ANCHORS[id][2],
];

/**
 * Region frame for the realistic head.
 *
 * The centres are the measured anatomical landmarks of this mesh (see the
 * conversion script); the sigmas keep the same physical influence radius as
 * the sculpted head where the anatomy is comparable, and are tightened over
 * the shorter real nose so the tip / bridge / alar controls stay distinct.
 */
export const HEAD_REGION_FRAME: FaceRegionFrame = {
  // The realistic face has more depth variation (cheeks and jaw sweep back);
  // a lower mask pivot lets the lateral jaw controls reach the mandible.
  frontZ: 0.7,
  bridge: { x: 0, sx: 0.1, y: 0.075, sy: 0.09 },
  bridgeWidth: { x: 0.07, sx: 0.05, y: 0.1, sy: 0.08 },
  tip: { x: 0, sx: 0.09, y: -0.0525, sy: 0.07 },
  alar: { x: 0.17, sx: 0.06, y: -0.125, sy: 0.04 },
  upperLip: { x: 0, sx: 0.13, y: -0.2265, sy: 0.032 },
  lowerLip: { x: 0, sx: 0.14, y: -0.2985, sy: 0.036 },
  chinProjection: { x: 0, sx: 0.13, y: -0.4485, sy: 0.07 },
  chinHeight: { x: 0, sx: 0.15, y: -0.44, sy: 0.08 },
  chinWidth: { x: 0.13, sx: 0.07, y: -0.4485, sy: 0.07 },
  jawWidth: { x: 0.37, sx: 0.16, y: -0.2, sy: 0.16 },
  jawDefinition: { x: 0.44, sx: 0.12, y: -0.18, sy: 0.12 },
  cheekProjection: { x: 0.33, sx: 0.14, y: 0, sy: 0.12 },
  cheekFullness: { x: 0.36, sx: 0.13, y: -0.03, sy: 0.12 },
  tipPivot: { y: -0.1305, z: 0.9885 },
  upperLipCenter: { y: -0.2265, z: 1.0107 },
  lowerLipCenter: { y: -0.2985, z: 0.9969 },
  chinHeightPivot: -0.36,
  landmarkPositions: {
    nasion: anchor("nasion"),
    rhinion: anchor("rhinion"),
    pronasale: anchor("pronasale"),
    subnasale: anchor("subnasale"),
    upper_lip: anchor("upper_lip"),
    lower_lip: anchor("lower_lip"),
    pogonion: anchor("pogonion"),
    menton: anchor("menton"),
    alare_l: anchor("alar_l"),
    alare_r: anchor("alar_r"),
    // The cheek and jaw targets only seed a nearest-vertex lookup, so an
    // approximate anterior depth is sufficient to select the right surface.
    cheek_l: [0.35, 0, 0.82],
    cheek_r: [-0.35, 0, 0.82],
    jaw_l: [0.38, -0.22, 0.5],
    jaw_r: [-0.38, -0.22, 0.5],
  },
};
