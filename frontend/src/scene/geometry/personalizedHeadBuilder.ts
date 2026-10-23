import { createHeadGeometry, type HeadKind } from "./headMesh";
import {
  buildPersonalizedHeadModel,
  type PersonalizedHeadModel,
} from "./personalizedHead";
import type { CanonicalFaceModel } from "../../services/canonicalFaceModel";
import { HEAD_CANONICAL_ANCHORS } from "./headCanonicalAnchors";

/**
 * Build the personalized head baseline for a reconstructed canonical shape.
 *
 * The displacement field is defined against the *neutral* surface of the
 * selected head kind, so the neutral mesh is generated once here with exactly
 * the same tessellation the viewer uses. That guarantees the vertex order and
 * count match and the transfer lands on the intended vertices.
 */
export function buildPersonalizedHead(
  canonical: CanonicalFaceModel,
  shape: Float32Array,
  kind: HeadKind = "model",
): PersonalizedHeadModel {
  const geometry = createHeadGeometry(undefined, undefined, undefined, undefined, kind);
  const attribute = geometry.getAttribute("position");
  const positions = new Float32Array(attribute.array as ArrayLike<number>);
  geometry.dispose();
  return buildPersonalizedHeadModel(
    canonical,
    shape,
    positions,
    kind === "model" ? { anchors: HEAD_CANONICAL_ANCHORS as any } : {},
  );
}
