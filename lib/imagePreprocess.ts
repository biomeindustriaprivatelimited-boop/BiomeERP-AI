// Canvas-based preprocessing that mirrors the levers OCR literature calls
// out as the highest-impact ones before handing an image to Tesseract:
// upscaling small/low-DPI images, grayscale conversion, global contrast
// stretching, and (optionally, for rough photo scans) Otsu binarization.

export interface PreprocessOptions {
  grayscale: boolean;
  enhanceContrast: boolean;
  binarize: boolean;
  upscale: boolean;
}

export const DEFAULT_PREPROCESS: PreprocessOptions = {
  grayscale: true,
  enhanceContrast: true,
  binarize: false,
  upscale: true,
};

export async function preprocessImage(
  source: File | Blob | string,
  opts: PreprocessOptions = DEFAULT_PREPROCESS
): Promise<{ canvas: HTMLCanvasElement; dataUrl: string }> {
  const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
  const bitmap = await createImageBitmap(blob);

  let scale = 1;
  if (opts.upscale) {
    const maxDim = Math.max(bitmap.width, bitmap.height);
    if (maxDim < 1500) scale = Math.min(3, 1500 / maxDim);
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  if (opts.grayscale || opts.enhanceContrast || opts.binarize) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;
    const gray = new Uint8ClampedArray(data.length / 4);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    let out = gray;
    if (opts.enhanceContrast) {
      let min = 255;
      let max = 0;
      for (let p = 0; p < gray.length; p++) {
        if (gray[p] < min) min = gray[p];
        if (gray[p] > max) max = gray[p];
      }
      const range = Math.max(1, max - min);
      const stretched = new Uint8ClampedArray(gray.length);
      for (let p = 0; p < gray.length; p++) {
        stretched[p] = ((gray[p] - min) / range) * 255;
      }
      out = stretched;
    }

    if (opts.binarize) {
      const threshold = otsuThreshold(out);
      const binary = new Uint8ClampedArray(out.length);
      for (let p = 0; p < out.length; p++) {
        binary[p] = out[p] >= threshold ? 255 : 0;
      }
      out = binary;
    }

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      data[i] = data[i + 1] = data[i + 2] = out[p];
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return { canvas, dataUrl: canvas.toDataURL("image/png") };
}

/** Standard Otsu's method — finds the threshold that best splits an image
 *  into foreground/background by minimizing intra-class variance. */
function otsuThreshold(gray: Uint8ClampedArray): number {
  const histogram = new Array(256).fill(0);
  for (const v of gray) histogram[v]++;

  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 127;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return threshold;
}
