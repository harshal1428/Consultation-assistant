import { surfacePoint } from "./headShape";
import type { CanonicalFaceModel } from "../../services/canonicalFaceModel";
import {
  fitSimilarity,
  type SimilarityTransform,
} from "../../services/multiViewFitting";
import { HEAD_ASSET_ANCHORS } from "./headAssetData.generated";
import type { CanonicalSceneAnchor } from "./personalizedHead";

type AnchorPosition = { x: number; y: number; z: number };

function sceneAnchor(id: keyof typeof HEAD_ASSET_ANCHORS, mediaPipeIndex: number, weight: number): CanonicalSceneAnchor & { position: [number, number, number] } {
  const a = HEAD_ASSET_ANCHORS[id];
  return {
    id,
    index: mediaPipeIndex,
    x: 0,
    y: 0,
    weight,
    position: [a[0], a[1], a[2]],
  };
}

/**
 * Anatomical anchors for the realistic head model.
 *
 * The media-pipe landmark indices are the same ones used by the canonical face
 * model; the scene positions are the actual landmarks on the user-supplied
 * mesh. Using explicit positions bypasses the procedural surface approximation
 * and gives a tight fit for identity transfer and texture projection.
 */
export const HEAD_CANONICAL_ANCHORS: (CanonicalSceneAnchor & { position: [number, number, number] })[] = [
  { ...sceneAnchor("nasion", 168, 1), id: "nasion" },
  { ...sceneAnchor("rhinion", 195, 1), id: "rhinion" },
  { ...sceneAnchor("pronasale", 4, 1), id: "pronasale" },
  { ...sceneAnchor("subnasale", 2, 1), id: "subnasale" },
  { ...sceneAnchor("upper_lip", 0, 1), id: "upper_lip" },
  { ...sceneAnchor("lower_lip", 17, 1), id: "lower_lip" },
  { ...sceneAnchor("pogonion", 175, 1), id: "pogonion" },
  { ...sceneAnchor("menton", 152, 1), id: "menton" },
  { ...sceneAnchor("alar_l", 425, 0.9), id: "alar_l" },
  { ...sceneAnchor("alar_r", 205, 0.9), id: "alar_r" },
  { ...sceneAnchor("eye_outer_l", 263, 0.85), id: "eye_outer_l" },
  { ...sceneAnchor("eye_outer_r", 33, 0.85), id: "eye_outer_r" },
] as any;
