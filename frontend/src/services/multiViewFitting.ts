/**
 * Multi-view 3D face fitting — the reconstruction core.
 *
 * This is a real, self-contained bundle-adjustment style fit with known
 * correspondences:
 *
 *   - the observations are the 3D facial landmarks produced by the bundled
 *     MediaPipe Face Landmarker (a genuine pretrained model) for each photo;
 *   - the template is the MediaPipe canonical face model (468 vertices, real
 *     triangle topology), which supplies the mesh, the smooth regularisation
 *     neighbourhood and the anatomical correspondence;
 *   - the unknowns are the shared 3D shape `X` (468 points) plus, per view, a
 *     similarity transform (rotation, translation, uniform scale) that maps
 *     `X` into that view's camera frame.
 *
 * Minimised objective (all terms in pixels, the unit of the observations):
 *
 *   E(X) = SUM_views SUM_i || s_v R_v X_i + t_v - P_vi ||^2      (reprojection)
 *        + priorW * SUM_i || X_i - X_prior,i ||^2               (identity prior)
 *        + lambda  * SUM_edges || X_i - X_j ||^2                (smoothness)
 *
 * Because the landmark indices are the *same anatomical points* in every
 * photograph, the shared shape couples the views: the profile photographs
 * constrain the depth of the face that the frontal photograph cannot see.
 * This is a genuine multi-view reconstruction, not a per-photo landmark fit.
 *
 * Everything runs locally in the browser; no photo ever leaves the device.
 */

import type { PhotoView } from "../lib/multiViewPhoto";
import type { CanonicalFaceModel } from "./canonicalFaceModel";

export interface ViewObservation {
  view: PhotoView;
  /**
   * Observed 3D landmarks in an orthographic camera frame:
   * x = image right, y = image up, z = toward the camera. All three axes use
   * the same unit (pixels), so the cloud is directly comparable to the
   * canonical model up to a similarity transform.
   */
  points: Float32Array;
  /** Number of valid points (3 floats each) present in `points`. */
  pointCount: number;
}

export interface MultiViewFitOptions {
  /** Maximum number of outer (pose <-> shape) iterations. */
  maxIterations: number;
  /** Relative weight of the mesh Laplacian smoothness term. */
  smoothness: number;
  /** Relative weight of the pull towards the canonical template (identity prior). */
  prior: number;
  /** Convergence tolerance on the relative shape change. */
  tolerance: number;
  /** Minimum number of landmarks a view must contribute to be used. */
  minPointsPerView: number;
}

export const DEFAULT_FIT_OPTIONS: MultiViewFitOptions = {
  maxIterations: 12,
  smoothness: 0.02,
  prior: 0.05,
  tolerance: 1e-5,
  minPointsPerView: 100,
};

export interface SimilarityTransform {
  /** Row-major 3x3 rotation. */
  rotation: Float32Array;
  translation: Float32Array;
  scale: number;
}

export interface ViewFitStats {
  view: PhotoView;
  scale: number;
  rotation: Float32Array;
  translation: Float32Array;
  /** RMS reprojection error in the observation unit (pixels). */
  rmse: number;
  /** RMS error of the in-plane (image plane) components (pixels). */
  rmseXY: number;
  /** RMS error of the depth component (pixels). */
  rmseZ: number;
  /** Largest reprojection error in the observation unit (pixels). */
  maxResidual: number;
  /** RMS reprojection error of the mirrored alternative fit (pixels). */
  mirroredRmse: number;
  /** True when the mirrored alternative explains the photo markedly better. */
  looksMirrored: boolean;
  observedPoints: number;
}

export interface MultiViewFitResult {
  /** Reconstructed shape aligned onto the canonical template frame (3N, cm). */
  shape: Float32Array;
  /** Per-vertex deviation from the canonical template (3N, cm). */
  deltas: Float32Array;
  /** Similarity transform that maps the fitted shape onto the template. */
  alignment: SimilarityTransform;
  perView: ViewFitStats[];
  iterations: number;
  converged: boolean;
  /** Mean RMS error across views, in pixels. */
  meanRmse: number;
  /** Worst RMS error across views, in pixels. */
  maxRmse: number;
  /** RMS error of the mirrored alternative for the whole set (pixels). */
  mirroredMeanRmse: number;
  /** True when the whole set is better explained when mirrored. */
  setLooksMirrored: boolean;
  /** The view the shape was initialised from. */
  referenceView: PhotoView;
}

/* -------------------------------------------------------------------------- */
/* Small linear algebra helpers                                               */
/* -------------------------------------------------------------------------- */

function mat3Identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

function mat3Transpose(a: Float32Array, out: Float32Array): Float32Array {
  const t = [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
  out.set(t);
  return out;
}

/** Rotation matrix of the unit quaternion (w, x, y, z). */
function quatToMat3(w: number, x: number, y: number, z: number, out: Float32Array): Float32Array {
  const n = w * w + x * x + y * y + z * z || 1;
  const s = 2 / n;
  out[0] = 1 - s * (y * y + z * z);
  out[1] = s * (x * y - w * z);
  out[2] = s * (x * z + w * y);
  out[3] = s * (x * y + w * z);
  out[4] = 1 - s * (x * x + z * z);
  out[5] = s * (y * z - w * x);
  out[6] = s * (x * z - w * y);
  out[7] = s * (y * z + w * x);
  out[8] = 1 - s * (x * x + y * y);
  return out;
}

/**
 * Largest eigenvalue / eigenvector of a symmetric 4x4 matrix (cyclic Jacobi).
 *
 * The matrix must be symmetric: the sweep reads `a[p][q]` and `a[q][p]`, so an
 * asymmetric input silently produces a wrong eigenvector.
 */
function largestEigenvector4(matrix: Float32Array): { value: number; vector: Float32Array } {
  const a = new Float64Array(matrix);
  const v = new Float64Array(16);
  for (let i = 0; i < 4; i += 1) v[i * 4 + i] = 1;

  for (let sweep = 0; sweep < 64; sweep += 1) {
    let off = 0;
    for (let p = 0; p < 4; p += 1) {
      for (let q = p + 1; q < 4; q += 1) off += a[p * 4 + q] * a[p * 4 + q];
    }
    if (off < 1e-20) break;

    for (let p = 0; p < 3; p += 1) {
      for (let q = p + 1; q < 4; q += 1) {
        const apq = a[p * 4 + q];
        if (Math.abs(apq) < 1e-20) continue;
        const theta = (a[q * 4 + q] - a[p * 4 + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        const app = a[p * 4 + p];
        const aqq = a[q * 4 + q];
        a[p * 4 + p] = app - t * apq;
        a[q * 4 + q] = aqq + t * apq;
        a[p * 4 + q] = 0;
        a[q * 4 + p] = 0;

        for (let k = 0; k < 4; k += 1) {
          if (k !== p && k !== q) {
            const akp = a[k * 4 + p];
            const akq = a[k * 4 + q];
            const nkp = c * akp - s * akq;
            const nkq = s * akp + c * akq;
            a[k * 4 + p] = nkp;
            a[p * 4 + k] = nkp;
            a[k * 4 + q] = nkq;
            a[q * 4 + k] = nkq;
          }
          const vkp = v[k * 4 + p];
          const vkq = v[k * 4 + q];
          v[k * 4 + p] = c * vkp - s * vkq;
          v[k * 4 + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  let best = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < 4; i += 1) {
    if (a[i * 4 + i] > bestValue) {
      bestValue = a[i * 4 + i];
      best = i;
    }
  }
  const vector = new Float32Array([v[best], v[4 + best], v[8 + best], v[12 + best]]);
  const norm = Math.hypot(vector[0], vector[1], vector[2], vector[3]) || 1;
  for (let i = 0; i < 4; i += 1) vector[i] /= norm;
  if (vector[0] < 0) {
    for (let i = 0; i < 4; i += 1) vector[i] = -vector[i];
  }
  return { value: bestValue, vector };
}

/**
 * Horn's quaternion solution of the absolute orientation problem.
 *
 * `s` is the row-major cross-covariance `SUM (a - meanA)(b - meanB)^T`, with
 * `a` the source and `b` the target. The returned rotation maps `a` onto `b`.
 */
function hornRotation(s: Float64Array): Float32Array {
  const n = new Float64Array(16);
  // Horn (1987), "Closed-form solution of absolute orientation using unit
  // quaternions". The matrix is symmetric; both triangles must be filled.
  n[0] = s[0] + s[4] + s[8]; // Sxx + Syy + Szz
  n[1] = s[5] - s[7]; // Syz - Szy
  n[4] = n[1];
  n[2] = s[6] - s[2]; // Szx - Sxz
  n[8] = n[2];
  n[3] = s[1] - s[3]; // Sxy - Syx
  n[12] = n[3];
  n[5] = s[0] - s[4] - s[8]; // Sxx - Syy - Szz
  n[6] = s[1] + s[3]; // Sxy + Syx
  n[9] = n[6];
  n[7] = s[6] + s[2]; // Szx + Sxz
  n[13] = n[7];
  n[10] = -s[0] + s[4] - s[8]; // -Sxx + Syy - Szz
  n[11] = s[5] + s[7]; // Syz + Szy
  n[14] = n[11];
  n[15] = -s[0] - s[4] + s[8]; // -Sxx - Syy + Szz

  const { vector } = largestEigenvector4(new Float32Array(n));
  const rotation = mat3Identity();
  quatToMat3(vector[0], vector[1], vector[2], vector[3], rotation);
  return rotation;
}

export interface SimilarityFit {
  transform: SimilarityTransform;
  rmse: number;
  /** RMS error of the two in-plane components. */
  rmseXY: number;
  /** RMS error of the depth component. */
  rmseZ: number;
  maxResidual: number;
}

/**
 * Umeyama/Horn similarity fit of `source` onto `target` (rotation + uniform
 * scale + translation, no reflection). Returns the transform and the residual
 * statistics.
 */
export function fitSimilarity(
  source: ArrayLike<number>,
  target: ArrayLike<number>,
  count: number,
): SimilarityFit {
  let rotation = mat3Identity();
  const translation = new Float32Array(3);
  let scale = 1;

  if (count < 4) {
    return {
      transform: { rotation, translation, scale },
      rmse: Infinity,
      rmseXY: Infinity,
      rmseZ: Infinity,
      maxResidual: Infinity,
    };
  }

  const meanA = new Float64Array(3);
  const meanB = new Float64Array(3);
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    meanA[0] += source[o];
    meanA[1] += source[o + 1];
    meanA[2] += source[o + 2];
    meanB[0] += target[o];
    meanB[1] += target[o + 1];
    meanB[2] += target[o + 2];
  }
  for (let k = 0; k < 3; k += 1) {
    meanA[k] /= count;
    meanB[k] /= count;
  }

  // Cross-covariance S = SUM (a - meanA) (b - meanB)^T
  const s = new Float64Array(9);
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const ax = source[o] - meanA[0];
    const ay = source[o + 1] - meanA[1];
    const az = source[o + 2] - meanA[2];
    const bx = target[o] - meanB[0];
    const by = target[o + 1] - meanB[1];
    const bz = target[o + 2] - meanB[2];
    s[0] += ax * bx;
    s[1] += ax * by;
    s[2] += ax * bz;
    s[3] += ay * bx;
    s[4] += ay * by;
    s[5] += ay * bz;
    s[6] += az * bx;
    s[7] += az * by;
    s[8] += az * bz;
  }

  rotation = hornRotation(s);
  // Optimal uniform scale for the rotation found above.
  let num = 0;
  let den = 0;
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const ax = source[o] - meanA[0];
    const ay = source[o + 1] - meanA[1];
    const az = source[o + 2] - meanA[2];
    const rx = rotation[0] * ax + rotation[1] * ay + rotation[2] * az;
    const ry = rotation[3] * ax + rotation[4] * ay + rotation[5] * az;
    const rz = rotation[6] * ax + rotation[7] * ay + rotation[8] * az;
    num += rx * (target[o] - meanB[0]) + ry * (target[o + 1] - meanB[1]) + rz * (target[o + 2] - meanB[2]);
    den += ax * ax + ay * ay + az * az;
  }
  scale = den > 1e-12 ? num / den : 1;
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  for (let k = 0; k < 3; k += 1) {
    translation[k] =
      meanB[k] -
      scale * (rotation[k * 3] * meanA[0] + rotation[k * 3 + 1] * meanA[1] + rotation[k * 3 + 2] * meanA[2]);
  }

  let sum = 0;
  let sumXY = 0;
  let sumZ = 0;
  let maxResidual = 0;
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const px = scale * (rotation[0] * source[o] + rotation[1] * source[o + 1] + rotation[2] * source[o + 2]) + translation[0];
    const py = scale * (rotation[3] * source[o] + rotation[4] * source[o + 1] + rotation[5] * source[o + 2]) + translation[1];
    const pz = scale * (rotation[6] * source[o] + rotation[7] * source[o + 1] + rotation[8] * source[o + 2]) + translation[2];
    const dx = px - target[o];
    const dy = py - target[o + 1];
    const dz = pz - target[o + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    sum += d2;
    sumXY += dx * dx + dy * dy;
    sumZ += dz * dz;
    if (d2 > maxResidual) maxResidual = d2;
  }

  return {
    transform: { rotation, translation, scale },
    rmse: Math.sqrt(sum / count),
    rmseXY: Math.sqrt(sumXY / count),
    rmseZ: Math.sqrt(sumZ / count),
    maxResidual: Math.sqrt(maxResidual),
  };
}

/** Apply a similarity transform to a flat point array. */
export function applySimilarity(
  transform: SimilarityTransform,
  points: Float32Array,
  out: Float32Array = new Float32Array(points.length),
): Float32Array {
  const { rotation, translation, scale } = transform;
  const count = Math.floor(points.length / 3);
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const x = points[o];
    const y = points[o + 1];
    const z = points[o + 2];
    out[o] = scale * (rotation[0] * x + rotation[1] * y + rotation[2] * z) + translation[0];
    out[o + 1] = scale * (rotation[3] * x + rotation[4] * y + rotation[5] * z) + translation[1];
    out[o + 2] = scale * (rotation[6] * x + rotation[7] * y + rotation[8] * z) + translation[2];
  }
  return out;
}

/**
 * Mirror an observation about the camera's vertical axis (x is negated).
 *
 * A horizontally flipped photograph produces exactly this: the image x axis
 * reverses while the depth towards the camera is unchanged.
 */
function mirrorPoints(points: Float32Array, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    out[o] = -points[o];
    out[o + 1] = points[o + 1];
    out[o + 2] = points[o + 2];
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Sparse linear solve                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Conjugate-gradient solve of `(diag + lambda * L) x = rhs`, where `L` is the
 * graph Laplacian of the canonical mesh (`L x` is `deg_i x_i - SUM_j x_j`).
 * The operator is the same for the three coordinate channels.
 */
function solveLaplacianSystem(
  diagonal: Float64Array,
  neighbours: Uint32Array[],
  lambda: number,
  rhs: Float64Array,
  count: number,
  out: Float64Array,
  iterations = 80,
): void {
  const apply = (v: Float64Array, res: Float64Array): void => {
    for (let i = 0; i < count; i += 1) {
      const nb = neighbours[i];
      let sum = 0;
      for (let k = 0; k < nb.length; k += 1) sum += v[nb[k]];
      res[i] = diagonal[i] * v[i] + lambda * (nb.length * v[i] - sum);
    }
  };

  const r = new Float64Array(rhs);
  const p = new Float64Array(rhs);
  const ap = new Float64Array(rhs);
  const x = new Float64Array(count);

  let rr = 0;
  for (let i = 0; i < count; i += 1) rr += r[i] * r[i];
  const initial = rr;

  // Standard preconditioned-free CG: p0 = r0, Ap0 = A p0.
  p.set(r);
  apply(p, ap);

  for (let iter = 0; iter < iterations && rr > 1e-12; iter += 1) {
    let pAp = 0;
    for (let i = 0; i < count; i += 1) pAp += p[i] * ap[i];
    if (Math.abs(pAp) < 1e-20) break;
    const alpha = rr / pAp;
    for (let i = 0; i < count; i += 1) {
      x[i] += alpha * p[i];
      r[i] -= alpha * ap[i];
    }
    let rrNext = 0;
    for (let i = 0; i < count; i += 1) rrNext += r[i] * r[i];
    const beta = rrNext / rr;
    for (let i = 0; i < count; i += 1) p[i] = p[i] * beta + r[i];
    apply(p, ap);
    rr = rrNext;
    if (initial > 0 && rr / initial < 1e-12) break;
  }

  out.set(x);
}

/* -------------------------------------------------------------------------- */
/* The fit                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fit one coherent 3D head shape to several views of the same patient.
 *
 * @param canonical The MediaPipe canonical face model (template + topology).
 * @param observations One entry per usable photograph.
 */
export function fitMultiViewFace(
  canonical: CanonicalFaceModel,
  observations: ViewObservation[],
  options: Partial<MultiViewFitOptions> = {},
): MultiViewFitResult {
  const opts = { ...DEFAULT_FIT_OPTIONS, ...options };
  const count = canonical.vertexCount;
  const usable = observations.filter((o) => o.pointCount >= opts.minPointsPerView);

  if (usable.length === 0) {
    throw new Error("No usable facial landmarks were found for the reconstruction.");
  }

  // --- Choose the reference view -------------------------------------------
  // Prefer the frontal photograph (its template fit is meaningful); otherwise
  // use the view the canonical template explains best.
  let referenceIndex = usable.findIndex((o) => o.view === "front");
  if (referenceIndex < 0) {
    let bestResidual = Infinity;
    for (let i = 0; i < usable.length; i += 1) {
      const fit = fitSimilarity(canonical.positions, usable[i].points, usable[i].pointCount);
      if (fit.rmse < bestResidual) {
        bestResidual = fit.rmse;
        referenceIndex = i;
      }
    }
  }
  const reference = usable[referenceIndex];

  // Initial shape: the reference view's own observations.
  const shape = new Float64Array(reference.points.subarray(0, count * 3));

  const perView: ViewFitStats[] = [];
  let iterations = 0;
  let converged = false;

  const rotations: Float32Array[] = [];
  const scales: number[] = [];
  const translations: Float32Array[] = [];

  for (let iter = 0; iter < opts.maxIterations; iter += 1) {
    iterations = iter + 1;

    // --- Pose step: similarity per view given the current shape --------------
    perView.length = 0;
    rotations.length = 0;
    scales.length = 0;
    translations.length = 0;
    for (const obs of usable) {
      const fit = fitSimilarity(shape, obs.points, obs.pointCount);
      // A horizontally flipped photograph is detected by re-fitting the
      // mirrored observation: if that explains the photo markedly better, the
      // photo is mirrored.
      const mirrored = fitSimilarity(
        shape,
        mirrorPoints(obs.points, obs.pointCount),
        obs.pointCount,
      );
      const mirroredRmse = mirrored.rmse;
      const looksMirrored =
        Number.isFinite(mirroredRmse) && mirroredRmse < fit.rmse * 0.75;
      perView.push({
        view: obs.view,
        scale: fit.transform.scale,
        rotation: fit.transform.rotation,
        translation: fit.transform.translation,
        rmse: fit.rmse,
        rmseXY: fit.rmseXY,
        rmseZ: fit.rmseZ,
        maxResidual: fit.maxResidual,
        mirroredRmse,
        looksMirrored,
        observedPoints: obs.pointCount,
      });
      rotations.push(fit.transform.rotation);
      scales.push(fit.transform.scale);
      translations.push(fit.transform.translation);
    }

    // --- Shape step: solve for X given the poses ----------------------------
    // The identity prior is the canonical template mapped into the current
    // shape frame (a similarity fit), so it constrains the *proportions* of the
    // face without fighting the observed scale.
    const priorTransform = fitSimilarity(canonical.positions, new Float32Array(shape), count)
      .transform;
    const prior = applySimilarity(priorTransform, canonical.positions);

    const diagonal = new Float64Array(count);
    const rhs = new Float64Array(count * 3);
    for (let v = 0; v < usable.length; v += 1) {
      const obs = usable[v];
      const rot = rotations[v];
      const trans = translations[v];
      const scale = scales[v];
      const rT = mat3Transpose(rot, new Float32Array(9));
      for (let i = 0; i < obs.pointCount && i < count; i += 1) {
        const o = i * 3;
        const bx = obs.points[o] - trans[0];
        const by = obs.points[o + 1] - trans[1];
        const bz = obs.points[o + 2] - trans[2];
        rhs[o] += scale * (rT[0] * bx + rT[1] * by + rT[2] * bz);
        rhs[o + 1] += scale * (rT[3] * bx + rT[4] * by + rT[5] * bz);
        rhs[o + 2] += scale * (rT[6] * bx + rT[7] * by + rT[8] * bz);
        diagonal[i] += scale * scale;
      }
    }

    // Regularisation weights are expressed relative to the data weight so that
    // they stay meaningful whatever the photo resolution is.
    let dataWeight = 0;
    for (let i = 0; i < count; i += 1) dataWeight += diagonal[i];
    dataWeight = count > 0 ? dataWeight / count : 1;
    if (!(dataWeight > 0)) dataWeight = 1;

    const priorWeight = opts.prior * dataWeight;
    const lambda = opts.smoothness * dataWeight;

    for (let i = 0; i < count; i += 1) {
      diagonal[i] += priorWeight;
      const o = i * 3;
      rhs[o] += priorWeight * prior[o];
      rhs[o + 1] += priorWeight * prior[o + 1];
      rhs[o + 2] += priorWeight * prior[o + 2];
    }

    const next = new Float64Array(count * 3);
    // The Laplacian system decouples per coordinate channel; solve each one.
    for (let axis = 0; axis < 3; axis += 1) {
      const channelRhs = new Float64Array(count);
      for (let i = 0; i < count; i += 1) channelRhs[i] = rhs[i * 3 + axis];
      const channelOut = new Float64Array(count);
      solveLaplacianSystem(diagonal, canonical.neighbours, lambda, channelRhs, count, channelOut);
      for (let i = 0; i < count; i += 1) next[i * 3 + axis] = channelOut[i];
    }

    // Convergence check on the relative shape change.
    let delta = 0;
    let norm = 0;
    for (let i = 0; i < next.length; i += 1) {
      const d = next[i] - shape[i];
      delta += d * d;
      norm += shape[i] * shape[i];
    }
    const relative = Math.sqrt(delta) / (Math.sqrt(norm) || 1);
    shape.set(next);
    if (relative < opts.tolerance) {
      converged = true;
      break;
    }
  }

  // --- Final alignment of the fitted shape onto the canonical template ------
  const shapeArray = new Float32Array(shape);
  const finalFit = fitSimilarity(shapeArray, canonical.positions, count);
  const aligned = applySimilarity(finalFit.transform, shapeArray);
  const deltas = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i += 1) {
    deltas[i] = aligned[i] - canonical.positions[i];
  }

  let rmseSum = 0;
  let rmseMax = 0;
  let mirroredSum = 0;
  let mirroredCount = 0;
  for (const stats of perView) {
    rmseSum += stats.rmse;
    rmseMax = Math.max(rmseMax, stats.rmse);
    if (Number.isFinite(stats.mirroredRmse)) {
      mirroredSum += stats.mirroredRmse;
      mirroredCount += 1;
    }
  }
  const mirroredMeanRmse = mirroredCount > 0 ? mirroredSum / mirroredCount : Infinity;

  return {
    shape: aligned,
    deltas,
    alignment: finalFit.transform,
    perView,
    iterations,
    converged,
    meanRmse: rmseSum / Math.max(1, perView.length),
    maxRmse: rmseMax,
    mirroredMeanRmse,
    setLooksMirrored:
      Number.isFinite(mirroredMeanRmse) && mirroredMeanRmse < rmseSum / Math.max(1, perView.length) * 0.75,
    referenceView: reference.view,
  };
}

/**
 * Build the per-view 3D observation cloud from MediaPipe landmarks.
 *
 * MediaPipe reports `x`/`y` normalised by the image width/height and a
 * relative depth `z` expressed in the same scale as `x` (negative towards the
 * camera). Converting to pixels and flipping the axes gives an orthographic
 * camera frame in which the projection of the cloud is exactly the observed
 * image positions - so the 2D evidence is used at full strength and the depth
 * channel contributes the out-of-plane information.
 */
export function buildViewObservation(
  view: PhotoView,
  landmarks: { x: number; y: number; z: number }[],
  imageWidth: number,
  imageHeight: number,
  maxPoints: number,
): ViewObservation {
  const count = Math.min(maxPoints, landmarks.length);
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const lm = landmarks[i];
    points[i * 3] = lm.x * imageWidth;
    points[i * 3 + 1] = -lm.y * imageHeight;
    points[i * 3 + 2] = -(lm.z ?? 0) * imageWidth;
  }
  return { view, points, pointCount: count };
}
