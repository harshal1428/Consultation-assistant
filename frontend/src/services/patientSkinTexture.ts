/**
 * Browser glue for the photo-derived skin texture.
 *
 * `faceTexture.ts` is a pure, testable sampler over typed arrays. This module
 * loads the patient photographs (in memory only - the object URLs are the ones
 * the photo controller already owns), resamples them to a modest working
 * resolution, and assembles the geometry/pose inputs for the sampler.
 *
 * Nothing here uploads, persists, or copies a photograph anywhere: the pixels
 * are read into a canvas, reduced to a texture, and the working canvases are
 * released when the function returns.
 */

import type { PatientPhoto, PhotoView } from "../lib/multiViewPhoto";
import type { MultiViewFitResult } from "./multiViewFitting";
import {
  buildFaceTextureData,
  cameraDirectionInAlignedFrame,
  type FaceTextureData,
  type TextureView,
} from "./faceTexture";
import { createHeadGeometry } from "../scene/geometry/headMesh";
import { invertSimilarity, type PersonalizedHeadModel } from "../scene/geometry/personalizedHead";

/** Longest edge of the working copy of a photograph. */
const WORKING_MAX_SIZE = 768;

/**
 * How much each view is preferred when several views see the same skin point.
 * The frontal view carries the most identity detail; profiles contribute the
 * sides and the depth silhouette.
 */
const VIEW_PRIORITY: Record<PhotoView, number> = {
  front: 1,
  "left-three-quarter": 0.8,
  "right-three-quarter": 0.8,
  "left-profile": 0.55,
  "right-profile": 0.55,
  additional: 0.45,
};

export interface PatientSkinTexture {
  /** The texture pixels ready to be wrapped in a CanvasTexture. */
  canvas: HTMLCanvasElement;
  /** Sampler statistics (coverage, per-view contributions, fallbacks). */
  data: FaceTextureData;
}

export interface BuildPatientSkinTextureOptions {
  photos: Map<PhotoView, PatientPhoto>;
  fit: MultiViewFitResult;
  model: PersonalizedHeadModel;
  /** Texture resolution; defaults to 1024 x 512. */
  width?: number;
  height?: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A patient photo could not be loaded for texturing."));
    image.src = url;
  });
}

/** Downscale a photograph into RGBA pixels at a manageable working size. */
function readWorkingPixels(
  image: HTMLImageElement,
): { width: number; height: number; data: Uint8ClampedArray } | null {
  if (typeof document === "undefined") return null;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return null;

  const scale = Math.min(1, WORKING_MAX_SIZE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  try {
    const imageData = context.getImageData(0, 0, width, height);
    return { width, height, data: imageData.data };
  } catch {
    return null;
  }
}

/**
 * Estimate the hair colour from the pixels just above the forehead landmark.
 * Three candidate points are sampled and the darkest one is used, which avoids
 * picking up a bright background.
 */
export function sampleHairColor(
  view: TextureView | undefined,
  photo: PatientPhoto | undefined,
): [number, number, number] | undefined {
  if (!view || !photo) return undefined;
  const forehead = photo.landmarks?.[10];
  if (!forehead) return undefined;

  const candidates: [number, number][] = [
    [forehead.x, forehead.y - 0.09],
    [forehead.x - 0.04, forehead.y - 0.07],
    [forehead.x + 0.04, forehead.y - 0.07],
  ];

  let best: [number, number, number] | undefined;
  let bestLuma = Infinity;

  for (const [cx, cy] of candidates) {
    const px = Math.round(cx * (view.width - 1));
    const py = Math.round(cy * (view.height - 1));
    if (px < 2 || py < 2 || px >= view.width - 2 || py >= view.height - 2) continue;

    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const i = ((py + dy) * view.width + (px + dx)) * 4;
        if (view.data[i + 3] < 8) continue;
        r += view.data[i];
        g += view.data[i + 1];
        b += view.data[i + 2];
        n += 1;
      }
    }
    if (n === 0) continue;
    r /= n;
    g /= n;
    b /= n;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    // Ignore candidates that are obviously background (very bright).
    if (luma > 210) continue;
    if (luma < bestLuma) {
      bestLuma = luma;
      best = [r, g, b];
    }
  }

  return best;
}

/**
 * Build the patient skin texture from the photographs that were actually used
 * by the reconstruction.
 */
export async function buildPatientSkinTexture(
  options: BuildPatientSkinTextureOptions,
): Promise<PatientSkinTexture> {
  const { photos, fit, model } = options;

  const views: TextureView[] = [];
  let frontView: TextureView | undefined;
  let frontPhoto: PatientPhoto | undefined;

  for (const stats of fit.perView) {
    const photo = photos.get(stats.view);
    if (!photo || !photo.validation.ok) continue;

    let image: HTMLImageElement;
    try {
      image = await loadImage(photo.previewUrl);
    } catch {
      continue;
    }
    const pixels = readWorkingPixels(image);
    if (!pixels) continue;

    const view: TextureView = {
      view: stats.view,
      width: pixels.width,
      height: pixels.height,
      data: pixels.data,
      transform: {
        rotation: stats.rotation,
        translation: stats.translation,
        scale: stats.scale,
      },
      priority: VIEW_PRIORITY[stats.view] ?? 0.4,
      direction: cameraDirectionInAlignedFrame(fit.alignment.rotation, stats.rotation),
    };
    views.push(view);
    if (stats.view === "front") {
      frontView = view;
      frontPhoto = photo;
    } else if (!frontView) {
      frontView = view;
      frontPhoto = photo;
    }
  }

  if (views.length === 0) {
    throw new Error("No usable photograph was available to texture the reconstructed face.");
  }

  // Geometry of the very same displaced mesh the simulation renders (realistic model).
  const geometry = createHeadGeometry(undefined, undefined, undefined, model, "model");
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  if (!index) throw new Error("Head geometry has no index buffer");
  const positions = new Float32Array(position.array as ArrayLike<number>);
  const normals = new Float32Array(normal.array as ArrayLike<number>);
  const uvs = new Float32Array(uv.array as ArrayLike<number>);
  const indices = new Uint16Array(index.array as ArrayLike<number>);
  geometry.dispose();

  const data = buildFaceTextureData({
    width: options.width,
    height: options.height,
    positions,
    normals,
    uvs,
    indices,
    correspondence: model.correspondence,
    coverage: model.coverage,
    canonicalToSceneRotation: model.alignment.rotation,
    inverseAlignment: invertSimilarity(fit.alignment),
    views,
    hairColor: sampleHairColor(frontView, frontPhoto),
    hairlineY: 0.4,
    backZ: -0.05,
  });

  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The skin texture could not be prepared on this device.");
  }
  const imageData = context.createImageData(data.width, data.height);
  imageData.data.set(data.data);
  context.putImageData(imageData, 0, 0);

  // Non-visual diagnostics: the canvas never enters the DOM, so these
  // attributes stay in memory and are used only by the browser runtime check.
  canvas.dataset.skinSource = "patient-photos";
  canvas.dataset.coverage = data.coverage.toFixed(4);
  canvas.dataset.texturedTexels = String(data.texturedTexels);
  canvas.dataset.totalTexels = String(data.totalTexels);
  canvas.dataset.views = Object.keys(data.viewContributions).join(",");

  return { canvas, data };
}
