/**
 * Personalized baseline geometry (multi-photo reconstruction).
 *
 * The reconstruction itself is produced in the *canonical face model* frame
 * (the real MediaPipe asset, 468 vertices, millimetre-ish units). The
 * simulation, however, runs on a closed volumetric head so that the
 * deformation engine and the anatomical attachments (eyes, brows, ears) have
 * a watertight surface to work with.
 *
 * This module bridges the two with a genuine, deterministic shape transfer:
 *
 *   1. a similarity transform `T` is fitted between the canonical face model
 *      and the neutral procedural head, using anatomical landmark pairs
 *      (nasion, pronasale, alae, eye corners, lips, chin) that exist in both
 *      models;
 *   2. every head-mesh vertex is mapped into canonical space with `T^-1` and
 *      its corresponding canonical vertices are found by inverse-distance
 *      weighting;
 *   3. the reconstructed shape is mapped back with `T`, and the difference to
 *      the canonical template becomes a per-vertex displacement;
 *   4. the displacement is faded out towards the rim of the canonical face
 *      patch and towards regions the patch does not cover, so the identity
 *      blends smoothly into the untouched cranium instead of tearing.
 *
 * The result is an immutable *baseline*: the simulation parameters are always
 * applied on top of it, never accumulated into it, so undo/reset reproduce
 * exactly the same geometry.
 */

import { surfacePoint } from "./headShape";
import type { FaceMorph } from "./faceMorph";
import { clampMorph } from "./faceMorph";
import type { CanonicalFaceModel } from "../../services/canonicalFaceModel";
import {
  fitSimilarity,
  type SimilarityTransform,
} from "../../services/multiViewFitting";

/**
 * Anatomical pairs that exist in both the canonical face model (by MediaPipe
 * landmark index) and the procedural head (by facial coordinate).
 *
 * `weight` expresses how much the pair is trusted in the alignment: the
 * midline landmarks are unambiguous in both models, the lateral ones are
 * stylised in the procedural head.
 */
export interface CanonicalSceneAnchor {
  id: string;
  /** MediaPipe Face Mesh landmark index in the canonical model. */
  index: number;
  /** Facial coordinate of the matching point on the procedural head. */
  x: number;
  y: number;
  weight: number;
  /** Explicit 3D target on a non-procedural head (scene units). */
  position?: [number, number, number];
}

export const CANONICAL_SCENE_ANCHORS: CanonicalSceneAnchor[] = [
  { id: "nasion", index: 168, x: 0, y: 0.34, weight: 1 },
  { id: "rhinion", index: 195, x: 0, y: 0.17, weight: 1 },
  { id: "pronasale", index: 4, x: 0, y: -0.16, weight: 1 },
  { id: "subnasale", index: 2, x: 0, y: -0.3, weight: 1 },
  { id: "upper_lip", index: 0, x: 0, y: -0.36, weight: 1 },
  { id: "lower_lip", index: 17, x: 0, y: -0.44, weight: 1 },
  { id: "pogonion", index: 175, x: 0, y: -0.56, weight: 1 },
  { id: "menton", index: 152, x: 0, y: -0.6, weight: 1 },
  { id: "alar_l", index: 425, x: 0.15, y: -0.19, weight: 0.8 },
  { id: "alar_r", index: 205, x: -0.15, y: -0.19, weight: 0.8 },
  { id: "eye_outer_l", index: 263, x: 0.32, y: 0.19, weight: 0.8 },
  { id: "eye_outer_r", index: 33, x: -0.32, y: 0.19, weight: 0.8 },
];

export interface CanonicalAlignment {
  transform: SimilarityTransform;
  /** RMS distance between the aligned canonical anchors and the head anchors. */
  rmse: number;
  /** Per-anchor residual, for diagnostics. */
  residuals: { id: string; residual: number }[];
}

/** Weighted similarity fit between the canonical model and the procedural head. */
export function computeCanonicalAlignment(
  canonical: CanonicalFaceModel,
  anchors: CanonicalSceneAnchor[] = CANONICAL_SCENE_ANCHORS,
): CanonicalAlignment {
  const count = anchors.length;
  const source = new Float32Array(count * 3);
  const target = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const anchor = anchors[i];
    const o = anchor.index * 3;
    source[i * 3] = canonical.positions[o];
    source[i * 3 + 1] = canonical.positions[o + 1];
    source[i * 3 + 2] = canonical.positions[o + 2];
    const [hx, hy, hz] = anchor.position
      ? [anchor.position[0], anchor.position[1], anchor.position[2]]
      : surfacePoint(anchor.x, anchor.y);
    target[i * 3] = hx;
    target[i * 3 + 1] = hy;
    target[i * 3 + 2] = hz;
  }

  const fit = fitSimilarity(source, target, count);
  const transform = fit.transform;

  const residuals: { id: string; residual: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const px =
      transform.scale *
        (transform.rotation[0] * source[o] +
          transform.rotation[1] * source[o + 1] +
          transform.rotation[2] * source[o + 2]) +
      transform.translation[0];
    const py =
      transform.scale *
        (transform.rotation[3] * source[o] +
          transform.rotation[4] * source[o + 1] +
          transform.rotation[5] * source[o + 2]) +
      transform.translation[1];
    const pz =
      transform.scale *
        (transform.rotation[6] * source[o] +
          transform.rotation[7] * source[o + 1] +
          transform.rotation[8] * source[o + 2]) +
      transform.translation[2];
    const d = Math.hypot(px - target[o], py - target[o + 1], pz - target[o + 2]);
    residuals.push({ id: anchors[i].id, residual: d });
  }

  return { transform, rmse: fit.rmse, residuals };
}

export interface PersonalizedHeadModel {
  /** Number of head-mesh vertices the displacement was computed for. */
  readonly vertexCount: number;
  /** Per-vertex displacement (3 floats each) in scene units. */
  readonly displacement: Float32Array;
  /** Per-vertex blend weight actually applied (0..1). */
  readonly coverage: Float32Array;
  /**
   * Per-vertex corresponding point on the reconstructed canonical mesh
   * (3 floats each, canonical/template frame, cm).
   *
   * This is the interpolation that produced the displacement, kept so that the
   * photograph texture can be projected through the very same correspondence:
   * a head vertex and its texture sample describe the same skin point.
   */
  readonly correspondence: Float32Array;
  /** The reconstructed canonical shape (3N, canonical units). */
  readonly canonicalShape: Float32Array;
  /** The canonical template (3N, canonical units). */
  readonly canonicalTemplate: Float32Array;
  /** The canonical -> scene similarity used for the transfer. */
  readonly alignment: SimilarityTransform;
  /** Alignment quality (RMS anchor residual in scene units). */
  readonly alignmentRmse: number;
  /** Bounded identity coefficients derived from the reconstruction. */
  readonly morph: FaceMorph;
}

/**
 * Inverse of the canonical -> scene similarity.
 *
 * The forward transform is `scene = scale * R * canonical + T`, so the
 * inverse is `canonical = (1/scale) * R^T * (scene - T)`. The translation is
 * therefore *not* pre-divided by the scale - the scale factor is carried
 * separately and applied to the rotated difference.
 */
export function invertSimilarity(transform: SimilarityTransform): SimilarityTransform {
  const { rotation, translation, scale } = transform;
  const inv = 1 / (scale || 1);
  // R is orthonormal, so R^-1 = R^T.
  const rT = new Float32Array(9);
  rT[0] = rotation[0];
  rT[1] = rotation[3];
  rT[2] = rotation[6];
  rT[3] = rotation[1];
  rT[4] = rotation[4];
  rT[5] = rotation[7];
  rT[6] = rotation[2];
  rT[7] = rotation[5];
  rT[8] = rotation[8];
  return { rotation: rT, translation: new Float32Array(translation), scale: inv };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Uniform grid over the canonical vertices.
 *
 * The correspondence search asks for the `k` nearest canonical vertices of
 * every head-mesh vertex. A brute-force search would be O(V_head * V_canonical)
 * (~12 million distance evaluations for the default head), which is far too
 * slow to run interactively. The grid reduces this to the handful of
 * candidates that can possibly be inside the coverage radius.
 */
class CanonicalGrid {
  private readonly cellSize: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly minZ: number;
  private readonly maxX: number;
  private readonly maxY: number;
  private readonly maxZ: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly cells = new Map<number, number[]>();

  constructor(positions: Float32Array, count: number, cellSize: number) {
    this.cellSize = cellSize;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const o = i * 3;
      minX = Math.min(minX, positions[o]);
      maxX = Math.max(maxX, positions[o]);
      minY = Math.min(minY, positions[o + 1]);
      maxY = Math.max(maxY, positions[o + 1]);
      minZ = Math.min(minZ, positions[o + 2]);
      maxZ = Math.max(maxZ, positions[o + 2]);
    }
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
    this.nx = Math.max(1, Math.ceil((maxX - minX) / cellSize) + 1);
    this.ny = Math.max(1, Math.ceil((maxY - minY) / cellSize) + 1);
    this.nz = Math.max(1, Math.ceil((maxZ - minZ) / cellSize) + 1);

    for (let i = 0; i < count; i += 1) {
      const o = i * 3;
      const key = this.key(
        this.cellX(positions[o]),
        this.cellY(positions[o + 1]),
        this.cellZ(positions[o + 2]),
      );
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(i);
      else this.cells.set(key, [i]);
    }
  }

  private cellX(x: number): number {
    return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.minX) / this.cellSize)));
  }

  private cellY(y: number): number {
    return Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.minY) / this.cellSize)));
  }

  private cellZ(z: number): number {
    return Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.minZ) / this.cellSize)));
  }

  private key(ix: number, iy: number, iz: number): number {
    return ix + this.nx * (iy + this.ny * iz);
  }

  /**
   * Fill `indices` / `distances` with the `k` nearest canonical vertices.
   * Returns the number of candidates that were found.
   *
   * The search stops as soon as no cell outside the visited rings can hold a
   * closer vertex, and it gives up immediately when the query point is further
   * away from the patch than the coverage radius.
   */
  query(
    x: number,
    y: number,
    z: number,
    positions: Float32Array,
    indices: Int32Array,
    distances: Float64Array,
    k: number,
    maxDistance: number,
  ): number {
    for (let i = 0; i < k; i += 1) {
      indices[i] = -1;
      distances[i] = Infinity;
    }

    // Early out: the query point is outside the reach of the patch.
    const dx = Math.max(this.minX - x, 0, x - this.maxX);
    const dy = Math.max(this.minY - y, 0, y - this.maxY);
    const dz = Math.max(this.minZ - z, 0, z - this.maxZ);
    if (Math.hypot(dx, dy, dz) > maxDistance) return 0;

    const cx = this.cellX(x);
    const cy = this.cellY(y);
    const cz = this.cellZ(z);

    let found = 0;
    const maxRing = Math.max(this.nx, this.ny, this.nz);
    for (let ring = 0; ring <= maxRing; ring += 1) {
      for (let ix = cx - ring; ix <= cx + ring; ix += 1) {
        if (ix < 0 || ix >= this.nx) continue;
        for (let iy = cy - ring; iy <= cy + ring; iy += 1) {
          if (iy < 0 || iy >= this.ny) continue;
          for (let iz = cz - ring; iz <= cz + ring; iz += 1) {
            if (iz < 0 || iz >= this.nz) continue;
            // Only the shell of the current ring.
            const shell =
              Math.abs(ix - cx) === ring ||
              Math.abs(iy - cy) === ring ||
              Math.abs(iz - cz) === ring;
            if (!shell) continue;
            const bucket = this.cells.get(this.key(ix, iy, iz));
            if (!bucket) continue;
            for (const index of bucket) {
              const o = index * 3;
              const dx = positions[o] - x;
              const dy = positions[o + 1] - y;
              const dz = positions[o + 2] - z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 >= distances[k - 1]) continue;
              let slot = k - 1;
              while (slot > 0 && distances[slot - 1] > d2) {
                distances[slot] = distances[slot - 1];
                indices[slot] = indices[slot - 1];
                slot -= 1;
              }
              distances[slot] = d2;
              indices[slot] = index;
              found += 1;
            }
          }
        }
      }
      // Every vertex in the next ring is at least `ring * cellSize` away, so
      // no further cell can improve the current k-th distance.
      if (distances[k - 1] <= ring * this.cellSize) break;
    }
    return found;
  }
}

export interface PersonalizedBuildOptions {
  /** Number of canonical neighbours used for the interpolation. */
  neighbours?: number;
  /** Distance (canonical units) beyond which a head vertex keeps the base shape. */
  coverageRadius?: number;
  /** Distance (canonical units) at which the coverage is still complete. */
  coverageInner?: number;
  /** Override the canonical<->head alignment anchors. */
  anchors?: CanonicalSceneAnchor[];
}

/**
 * Build the personalized baseline for a head mesh.
 *
 * @param canonical The canonical face model (template + topology).
 * @param shape The reconstructed canonical shape (same length as the template).
 * @param headPositions The neutral head-mesh positions (3 floats per vertex).
 */
export function buildPersonalizedHeadModel(
  canonical: CanonicalFaceModel,
  shape: Float32Array,
  headPositions: Float32Array,
  options: PersonalizedBuildOptions = {},
): PersonalizedHeadModel {
  const neighbourCount = options.neighbours ?? 6;
  const coverageRadius = options.coverageRadius ?? 3.2;
  const coverageInner = options.coverageInner ?? 1.1;

  const alignment = computeCanonicalAlignment(canonical, options.anchors);
  const inverse = invertSimilarity(alignment.transform);

  const vertexCount = Math.floor(headPositions.length / 3);
  const displacement = new Float32Array(vertexCount * 3);
  const coverage = new Float32Array(vertexCount);
  const correspondence = new Float32Array(vertexCount * 3);

  const canonicalCount = canonical.vertexCount;
  const template = canonical.positions;
  const { rotation, scale } = alignment.transform;

  // Scratch buffers for the k-nearest search.
  const bestIndex = new Int32Array(neighbourCount);
  const bestDistance = new Float64Array(neighbourCount);
  // The grid cell size matches the coverage radius: a query only has to look
  // at the cells within one ring of the query point.
  const grid = new CanonicalGrid(template, canonicalCount, coverageRadius);

  for (let v = 0; v < vertexCount; v += 1) {
    const o = v * 3;
    const px = headPositions[o];
    const py = headPositions[o + 1];
    const pz = headPositions[o + 2];

    // Map the head vertex into canonical space:
    // canonical = (1/scale) * R^T * (head - T).
    const dx = px - inverse.translation[0];
    const dy = py - inverse.translation[1];
    const dz = pz - inverse.translation[2];
    const qx =
      inverse.scale *
      (inverse.rotation[0] * dx + inverse.rotation[1] * dy + inverse.rotation[2] * dz);
    const qy =
      inverse.scale *
      (inverse.rotation[3] * dx + inverse.rotation[4] * dy + inverse.rotation[5] * dz);
    const qz =
      inverse.scale *
      (inverse.rotation[6] * dx + inverse.rotation[7] * dy + inverse.rotation[8] * dz);

    // k-nearest canonical vertices.
    grid.query(
      qx,
      qy,
      qz,
      template,
      bestIndex,
      bestDistance,
      neighbourCount,
      coverageRadius,
    );

    const nearest = bestIndex[0];
    if (nearest < 0) continue;
    const nearestDistance = Math.sqrt(bestDistance[0]);

    // Even where the reconstruction has no authority over the vertex, record
    // the nearest canonical point as a plausible projection target.
    correspondence[o] = shape[nearest * 3];
    correspondence[o + 1] = shape[nearest * 3 + 1];
    correspondence[o + 2] = shape[nearest * 3 + 2];

    // Coverage: the vertex must be close to the canonical patch and away
    // from its open rim, otherwise the reconstruction says nothing about it.
    const spatial = 1 - smoothstep(coverageInner, coverageRadius, nearestDistance);
    const boundary = smoothstep(0.5, 2.5, canonical.boundaryDistance[nearest]);
    const weight = spatial * boundary;
    coverage[v] = weight;
    if (weight <= 0) continue;

    // Inverse-distance blend of the canonical identity delta and of the
    // reconstructed point itself (the latter is what the texture projects).
    let weightSum = 0;
    let bx = 0;
    let by = 0;
    let bz = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let k = 0; k < neighbourCount; k += 1) {
      const c = bestIndex[k];
      if (c < 0) continue;
      const d = Math.sqrt(bestDistance[k]);
      const w = 1 / (d * d + 1e-4);
      const co = c * 3;
      bx += w * (shape[co] - template[co]);
      by += w * (shape[co + 1] - template[co + 1]);
      bz += w * (shape[co + 2] - template[co + 2]);
      sx += w * shape[co];
      sy += w * shape[co + 1];
      sz += w * shape[co + 2];
      weightSum += w;
    }
    if (weightSum <= 0) continue;
    const invWeight = 1 / weightSum;
    bx *= invWeight;
    by *= invWeight;
    bz *= invWeight;
    correspondence[o] = sx * invWeight;
    correspondence[o + 1] = sy * invWeight;
    correspondence[o + 2] = sz * invWeight;

    // Canonical delta -> scene delta (linear part of the similarity).
    displacement[o] = weight * scale * (rotation[0] * bx + rotation[1] * by + rotation[2] * bz);
    displacement[o + 1] = weight * scale * (rotation[3] * bx + rotation[4] * by + rotation[5] * bz);
    displacement[o + 2] = weight * scale * (rotation[6] * bx + rotation[7] * by + rotation[8] * bz);
  }

  return {
    vertexCount,
    displacement,
    coverage,
    correspondence,
    canonicalShape: new Float32Array(shape),
    canonicalTemplate: new Float32Array(template),
    alignment: alignment.transform,
    alignmentRmse: alignment.rmse,
    morph: deriveMorphFromCanonical(canonical, shape),
  };
}

/** Add the personalized displacement to a baseline position buffer. */
export function applyPersonalizedDisplacement(
  base: Float32Array,
  model: PersonalizedHeadModel | null | undefined,
): Float32Array {
  if (!model) return base;
  if (model.vertexCount * 3 !== base.length) return base;
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i += 1) out[i] = base[i] + model.displacement[i];
  return out;
}

/* -------------------------------------------------------------------------- */
/* Measurements and derived identity coefficients                              */
/* -------------------------------------------------------------------------- */

export interface CanonicalMeasurements {
  /** Outer eye corner to outer eye corner. */
  bizygomaticWidth: number;
  /** Distance between the two eye centres. */
  interpupillaryDistance: number;
  /** Width of one palpebral fissure. */
  palpebralWidth: number;
  /** Alar width. */
  alarWidth: number;
  /** Nose tip projection measured from the nasion. */
  noseProjection: number;
  /** Nasion to subnasale. */
  noseLength: number;
  /** Mouth corner to mouth corner. */
  mouthWidth: number;
  /** Glabella to menton. */
  faceHeight: number;
  /** Subnasale to menton (lower face). */
  lowerFaceHeight: number;
  /** Eye line height above the chin, as a fraction of the face height. */
  eyeLineRatio: number;
}

const EYE_OUTER_L = 263;
const EYE_INNER_L = 362;
const EYE_OUTER_R = 33;
const EYE_INNER_R = 133;
const ALAR_L = 425;
const ALAR_R = 205;
const PRONASALE = 4;
const NASION = 168;
const SUBNASALE = 2;
const MOUTH_L = 291;
const MOUTH_R = 61;
const GLABELLA = 9;
const MENTON = 152;

function distance2(a: Float32Array, i: number, j: number): number {
  const oi = i * 3;
  const oj = j * 3;
  return Math.hypot(a[oi] - a[oj], a[oi + 1] - a[oj + 1], a[oi + 2] - a[oj + 2]);
}

/** Measure the face proportions of a canonical-space point set. */
export function measureCanonicalFace(points: Float32Array): CanonicalMeasurements {
  const eyeCentreLx = (points[EYE_OUTER_L * 3] + points[EYE_INNER_L * 3]) / 2;
  const eyeCentreLy = (points[EYE_OUTER_L * 3 + 1] + points[EYE_INNER_L * 3 + 1]) / 2;
  const eyeCentreRx = (points[EYE_OUTER_R * 3] + points[EYE_INNER_R * 3]) / 2;
  const eyeCentreRy = (points[EYE_OUTER_R * 3 + 1] + points[EYE_INNER_R * 3 + 1]) / 2;

  const faceHeight = points[GLABELLA * 3 + 1] - points[MENTON * 3 + 1];

  return {
    bizygomaticWidth: distance2(points, EYE_OUTER_L, EYE_OUTER_R),
    interpupillaryDistance: Math.hypot(eyeCentreLx - eyeCentreRx, eyeCentreLy - eyeCentreRy),
    palpebralWidth: distance2(points, EYE_OUTER_L, EYE_INNER_L),
    alarWidth: distance2(points, ALAR_L, ALAR_R),
    noseProjection: points[PRONASALE * 3 + 2] - points[NASION * 3 + 2],
    noseLength: points[NASION * 3 + 1] - points[SUBNASALE * 3 + 1],
    mouthWidth: distance2(points, MOUTH_L, MOUTH_R),
    faceHeight,
    lowerFaceHeight: points[SUBNASALE * 3 + 1] - points[MENTON * 3 + 1],
    eyeLineRatio: (eyeCentreLy - points[MENTON * 3 + 1]) / (faceHeight || 1),
  };
}

/**
 * Derive bounded identity coefficients from a reconstructed canonical shape.
 *
 * These coefficients are *not* the reconstruction: they are the coarse
 * summary used to place the anatomical attachments (eyes, brows, ears) on the
 * personalized surface and to keep the legacy morph pathway consistent. The
 * full identity lives in the displacement field.
 */
export function deriveMorphFromCanonical(
  canonical: CanonicalFaceModel,
  shape: Float32Array,
): FaceMorph {
  const template = measureCanonicalFace(canonical.positions);
  const patient = measureCanonicalFace(shape);

  const ratio = (value: number, reference: number, fallback = 1): number =>
    reference > 1e-6 ? value / reference : fallback;

  // Scene units per canonical unit (the eye centre anchor fixes the scale).
  const scenePerUnit = 0.24 / Math.max(0.1, (canonical.positions[EYE_OUTER_L * 3] + canonical.positions[EYE_INNER_L * 3]) / 2);

  const faceWidthRatio = ratio(patient.bizygomaticWidth, template.bizygomaticWidth);
  const palpebralRatio = ratio(patient.palpebralWidth, template.palpebralWidth);
  const lowerFaceRatio = ratio(patient.lowerFaceHeight, template.lowerFaceHeight);

  const morph: FaceMorph = {
    faceWidth: 0,
    faceLength: 0,
    foreheadHeight: 0,
    jawWidth: 0,
    chinWidth: 0,
    chinLength: 0,
    cheekFullness: 0,
    eyeSpacing: 0,
    eyeSize: 0,
    eyeHeight: 0,
    browHeight: 0,
    noseWidth: 0,
    noseLength: 0,
    noseTip: 0,
    mouthWidth: 0,
    lipFullness: 0,
  };

  // faceWidth scales x by (1 + 0.12 * faceWidth).
  morph.faceWidth = clampMorph((faceWidthRatio - 1) / 0.12);

  // eyeSpacing shifts the eyes laterally by up to 0.05 scene units.
  const ipdShift = ((patient.interpupillaryDistance - template.interpupillaryDistance) / 2) * scenePerUnit;
  morph.eyeSpacing = clampMorph(ipdShift / 0.05);

  // eyeSize scales the eyeball by (1 + 0.28 * eyeSize).
  morph.eyeSize = clampMorph((palpebralRatio - 1) / 0.28);

  // eyeHeight shifts the eye line vertically by up to 0.05 scene units.
  const eyeLineShift =
    (patient.eyeLineRatio - template.eyeLineRatio) * patient.faceHeight * scenePerUnit;
  morph.eyeHeight = clampMorph(eyeLineShift / 0.05);

  // noseWidth spreads the alar region by up to 0.05 scene units per side.
  const alarShift = ((patient.alarWidth - template.alarWidth) / 2) * scenePerUnit;
  morph.noseWidth = clampMorph(alarShift / 0.05);

  // noseTip moves the tip forward by up to 0.06 scene units.
  const tipShift = (patient.noseProjection - template.noseProjection) * scenePerUnit;
  morph.noseTip = clampMorph(tipShift / 0.06);

  // noseLength lowers the nasal base by up to 0.06 scene units.
  const lengthShift = (template.noseLength - patient.noseLength) * scenePerUnit;
  morph.noseLength = clampMorph(lengthShift / 0.06);

  // mouthWidth spreads the lips by up to 0.05 scene units per side.
  const mouthShift = ((patient.mouthWidth - template.mouthWidth) / 2) * scenePerUnit;
  morph.mouthWidth = clampMorph(mouthShift / 0.05);

  // faceLength scales the vertical dimension by (1 + 0.12 * faceLength).
  morph.faceLength = clampMorph((lowerFaceRatio - 1) / 0.12);

  return morph;
}
