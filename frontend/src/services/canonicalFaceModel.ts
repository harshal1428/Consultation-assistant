/**
 * Canonical face model asset (MediaPipe Face Geometry).
 *
 * This is a *real, shipped* 3D asset — not a synthetic placeholder. It is the
 * `canonical_face_model.obj` file distributed with the Apache-2.0 licensed
 * MediaPipe project (`mediapipe/modules/face_geometry/data`). It provides:
 *
 *   - 468 vertices that correspond 1:1 to MediaPipe Face Landmarker landmark
 *     indices 0..467 (the ten extra iris landmarks 468..477 have no mesh
 *     counterpart),
 *   - 898 triangles with consistent winding, and
 *   - one UV coordinate per vertex.
 *
 * The model is used as the *template* of the multi-view fit: it supplies the
 * mesh topology, the per-vertex regularisation neighbourhood (so the fitted
 * shape stays smooth) and the anatomical correspondence used to place the
 * reconstructed face on the simulation head.
 *
 * The file is served from this origin at `/models/canonical_face_model.obj` so
 * nothing is fetched from a third party at runtime.
 */

export const CANONICAL_FACE_MODEL_URL = "/models/canonical_face_model.obj";

/** Number of mesh vertices (MediaPipe face-mesh topology). */
export const CANONICAL_VERTEX_COUNT = 468;

export interface CanonicalFaceModel {
  /** Flat [x, y, z] per vertex, in centimetres, +Z anterior, +Y superior. */
  positions: Float32Array;
  /** Flat [u, v] per vertex. */
  uvs: Float32Array;
  /** Triangle indices. */
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  /** Adjacency: neighbour vertex indices per vertex (mesh edges). */
  neighbours: Uint32Array[];
  /** Per-vertex distance (cm) to the open boundary of the face patch. */
  boundaryDistance: Float32Array;
  metadata: {
    source: string;
    license: string;
    origin: string;
  };
}

/**
 * Semantic anchors used to place the canonical model on the simulation head.
 *
 * The indices are MediaPipe Face Mesh landmark indices; the positions were
 * verified against the shipped OBJ (nose tip is the most anterior vertex,
 * index 152 is the lowest midline vertex, 33/263 are the symmetric outer eye
 * corners, and so on).
 */
export interface CanonicalAnchor {
  id: string;
  index: number;
}

export const CANONICAL_ANCHORS: CanonicalAnchor[] = [
  { id: "pronasale", index: 4 }, // nose tip - most anterior point
  { id: "subnasale", index: 2 }, // base of the nose / columella
  { id: "nasion", index: 168 }, // bridge of the nose between the eyes
  { id: "rhinion", index: 195 }, // mid dorsum
  { id: "glabella", index: 9 },
  { id: "menton", index: 152 }, // lowest midline point (chin base)
  { id: "pogonion", index: 175 }, // chin prominence
  { id: "upper_lip", index: 0 }, // vermilion top, midline
  { id: "lower_lip", index: 17 }, // vermilion bottom, midline
  { id: "stomion", index: 13 },
  { id: "eye_outer_l", index: 263 }, // +X side of the canonical model
  { id: "eye_inner_l", index: 362 },
  { id: "eye_outer_r", index: 33 },
  { id: "eye_inner_r", index: 133 },
  { id: "alar_l", index: 425 },
  { id: "alar_r", index: 205 },
  { id: "mouth_corner_l", index: 291 },
  { id: "mouth_corner_r", index: 61 },
  { id: "forehead_top", index: 10 },
  { id: "temple_l", index: 356 },
  { id: "temple_r", index: 127 },
];

/**
 * Parse a Wavefront OBJ containing a single mesh.
 *
 * Only the subset needed by the canonical face model is understood: `v`, `vt`
 * and `f` (with `v/vt` and `v//vn` index syntax).
 */
export function parseCanonicalFaceModel(text: string): CanonicalFaceModel {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const parts = line.split(/\s+/);
      positions.push(+parts[1], +parts[2], +parts[3]);
    } else if (line.startsWith("vt ")) {
      const parts = line.split(/\s+/);
      uvs.push(+parts[1], +parts[2]);
    } else if (line.startsWith("f ")) {
      const parts = line.slice(2).trim().split(/\s+/);
      const face = parts.map((token) => {
        const vertexToken = token.split("/")[0];
        return parseInt(vertexToken, 10) - 1;
      });
      if (face.length === 3) {
        indices.push(face[0], face[1], face[2]);
      } else if (face.length === 4) {
        // Split quads into two triangles.
        indices.push(face[0], face[1], face[2], face[0], face[2], face[3]);
      }
    }
  }

  if (positions.length === 0) {
    throw new Error("The canonical face model file is empty or malformed.");
  }

  const vertexCount = positions.length / 3;
  const positionArray = new Float32Array(positions);
  const uvArray = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i += 1) {
    uvArray[i * 2] = uvs[i * 2] ?? 0;
    uvArray[i * 2 + 1] = uvs[i * 2 + 1] ?? 0;
  }
  const indexArray = new Uint32Array(indices);

  const { neighbours, boundaryDistance } = buildTopology(indexArray, vertexCount);

  return {
    positions: positionArray,
    uvs: uvArray,
    indices: indexArray,
    vertexCount,
    triangleCount: indexArray.length / 3,
    neighbours,
    boundaryDistance,
    metadata: {
      source: "MediaPipe canonical face model",
      license: "Apache-2.0 (MediaPipe)",
      origin: CANONICAL_FACE_MODEL_URL,
    },
  };
}

/** Edge adjacency plus the distance of every vertex to the open patch rim. */
function buildTopology(
  indices: Uint32Array,
  vertexCount: number,
): { neighbours: Uint32Array[]; boundaryDistance: Float32Array } {
  const edgeCounts = new Map<string, number>();
  const neighbourSets: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>());

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      neighbourSets[p].add(q);
      neighbourSets[q].add(p);
      const key = p < q ? `${p}_${q}` : `${q}_${p}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  const boundary = new Set<number>();
  for (const [key, count] of edgeCounts) {
    if (count === 1) {
      const [p, q] = key.split("_").map(Number);
      boundary.add(p);
      boundary.add(q);
    }
  }

  // Multi-source BFS over the mesh graph: geodesic-ish distance to the rim.
  const distance = new Float32Array(vertexCount).fill(Infinity);
  const queue: number[] = [];
  for (const index of boundary) {
    distance[index] = 0;
    queue.push(index);
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    for (const next of neighbourSets[current]) {
      if (distance[next] > distance[current] + 1) {
        distance[next] = distance[current] + 1;
        queue.push(next);
      }
    }
  }
  for (let i = 0; i < vertexCount; i += 1) {
    if (!Number.isFinite(distance[i])) distance[i] = 0;
  }

  return {
    neighbours: neighbourSets.map((set) => Uint32Array.from(set)),
    boundaryDistance: distance,
  };
}

let cached: Promise<CanonicalFaceModel> | null = null;

/** Fetch + parse the canonical model once and cache the result. */
export function loadCanonicalFaceModel(
  url: string = CANONICAL_FACE_MODEL_URL,
  fetcher: typeof fetch = fetch,
): Promise<CanonicalFaceModel> {
  if (!cached) {
    cached = fetcher(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `The canonical face model could not be loaded (${response.status}). ` +
              `Ensure ${url} is present in the public folder.`,
          );
        }
        return response.text();
      })
      .then((text) => parseCanonicalFaceModel(text))
      .catch((error) => {
        cached = null;
        throw error;
      });
  }
  return cached;
}

/** Test hook: forget the cached model. */
export function resetCanonicalFaceModel(): void {
  cached = null;
}
