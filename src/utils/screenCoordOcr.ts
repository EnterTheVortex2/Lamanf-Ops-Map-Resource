import { createWorker, type Worker } from "tesseract.js";

export type ScanRegionPreset =
  | "bottom-right"
  | "top-center"
  | "bottom-wide"
  | "custom";

export interface CropRectPct {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export const SCAN_PRESETS: Record<
  Exclude<ScanRegionPreset, "custom">,
  { label: string; hint: string; rect: CropRectPct }
> = {
  "bottom-right": {
    label: "Map Bottom-Right (M)",
    hint: "Reads grid coordinates shown at bottom-right when opening map (M)",
    rect: { xPct: 68, yPct: 74, wPct: 30, hPct: 23 },
  },
  "top-center": {
    label: "Top HUD Strip",
    hint: "Scans top-center bar if coordinates/bearing are displayed near compass",
    rect: { xPct: 30, yPct: 0, wPct: 40, hPct: 16 },
  },
  "bottom-wide": {
    label: "Lower Corner Wide",
    hint: "Wider bottom-right capture box for non-standard aspect ratios",
    rect: { xPct: 56, yPct: 66, wPct: 43, hPct: 32 },
  },
};

export interface OcrCoordinateMatch {
  grid: string;
  x: number;
  y: number;
  rawText: string;
}

let ocrWorkerPromise: Promise<Worker> | null = null;

async function getCoordOcrWorker(): Promise<Worker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const worker = await createWorker("eng");
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789,./:- XYGridgrid",
      });
      return worker;
    })();
  }
  return ocrWorkerPromise;
}

export async function terminateCoordOcrWorker(): Promise<void> {
  if (!ocrWorkerPromise) return;
  const pending = ocrWorkerPromise;
  ocrWorkerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Extracts Lamang Island 3-digit grid coordinate pairs (X: 100..239, Y: 100..179)
 * from noisy OCR output and converts them to EPSG:3857 meters (center of 100m square).
 */
export function extractLamangCoordsFromOcrText(
  rawText: string
): OcrCoordinateMatch | null {
  const cleaned = rawText
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  // Prefer explicit pair separators first, e.g. "174 142", "174, 142", "174 / 142", "X:174 Y:142"
  const pairRegex =
    /(?:^|[^\d])(1[0-9]{2}|2[0-3][0-9])\s*(?:[,/|:;\-.\s]+|[XxYy\s:]+)\s*(1[0-7][0-9])(?:$|[^\d])/g;

  const matches = Array.from(cleaned.matchAll(pairRegex));
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const gx = Number(matches[i][1]);
    const gy = Number(matches[i][2]);
    if (gx >= 100 && gx <= 239 && gy >= 100 && gy <= 179) {
      return {
        grid: `${gx} ${gy}`,
        x: (gx - 100) * 100 + 50,
        y: (gy - 100) * 100 + 50,
        rawText: cleaned,
      };
    }
  }

  return null;
}

/**
 * Crops the target rectangle from a playing <video> frame onto a canvas,
 * upscales and high-contrast binarizes HUD digits (light text on dark map/UI -> dark on white)
 * for rapid local OCR. Zero data leaves the browser.
 */
export async function scanVideoFrameForLamangCoords(
  video: HTMLVideoElement,
  rect: CropRectPct,
  previewCanvas?: HTMLCanvasElement | null
): Promise<{
  match: OcrCoordinateMatch | null;
  rawText: string;
}> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    return { match: null, rawText: "" };
  }

  const sx = Math.max(0, Math.round((rect.xPct / 100) * vw));
  const sy = Math.max(0, Math.round((rect.yPct / 100) * vh));
  const sw = Math.max(40, Math.min(vw - sx, Math.round((rect.wPct / 100) * vw)));
  const sh = Math.max(30, Math.min(vh - sy, Math.round((rect.hPct / 100) * vh)));

  // Draw small preview thumbnail into user's Screen Sync popover if visible
  if (previewCanvas) {
    const pCtx = previewCanvas.getContext("2d");
    if (pCtx) {
      previewCanvas.width = 280;
      previewCanvas.height = Math.max(68, Math.round((sh / sw) * 280));
      pCtx.drawImage(
        video,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        previewCanvas.width,
        previewCanvas.height
      );
    }
  }

  // Upscale 2.2x onto offscreen canvas for crisp Tesseract digit segmentation
  const scale = sw < 520 ? 2.2 : 1.5;
  const workCanvas = document.createElement("canvas");
  workCanvas.width = Math.round(sw * scale);
  workCanvas.height = Math.round(sh * scale);
  const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { match: null, rawText: "" };

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    video,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    workCanvas.width,
    workCanvas.height
  );

  // Convert bright HUD digits on dark backdrop -> black text on clean white background
  const imgData = ctx.getImageData(0, 0, workCanvas.width, workCanvas.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = lum > 138 ? 0 : 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);

  const worker = await getCoordOcrWorker();
  const res = await worker.recognize(workCanvas);
  const rawText = (res?.data?.text || "").trim();
  const match = extractLamangCoordsFromOcrText(rawText);

  return { match, rawText };
}
