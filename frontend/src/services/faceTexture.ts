/**
 * Photo-derived skin texture for the reconstructed head.
 *
 * The geometry pipeline transfers the reconstructed canonical face onto the
 * volumetric head and keeps, for every head vertex, the canonical point it
 * corresponds to (`PersonalizedHeadModel.correspondence`). This module uses
 * that same correspondence in the opposite direction: every texel of the head
 * is projected into the patient photographs through the fitted camera poses,
 * and the photographed colour is written back onto the surface.
 *
 * The result is an ordinary UV texture on the real, deformable simulation
 * mesh. It is derived from the reconstructed geometry (not from a flat
 * cut-out), so the face keeps its identity when the mesh is rotated, and it
 * deforms with the mesh when a surgical parameter is applied because the UVs
 * are fixed to the vertices.
 *
 * The core is a pure function over typed arrays so it can be tested without a
 * canvas. A thin browser helper turns the result into a canvas texture.
 */

import type { PhotoView } from "../lib/multiViewPhoto";
import type { SimilarityTransform } from "./multiViewFitting";

/** One photograph, reduced to the data the sampler needs. */
export interface TextureView {
  view: PhotoView;
  /** Working resolution of `data`. */
  width: number;
  height: number;
  /** RGBA pixels of the (downscaled) photograph. */
  data: Uint8ClampedArray;
  /** Fitted similarity: shape frame (pre-alignment) -> image pixels (y up). */
  transform: SimilarityTransform;
  /** Relative priority when several views see the same skin point. */
  priority: number;
  /** Camera direction in the aligned canonical frame (unit length). */
  direction: [number, number, number];
}

export interface FaceTextureInput {
  /** Texture resolution; defaults to 1024 x 1024. */
  width?: number;
  height?: number;
  /** Tessellation of the head mesh (SphereGeometry segments). Only used for the legacy layout. */
  segmentsX?: number;
  segmentsY?: number;
  /** Displaced head-mesh positions and normals (3 floats per vertex). */
  positions: Float32Array;
  normals: Float32Array;
  /** UV coordinates per vertex (0..1). When provided, the mesh UVs are used directly. */
  uvs?: Float32Array;
  /** Triangle indices for UV-space rasterisation. */
  indices?: ArrayLike<number>;
  /** Reconstructed canonical point per head vertex (aligned template frame). */
  correspondence: Float32Array;
  /** Per-vertex reconstruction coverage (0..1); low values are not textured. */
  coverage: Float32Array;
  /** Rotation of the canonical -> scene alignment (row-major 3x3). */
  canonicalToSceneRotation: Float32Array;
  /** Inverse of the fit alignment: aligned template frame -> fitted shape frame. */
  inverseAlignment: SimilarityTransform;
  views: TextureView[];
  /** Fallback colours for skin/hair where no photograph sees the surface. */
  skinColor?: [number, number, number];
  hairColor?: [number, number, number];
  /** Scene-space height above which uncovered texels are treated as hair. */
  hairlineY?: number;
  /** Minimum coverage a vertex needs before it is textured from a photo. */
  minCoverage?: number;
  /** Minimum per-view facing weight a sample needs to count. */
  minWeight?: number;
  /** Scene-space z below which uncovered texels are treated as hair (back of head). */
  backZ?: number;
}

export interface FaceTextureData {
  width: number;
  height: number;
  /** RGBA texture pixels. */
  data: Uint8ClampedArray;
  /** Fraction of texels that received a photographed colour (0..1). */
  coverage: number;
  texturedTexels: number;
  totalTexels: number;
  /** Per-view number of texels that used that view. */
  viewContributions: Partial<Record<PhotoView, number>>;
  /** The fallback colours that were used. */
  skinColor: [number, number, number];
  hairColor: [number, number, number];
}

/** Apply a similarity to a single point. */
export function applySimilarityPoint(
  transform: SimilarityTransform,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const { rotation, translation, scale } = transform;
  return [
    scale * (rotation[0] * x + rotation[1] * y + rotation[2] * z) + translation[0],
    scale * (rotation[3] * x + rotation[4] * y + rotation[5] * z) + translation[1],
    scale * (rotation[6] * x + rotation[7] * y + rotation[8] * z) + translation[2],
  ];
}

/**
 * Camera direction (towards the camera) expressed in the aligned canonical
 * frame.
 *
 * `viewRotation` maps the fitted shape frame into the observation camera
 * frame; `alignmentRotation` maps the fitted shape frame onto the aligned
 * template frame.
 */
export function cameraDirectionInAlignedFrame(
  alignmentRotation: Float32Array,
  viewRotation: Float32Array,
): [number, number, number] {
  // R_view^T * (0, 0, 1): the camera's +Z axis in the shape frame.
  const dx = viewRotation[6];
  const dy = viewRotation[7];
  const dz = viewRotation[8];
  // R_align * that vector.
  const x = alignmentRotation[0] * dx + alignmentRotation[1] * dy + alignmentRotation[2] * dz;
  const y = alignmentRotation[3] * dx + alignmentRotation[4] * dy + alignmentRotation[5] * dz;
  const z = alignmentRotation[6] * dx + alignmentRotation[7] * dy + alignmentRotation[8] * dz;
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/** Normal of a head vertex expressed in the aligned canonical frame. */
export function normalInAlignedFrame(
  canonicalToSceneRotation: Float32Array,
  nx: number,
  ny: number,
  nz: number,
): [number, number, number] {
  // R^T * n (the alignment is a rotation + uniform scale, so the direction is
  // simply the transposed rotation).
  return [
    canonicalToSceneRotation[0] * nx + canonicalToSceneRotation[3] * ny + canonicalToSceneRotation[6] * nz,
    canonicalToSceneRotation[1] * nx + canonicalToSceneRotation[4] * ny + canonicalToSceneRotation[7] * nz,
    canonicalToSceneRotation[2] * nx + canonicalToSceneRotation[5] * ny + canonicalToSceneRotation[8] * nz,
  ];
}

/** Head vertex index a texture texel belongs to (SphereGeometry layout). */
export function vertexIndexForTexel(
  tx: number,
  ty: number,
  width: number,
  height: number,
  segmentsX: number,
  segmentsY: number,
): number {
  const u = (tx + 0.5) / width;
  const iy = Math.min(
    segmentsY,
    Math.max(0, Math.round(((ty + 0.5) / height) * segmentsY)),
  );
  const ix = Math.min(segmentsX, Math.max(0, Math.round(u * segmentsX)));
  return iy * (segmentsX + 1) + ix;
}

function sampleBilinear(
  view: TextureView,
  u: number,
  v: number,
  out: [number, number, number],
): boolean {
  if (u < 0.01 || u > 0.99 || v < 0.01 || v > 0.99) return false;

  const x = u * (view.width - 1);
  const y = v * (view.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(view.width - 1, x0 + 1);
  const y1 = Math.min(view.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;

  const at = (px: number, py: number): number => (py * view.width + px) * 4;
  const i00 = at(x0, y0);
  const i10 = at(x1, y0);
  const i01 = at(x0, y1);
  const i11 = at(x1, y1);

  if (view.data[i00 + 3] < 8) return false;

  for (let k = 0; k < 3; k += 1) {
    const top = view.data[i00 + k] * (1 - fx) + view.data[i10 + k] * fx;
    const bottom = view.data[i01 + k] * (1 - fx) + view.data[i11 + k] * fx;
    out[k] = top * (1 - fy) + bottom * fy;
  }
  return true;
}

/**
 * Build the texture pixels. Pure and deterministic: the same photographs,
 * poses and geometry always produce the same buffer.
 */
export function buildFaceTextureData(input: FaceTextureInput): FaceTextureData {
  const width = Math.max(2, Math.round(input.width ?? 1024));
  const height = Math.max(2, Math.round(input.height ?? 512));
  const { segmentsX, segmentsY } = input;
  const vertexCount = Math.min(
    Math.floor(input.positions.length / 3),
    Math.floor(input.correspondence.length / 3),
    (segmentsX + 1) * (segmentsY + 1),
  );

  const total = width * height;
  const out = new Uint8ClampedArray(total * 4);
  const hasSample = new Uint8Array(total);
  const viewContributions: Partial<Record<PhotoView, number>> = {};

  const minCoverage = input.minCoverage ?? 0.05;
  const minWeight = input.minWeight ?? 0.08;

  // Pre-compute the normal in the aligned frame for every head vertex.
  const alignedNormals = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v += 1) {
    const [nx, ny, nz] = normalInAlignedFrame(
      input.canonicalToSceneRotation,
      input.normals[v * 3],
      input.normals[v * 3 + 1],
      input.normals[v * 3 + 2],
    );
    alignedNormals[v * 3] = nx;
    alignedNormals[v * 3 + 1] = ny;
    alignedNormals[v * 3 + 2] = nz;
  }

  let skinSumR = 0;
  let skinSumG = 0;
  let skinSumB = 0;
  let skinCount = 0;
  let hairSumR = 0;
  let hairSumG = 0;
  let hairSumB = 0;
  let hairCount = 0;

  const colour: [number, number, number] = [0, 0, 0];
  const hairlineY = input.hairlineY ?? 0.44;

  for (let ty = 0; ty < height; ty += 1) {
    for (let tx = 0; tx < width; tx += 1) {
      const texel = ty * width + tx;
      const vertex = vertexIndexForTexel(tx, ty, width, height, segmentsX, segmentsY);
      if (vertex >= vertexCount) continue;

      const coverage = input.coverage[vertex];
      if (coverage < minCoverage) continue;

      const nx = alignedNormals[vertex * 3];
      const ny = alignedNormals[vertex * 3 + 1];
      const nz = alignedNormals[vertex * 3 + 2];

      const cx = input.correspondence[vertex * 3];
      const cy = input.correspondence[vertex * 3 + 1];
      const cz = input.correspondence[vertex * 3 + 2];
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) continue;

      let weightSum = 0;
      let r = 0;
      let g = 0;
      let b = 0;

      for (const view of input.views) {
        const facing = nx * view.direction[0] + ny * view.direction[1] + nz * view.direction[2];
        if (facing <= 0) continue;
        const weight = view.priority * Math.pow(facing, 1.5);
        if (weight < minWeight) continue;

        // aligned template frame -> fitted shape frame -> image pixels.
        const [sx, sy, sz] = applySimilarityPoint(
          input.inverseAlignment,
          cx,
          cy,
          cz,
        );
        const [px, py] = (() => {
          const p = applySimilarityPoint(view.transform, sx, sy, sz);
          return [p[0], p[1]] as const;
        })();

        const u = px / view.width;
        const v = -py / view.height;
        if (!sampleBilinear(view, u, v, colour)) continue;

        r += colour[0] * weight;
        g += colour[1] * weight;
        b += colour[2] * weight;
        weightSum += weight;
        viewContributions[view.view] = (viewContributions[view.view] ?? 0) + 1;
      }

      if (weightSum <= 0) continue;

      const inv = 1 / weightSum;
      const oi = texel * 4;
      const sr = r * inv;
      const sg = g * inv;
      const sb = b * inv;
      out[oi] = sr;
      out[oi + 1] = sg;
      out[oi + 2] = sb;
      out[oi + 3] = 255;
      hasSample[texel] = 1;

      // Collect fallback statistics from the face and from the hair region.
      const py = input.positions[vertex * 3 + 1];
      if (py > hairlineY) {
        hairSumR += sr;
        hairSumG += sg;
        hairSumB += sb;
        hairCount += 1;
      } else if (input.positions[vertex * 3 + 2] > 0.2) {
        skinSumR += sr;
        skinSumG += sg;
        skinSumB += sb;
        skinCount += 1;
      }
    }
  }

  const skinColor: [number, number, number] = input.skinColor ?? [
    skinCount > 0 ? skinSumR / skinCount : 205,
    skinCount > 0 ? skinSumG / skinCount : 160,
    skinCount > 0 ? skinSumB / skinCount : 135,
  ];
  const hairColor: [number, number, number] = input.hairColor ?? [
    hairCount > 0 ? hairSumR / hairCount : skinColor[0] * 0.3,
    hairCount > 0 ? hairSumG / hairCount : skinColor[1] * 0.28,
    hairCount > 0 ? hairSumB / hairCount : skinColor[2] * 0.26,
  ];

  // Second pass: paint the texels no photograph could see.
  let texturedTexels = 0;
  for (let ty = 0; ty < height; ty += 1) {
    for (let tx = 0; tx < width; tx += 1) {
      const texel = ty * width + tx;
      const oi = texel * 4;
      if (hasSample[texel]) {
        texturedTexels += 1;
        continue;
      }

      const vertex = vertexIndexForTexel(tx, ty, width, height, segmentsX, segmentsY);
      let fallback = skinColor;
      if (vertex < vertexCount) {
        const y = input.positions[vertex * 3 + 1];
        const z = input.positions[vertex * 3 + 2];
        if (y > hairlineY || (z < -0.05 && y > -0.02)) fallback = hairColor;
      }
      out[oi] = fallback[0];
      out[oi + 1] = fallback[1];
      out[oi + 2] = fallback[2];
      out[oi + 3] = 255;
    }
  }

  return {
    width,
    height,
    data: out,
    coverage: total > 0 ? texturedTexels / total : 0,
    texturedTexels,
    totalTexels: total,
    viewContributions,
    skinColor,
    hairColor,
  };
}
