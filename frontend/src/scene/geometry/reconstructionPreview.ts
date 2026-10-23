/**
 * Software projection of the reconstructed face for the review preview.
 *
 * The reconstruction preview has to be reviewable *before* the result is
 * applied to the simulation, so it must show the actual reconstructed mesh -
 * not a stock picture of a head. This module projects the reconstructed
 * canonical face patch through a simple orthographic camera and shades every
 * triangle with a Lambert term, which yields a truthful, deterministic image
 * that can also be asserted on in unit tests.
 *
 * Camera convention (the canonical model uses +X = patient's left, +Y =
 * superior, +Z = anterior):
 *
 *   - `yaw` is the azimuth of the observer around the head. 0 = straight in
 *     front of the face, +90 deg = the observer stands on the patient's left,
 *     -90 deg = on the patient's right.
 *   - the observer's right-hand screen axis is
 *     `right = (cos(yaw), 0, -sin(yaw))`,
 *   - the screen up axis is +Y,
 *   - the depth axis (towards the observer) is
 *     `(sin(yaw), 0, cos(yaw))`.
 */

export type PreviewCameraId =
  | "front"
  | "left"
  | "right"
  | "left-three-quarter"
  | "right-three-quarter";

export interface PreviewCamera {
  id: PreviewCameraId;
  label: string;
  /** Azimuth in degrees. */
  yaw: number;
}

export const PREVIEW_CAMERAS: PreviewCamera[] = [
  { id: "front", label: "Front", yaw: 0 },
  { id: "left", label: "Left profile", yaw: 90 },
  { id: "right", label: "Right profile", yaw: -90 },
  { id: "left-three-quarter", label: "Left ¾", yaw: 45 },
  { id: "right-three-quarter", label: "Right ¾", yaw: -45 },
];

export interface ProjectedTriangle {
  /** Screen coordinates in the unit square (0..1), y downwards. */
  points: [number, number][];
  /** Lambert shade in 0..1 (1 = fully lit). */
  shade: number;
  /** Mean depth towards the observer (larger = closer). */
  depth: number;
}

export interface ProjectedMarker {
  label: string;
  x: number;
  y: number;
  depth: number;
}

export interface ProjectedMesh {
  triangles: ProjectedTriangle[];
  markers: ProjectedMarker[];
  /** Screen-space bounding box in the unit square. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

/** Anatomical points that are useful to check during review. */
const MARKERS: { label: string; index: number }[] = [
  { label: "Nose tip", index: 4 },
  { label: "Nasion", index: 168 },
  { label: "Chin", index: 152 },
  { label: "Mouth", index: 13 },
  { label: "Left eye", index: 263 },
  { label: "Right eye", index: 33 },
];

function yawOf(camera: PreviewCameraId): number {
  const found = PREVIEW_CAMERAS.find((c) => c.id === camera);
  return found ? found.yaw : 0;
}

/**
 * Project a canonical-space triangle soup through an orthographic camera.
 *
 * @param shape Reconstructed positions (3 floats per vertex, canonical units).
 * @param indices Triangle indices.
 * @param camera Camera preset.
 */
export function projectCanonicalMesh(
  shape: Float32Array,
  indices: Uint32Array,
  camera: PreviewCameraId,
): ProjectedMesh {
  const yaw = (yawOf(camera) * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);

  // Screen axes.
  const rx = cy;
  const rz = -sy;
  // Depth axis (towards the observer).
  const dx = sy;
  const dz = cy;

  const project = (positions: Float32Array, i: number): [number, number, number] => {
    const o = i * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    return [rx * x + rz * z, y, dx * x + dz * z];
  };

  // Collect the projected bounds first so the result can be normalised into
  // the unit square regardless of the reconstruction scale.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const vertexCount = Math.floor(shape.length / 3);
  for (let i = 0; i < vertexCount; i += 1) {
    const [sx, syy] = project(shape, i);
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (syy < minY) minY = syy;
    if (syy > maxY) maxY = syy;
  }
  if (!Number.isFinite(minX)) {
    return {
      triangles: [],
      markers: [],
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    };
  }

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const span = Math.max(spanX, spanY) || 1;
  // Centre the projection inside the unit square.
  const offsetX = (span - spanX) / 2;
  const offsetY = (span - spanY) / 2;

  const toScreen = (sx: number, syy: number): [number, number] => [
    (sx - minX + offsetX) / span,
    1 - (syy - minY + offsetY) / span,
  ];

  // Light direction: from the observer, slightly above and to the left.
  const light = normalise([dx * 0.7 + rx * 0.45 + 0.45, 0.55, dz * 0.7 + rz * 0.45]);

  const triangles: ProjectedTriangle[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;

    const pa = project(shape, a);
    const pb = project(shape, b);
    const pc = project(shape, c);

    // Face normal in world space (canonical frame).
    const e1: [number, number, number] = [
      shape[b * 3] - shape[a * 3],
      shape[b * 3 + 1] - shape[a * 3 + 1],
      shape[b * 3 + 2] - shape[a * 3 + 2],
    ];
    const e2: [number, number, number] = [
      shape[c * 3] - shape[a * 3],
      shape[c * 3 + 1] - shape[a * 3 + 1],
      shape[c * 3 + 2] - shape[a * 3 + 2],
    ];
    const normal = normalise([
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ]);

    const lambert = Math.max(0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]);
    // Two-sided shading: the open rim of the face patch must not disappear.
    const facing = Math.abs(lambert);
    const shade = 0.28 + 0.72 * facing;

    const sa = toScreen(pa[0], pa[1]);
    const sb = toScreen(pb[0], pb[1]);
    const sc = toScreen(pc[0], pc[1]);

    triangles.push({
      points: [sa, sb, sc],
      shade,
      depth: (pa[2] + pb[2] + pc[2]) / 3,
    });
  }

  // Painter's algorithm: draw the far triangles first.
  triangles.sort((t1, t2) => t1.depth - t2.depth);

  const markers: ProjectedMarker[] = [];
  for (const marker of MARKERS) {
    if (marker.index >= vertexCount) continue;
    const [sx, syy, depth] = project(shape, marker.index);
    const [px, py] = toScreen(sx, syy);
    markers.push({ label: marker.label, x: px, y: py, depth });
  }

  return {
    triangles,
    markers,
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
  };
}

/**
 * Project the template (canonical) silhouette so the reconstruction can be
 * compared against the neutral reference.
 */
export function projectTemplateSilhouette(
  template: Float32Array,
  shape: Float32Array,
  camera: PreviewCameraId,
): [number, number][] {
  const yaw = (yawOf(camera) * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const rx = cy;
  const rz = -sy;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const count = Math.floor(shape.length / 3);
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const sx = rx * template[o] + rz * template[o + 2];
    const syy = template[o + 1];
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (syy < minY) minY = syy;
    if (syy > maxY) maxY = syy;
  }
  if (!Number.isFinite(minX)) return [];

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const span = Math.max(spanX, spanY) || 1;
  const offsetX = (span - spanX) / 2;
  const offsetY = (span - spanY) / 2;

  const points: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const sx = rx * template[o] + rz * template[o + 2];
    const syy = template[o + 1];
    points.push([
      (sx - minX + offsetX) / span,
      1 - (syy - minY + offsetY) / span,
    ]);
  }
  return points;
}

function normalise(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
