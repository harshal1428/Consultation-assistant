/**
 * Pre-processing for local face detection.
 *
 * The bundled MediaPipe detector works on a fixed internal tensor. Dark or
 * very small photographs therefore fall below what it can resolve, even when
 * the face is perfectly visible to a person. These helpers build a detection
 * copy of a photograph: upscaled to a usable size and exposure-normalised.
 *
 * The photograph itself is never modified; only the temporary detection
 * canvas is written to, and it is released with the frame.
 */

/**
 * Minimum size (px) the detection copy of a photograph is upscaled to before a
 * retry. The bundled detector works on a fixed-size internal tensor, so very
 * small photographs (a few hundred pixels) can fall below what it can resolve.
 */
export const DETECTION_MIN_SIZE = 512;
/** Upper bound for the detection upscale, to keep the retries cheap. */
export const DETECTION_MAX_UPSCALE = 3;

export interface AutoLevels {
  low: number;
  high: number;
}

/**
 * Percentile-based exposure window of an RGBA buffer.
 *
 * Dark photographs (underexposed, back-lit, indoor) lose the facial contrast
 * the detector relies on. Measuring the 2nd/98th luminance percentile gives a
 * stable window that can be stretched without clipping the subject.
 */
export function computeAutoLevels(data: Uint8ClampedArray): AutoLevels {
  const histogram = new Uint32Array(256);
  let count = 0;
  // Every fourth pixel is plenty for a histogram and keeps this cheap.
  for (let i = 0; i + 2 < data.length; i += 16) {
    const luma = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[Math.min(255, Math.max(0, luma))] += 1;
    count += 1;
  }
  if (count === 0) return { low: 0, high: 255 };

  const lowTarget = count * 0.02;
  const highTarget = count * 0.98;
  let low = 0;
  let high = 255;
  let acc = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += histogram[v];
    if (acc >= lowTarget) {
      low = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += histogram[v];
    if (acc >= highTarget) {
      high = v;
      break;
    }
  }
  // A photograph that is already well exposed needs no stretch.
  if (high - low < 24) return { low: 0, high: 255 };
  return { low, high };
}

/**
 * Build a detection copy of `image`: upscaled to at least `minSize` pixels and
 * exposure-normalised. Returns `null` outside a browser (no canvas).
 */
export function prepareDetectionCanvas(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  options: { minSize?: number; contrast?: number } = {},
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;

  const sourceWidth =
    "naturalWidth" in image && image.naturalWidth > 0 ? image.naturalWidth : image.width;
  const sourceHeight =
    "naturalHeight" in image && image.naturalHeight > 0 ? image.naturalHeight : image.height;
  if (!sourceWidth || !sourceHeight) return null;

  const minSize = options.minSize ?? DETECTION_MIN_SIZE;
  const contrast = options.contrast ?? 1;
  const scale = Math.min(
    DETECTION_MAX_UPSCALE,
    Math.max(1, minSize / Math.min(sourceWidth, sourceHeight)),
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let imageData: ImageData;
  try {
    imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }

  const { low, high } = computeAutoLevels(imageData.data);
  if (low > 0 || high < 255 || contrast !== 1) {
    const span = Math.max(1, high - low);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      for (let k = 0; k < 3; k += 1) {
        let value = ((data[i + k] - low) * 255) / span;
        value = (value - 128) * contrast + 128;
        data[i + k] = value < 0 ? 0 : value > 255 ? 255 : value;
      }
    }
    context.putImageData(imageData, 0, 0);
  }

  return canvas;
}
