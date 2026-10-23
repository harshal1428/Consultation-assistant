#!/usr/bin/env node
/**
 * Build the embedded head asset from the user-supplied `free_head.obj`.
 *
 * The runtime must be able to construct the realistic head synchronously (the
 * geometry is passed through React state and the reconstruction builder), so
 * the OBJ is converted once, at development time, into base64 typed arrays.
 *
 * Usage:
 *   node scripts/build-head-asset.mjs <path-to-free_head.obj>
 *
 * The source model is not redistributed through this script; it is supplied by
 * the project owner. See docs/MULTIVIEW_FACE_RECONSTRUCTION_REPORT.md for the
 * provenance note.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Usage: node scripts/build-head-asset.mjs <path-to-free_head.obj>");
  process.exit(1);
}

// Scene placement. The head is normalised into the same scene frame the
// sculpted head used: eye line y = 0.19, nose tip z = 1.097, x = 0. The uniform
// scale keeps real proportions; the face height then reads at the same size as
// the previous head.
const SCENE_SCALE = 6;
const EYE_SOURCE = [0.03313381601731603, 1.669414225108224, 0.1179562510822511];
const TIP_SOURCE = [0, 1.629, 0.163777];
const OFFSET = [
  0,
  0.19 - EYE_SOURCE[1] * SCENE_SCALE,
  1.097 - TIP_SOURCE[2] * SCENE_SCALE,
];

const ANCHOR_SOURCE = {
  nasion: [0, 1.671, 0.1433],
  rhinion: [0, 1.653, 0.1521],
  pronasale: [0, 1.629, 0.1638],
  subnasale: [0, 1.616, 0.1457],
  upper_lip: [0, 1.6, 0.1494],
  lower_lip: [0, 1.588, 0.1471],
  pogonion: [0, 1.563, 0.1424],
  menton: [0, 1.551, 0.1331],
  alar_l: [0.03, 1.616, 0.1457],
  alar_r: [-0.03, 1.616, 0.1457],
  eye_outer_l: [0.047607, 1.668346, 0.120041],
  eye_outer_r: [-0.047607, 1.668346, 0.120041],
};

const text = readFileSync(sourcePath, "utf8");
const lines = text.split(/\r?\n/);
let object = null;
const sourcePositions = [];
const sourceUvs = [];
const sourceNormals = [];
const faces = [];

for (const line of lines) {
  if (line.startsWith("o ")) {
    object = line.slice(2).trim();
  } else if (line.startsWith("v ")) {
    sourcePositions.push(line.slice(2).trim().split(/\s+/).slice(0, 3).map(Number));
  } else if (line.startsWith("vt ")) {
    sourceUvs.push(line.slice(3).trim().split(/\s+/).slice(0, 2).map(Number));
  } else if (line.startsWith("vn ")) {
    sourceNormals.push(line.slice(3).trim().split(/\s+/).slice(0, 3).map(Number));
  } else if (line.startsWith("f ")) {
    const corner = line
      .slice(2)
      .trim()
      .split(/\s+/)
      .map((token) => {
        const [v, vt, vn] = token.split("/").map((value) => Number.parseInt(value, 10));
        return { v: v - 1, vt: vt - 1, vn: vn - 1 };
      });
    faces.push({ object, corner });
  }
}

const headFaces = faces.filter((face) => face.object?.includes("man_body"));
if (headFaces.length === 0) {
  console.error("The OBJ does not contain the expected head object.");
  process.exit(1);
}

// Split at UV seams. WebGL needs one UV per vertex, so every distinct
// (position, uv) corner becomes a render vertex.
const vertexKeys = new Map();
const positions = [];
const uvs = [];
const indices = [];

const scenePosition = (source) => [
  source[0] * SCENE_SCALE + OFFSET[0],
  source[1] * SCENE_SCALE + OFFSET[1],
  source[2] * SCENE_SCALE + OFFSET[2],
];

for (const face of headFaces) {
  const corridor = face.corner.map((corner) => {
    const key = `${corner.v}/${corner.vt}/${corner.vn}`;
    let index = vertexKeys.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      vertexKeys.set(key, index);
      const p = scenePosition(sourcePositions[corner.v]);
      positions.push(p[0], p[1], p[2]);
      uvs.push(sourceUvs[corner.vt][0], sourceUvs[corner.vt][1]);
    }
    return index;
  });
  for (let i = 1; i + 1 < corridor.length; i += 1) {
    indices.push(corridor[0], corridor[i], corridor[i + 1]);
  }
}

// Normalise the atlas into a square texture. The source UVs occupy only the
// lower-left part of their texture; rescaling increases the texel density and
// lets the texture bake use a square canvas without changing the mesh mapping.
let uMin = Infinity;
let uMax = -Infinity;
let vMin = Infinity;
let vMax = -Infinity;
for (let i = 0; i < uvs.length; i += 2) {
  uMin = Math.min(uMin, uvs[i]);
  uMax = Math.max(uMax, uvs[i]);
  vMin = Math.min(vMin, uvs[i + 1]);
  vMax = Math.max(vMax, uvs[i + 1]);
}
const UV_MARGIN = 0.01;
for (let i = 0; i < uvs.length; i += 2) {
  uvs[i] = UV_MARGIN + ((uvs[i] - uMin) / (uMax - uMin)) * (1 - 2 * UV_MARGIN);
  uvs[i + 1] = UV_MARGIN + ((uvs[i + 1] - vMin) / (vMax - vMin)) * (1 - 2 * UV_MARGIN);
}

if (positions.length / 3 > 65535) {
  console.error("The head has more than 65535 vertices; switch to 32-bit indices.");
  process.exit(1);
}

const toBase64 = (typed) =>
  Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64");

const positionArray = new Float32Array(positions);
const uvArray = new Float32Array(uvs);
const indexArray = new Uint16Array(indices);

const anchorScene = Object.fromEntries(
  Object.entries(ANCHOR_SOURCE).map(([id, p]) => [id, scenePosition(p)]),
);
const eyeScene = scenePosition(EYE_SOURCE);
const eyeRadius = 0.082;

const bounds = {
  x: [Math.min(...positionArray.filter((_, i) => i % 3 === 0)), Math.max(...positionArray.filter((_, i) => i % 3 === 0))],
  y: [Math.min(...positionArray.filter((_, i) => i % 3 === 1)), Math.max(...positionArray.filter((_, i) => i % 3 === 1))],
  z: [Math.min(...positionArray.filter((_, i) => i % 3 === 2)), Math.max(...positionArray.filter((_, i) => i % 3 === 2))],
};

const header = `/**
 * Generated by scripts/build-head-asset.mjs. Do not edit by hand.
 *
 * Source: user-supplied ${sourcePath.split(/[\\/]/).pop()} (free_head.obj), head object only.
 * Licence: the asset was supplied by the project owner; provenance is not
 * independently verified. See docs/MULTIVIEW_FACE_RECONSTRUCTION_REPORT.md.
 *
 * Scene placement: uniform scale ${SCENE_SCALE}, eye line y = 0.19,
 * nose tip z = 1.097, x = 0. Separate eyeballs are generated at runtime.
 *
 * ${positionArray.length / 3} vertices, ${indexArray.length / 3} triangles.
 */
`;

const generated = `${header}
export const HEAD_ASSET_VERTEX_COUNT = ${positionArray.length / 3};
export const HEAD_ASSET_TRIANGLE_COUNT = ${indexArray.length / 3};
export const HEAD_ASSET_BOUNDS = ${JSON.stringify(bounds)} as const;
export const HEAD_ASSET_EYE = ${JSON.stringify({ x: eyeScene[0], y: eyeScene[1], z: eyeScene[2], radius: eyeRadius })} as const;
export const HEAD_ASSET_ANCHORS = ${JSON.stringify(anchorScene)} as const;

export const HEAD_ASSET_POSITIONS_BASE64 =
  "${toBase64(positionArray)}";
export const HEAD_ASSET_UVS_BASE64 =
  "${toBase64(uvArray)}";
export const HEAD_ASSET_INDICES_BASE64 =
  "${toBase64(indexArray)}";
`;

const target = resolve(here, "../src/scene/geometry/headAssetData.generated.ts");
writeFileSync(target, generated, "utf8");
console.log(`Wrote ${target}`);
console.log({
  vertices: positionArray.length / 3,
  triangles: indexArray.length / 3,
  bounds,
  eye: eyeScene,
  anchors: anchorScene,
  uvBounds: [0, 1],
});
