import * as THREE from "three";
import { shapeInto } from "./headShape";
import type { FaceMorph } from "./faceMorph";
import { isNeutralMorph, morphPoint } from "./faceMorph";
import {
  applyPersonalizedDisplacement,
  type PersonalizedHeadModel,
} from "./personalizedHead";
import { computeSmoothNormals, getHeadAssetBuffers } from "./headAsset";

export type HeadKind = "sculpted" | "model";

/**
 * Tessellation of the generated head. Chosen so the nose/alar region has enough
 * vertices for smooth local deformation while staying light enough for an
 * interactive browser scene (~25k vertices).
 */
export const HEAD_MESH_SEGMENTS = { x: 192, y: 128 } as const;

/**
 * Build the immutable baseline head geometry.
 *
 * The default is the realistic, user-supplied head model. The sculpted sphere
 * remains available for the original geometry tests and any code that needs the
 * parametric shape. The deformable shell is the baseline; deformation never
 * mutates it.
 *
 * Two ways of personalising the baseline are supported and are mutually
 * exclusive:
 *
 *   - `morph`: the legacy proportional fit (16 bounded coefficients), applied
 *     to the generated surface;
 *   - `personalized`: the multi-photo reconstruction, applied as a
 *     per-vertex displacement field derived from the reconstructed canonical
 *     face. The field is computed against the *neutral* surface, so the morph
 *     must not also be applied - that would apply the identity twice.
 */
export function createHeadGeometry(
  segX: number = HEAD_MESH_SEGMENTS.x,
  segY: number = HEAD_MESH_SEGMENTS.y,
  morph?: FaceMorph,
  personalized?: PersonalizedHeadModel | null,
  kind: HeadKind = "model",
): THREE.BufferGeometry {
  if (kind === "model") {
    return createModelHeadGeometry(morph, personalized);
  }
  return createSculptedHeadGeometry(segX, segY, morph, personalized);
}

function createModelHeadGeometry(
  morph?: FaceMorph,
  personalized?: PersonalizedHeadModel | null,
): THREE.BufferGeometry {
  const asset = getHeadAssetBuffers();
  const geometry = new THREE.BufferGeometry();
  // The baseline must never be mutated by the renderer or by the deformation
  // pass; copy the positions out of the shared asset buffer.
  const base = new Float32Array(asset.positions);
  let positionArray = base;

  // The legacy morph operates in the sculpted head's coordinate frame; the
  // realistic model is not addressed by it. If one is passed (and there is no
  // multi-photo personalization) ignore it to keep the API compatible without
  // distorting the anatomical head.
  const useMorph = morph ? !isNeutralMorph(morph) : false;
  const hasPersonalized = Boolean(
    personalized && personalized.vertexCount * 3 === base.length,
  );

  if (useMorph && morph && !hasPersonalized) {
    for (let i = 0; i < base.length; i += 3) {
      const out: [number, number, number] = [0, 0, 0];
      morphPoint(base[i], base[i + 1], base[i + 2], morph, out);
      base[i] = out[0];
      base[i + 1] = out[1];
      base[i + 2] = out[2];
    }
  }

  if (hasPersonalized && personalized) {
    positionArray = applyPersonalizedDisplacement(base, personalized);
  }

  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positionArray), 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.BufferAttribute(new Float32Array(asset.uvs), 2),
  );
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(asset.indices), 1));
  const normals = computeSmoothNormals(
    geometry.getAttribute("position").array as Float32Array,
    asset.indices,
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createSculptedHeadGeometry(
  segX: number = HEAD_MESH_SEGMENTS.x,
  segY: number = HEAD_MESH_SEGMENTS.y,
  morph?: FaceMorph,
  personalized?: PersonalizedHeadModel | null,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, segX, segY);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const out: number[] = [0, 0, 0];
  const useMorph = morph ? !isNeutralMorph(morph) : false;
  const hasPersonalized = Boolean(
    personalized && personalized.vertexCount * 3 === position.count * 3,
  );

  for (let i = 0; i < position.count; i += 1) {
    let dx = position.getX(i);
    let dy = position.getY(i);
    let dz = position.getZ(i);
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    shapeInto(dx, dy, dz, out);
    if (useMorph && morph && !hasPersonalized) {
      morphPoint(out[0], out[1], out[2], morph, out);
    }
    position.setXYZ(i, out[0], out[1], out[2]);
  }

  if (hasPersonalized && personalized) {
    const neutral = new Float32Array(position.array as ArrayLike<number>);
    const displaced = applyPersonalizedDisplacement(neutral, personalized);
    position.array.set(displaced);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export { getHeadAssetBuffers, computeSmoothNormals } from "./headAsset";
export * from "./headAsset";
export * from "./headCanonicalAnchors";
