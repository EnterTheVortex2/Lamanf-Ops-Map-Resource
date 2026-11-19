import { createWorker, type Worker } from "tesseract.js";

export type ScanRegionPreset =
  | "full-map"
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
  "full-map": {
    label: "Full Screen · Green Arrow + Grid Rulers (Recommended)",
    hint: "Finds your bright green player arrow anywhere on the map and calibrates against the left & bottom grid rulers at any zoom.",
    rect: { xPct: 0, yPct: 0, wPct: 100, hPct: 100 },
  },
  "bottom-right": {
    label: "Legacy · Corner Coords (Bottom-Right)",
    hint: "Legacy OCR box for bottom-right numeric coordinate readouts only.",
    rect: { xPct: 68, yPct: 74, wPct: 30, hPct: 23 },
  },
  "top-center": {
    label: "Top HUD Compass Strip",
    hint: "Reads N / NE / E / SE / S / SW / W / NW compass facing from the top-center HUD while walking.",
    rect: { xPct: 40, yPct: 0, wPct: 20, hPct: 8 },
  },
  "bottom-wide": {
    label: "Legacy · Lower Corner Wide",
    hint: "Wider bottom-right capture box for non-standard aspect ratios.",
    rect: { xPct: 56, yPct: 66, wPct: 43, hPct: 32 },
  },
};

export interface OcrCoordinateMatch {
  grid: string;
  x: number;
  y: number;
  rawText: string;
  headingDeg?: number;
  compassLabel?: string;
  arrowDetected?: boolean;
  mapOpenDetected?: boolean;
  xTicksCount?: number;
  yTicksCount?: number;
}

export interface AxisTick {
  value: number; // Grid units (e.g. 134, 170, or 120 when zoomed out "12")
  px: number; // Screen pixel coordinate along that axis
  raw: string;
}

export interface AxisFit {
  slope: number; // px per 1 grid unit (+ for X, - for Y)
  intercept: number; // px at grid value 0
  inliers: number;
  ticks: AxisTick[];
}

export interface GreenArrowDetection {
  cx: number;
  cy: number;
  pixelCount: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  headingDeg?: number;
}

const COMPASS_BEARINGS: Record<string, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

export function headingToCompass8(deg: number): string {
  const norm = ((deg % 360) + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(norm / 45) % 8];
}

let ocrWorkerPromise: Promise<Worker> | null = null;
let lastWorkerKey = "";

async function getCoordOcrWorker(
  whitelist = "0123456789 ",
  psm = "3"
): Promise<Worker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker("eng");
  }
  const worker = await ocrWorkerPromise;
  const key = `${whitelist}::${psm}`;
  if (lastWorkerKey !== key) {
    await worker.setParameters({
      tessedit_char_whitelist: whitelist,
      tessedit_pageseg_mode: psm as never,
    });
    lastWorkerKey = key;
  }
  return worker;
}

export async function terminateCoordOcrWorker(): Promise<void> {
  if (!ocrWorkerPromise) return;
  const pending = ocrWorkerPromise;
  ocrWorkerPromise = null;
  lastWorkerKey = "";
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Extracts Lamang Island 3-digit grid coordinate pairs (X: 100..239, Y: 100..179)
 * from legacy corner OCR text and converts them to EPSG:3857 meters.
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
 * Finds the bright lime-green player arrow anywhere across the map canvas,
 * rejecting teal COP circles (higher blue channel) and dark green vegetation.
 */
export function detectGreenPlayerArrow(
  imgData: ImageData,
  vw: number,
  vh: number
): GreenArrowDetection | null {
  const data = imgData.data;
  const xMin = Math.floor(vw * 0.025);
  const xMax = Math.floor(vw * 0.985);
  const yMin = Math.floor(vh * 0.11);
  const yMax = Math.floor(vh * 0.945);

  const cellSize = Math.max(18, Math.round(vw * 0.01));
  const bins = new Map<
    string,
    { bx: number; by: number; pts: [number, number][] }
  >();

  for (let y = yMin; y < yMax; y += 1) {
    const rowOffset = y * vw;
    for (let x = xMin; x < xMax; x += 1) {
      const idx = (rowOffset + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Player arrow is vivid lime green (e.g. rgb(14, 202, 64)), whereas COP markers are teal (b ~ 125-140)
      if (g >= 138 && g - r >= 62 && g - b >= 85) {
        const bx = Math.floor(x / cellSize);
        const by = Math.floor(y / cellSize);
        const key = `${bx},${by}`;
        let entry = bins.get(key);
        if (!entry) {
          entry = { bx, by, pts: [] };
          bins.set(key, entry);
        }
        entry.pts.push([x, y]);
      }
    }
  }

  if (bins.size === 0) return null;

  // Merge neighboring 3x3 cells so arrows straddling cell boundaries stay intact
  const visited = new Set<string>();
  const blobs: [number, number][][] = [];

  for (const key of bins.keys()) {
    if (visited.has(key)) continue;
    const queue = [key];
    visited.add(key);
    const merged: [number, number][] = [];

    while (queue.length > 0) {
      const curKey = queue.pop()!;
      const cur = bins.get(curKey);
      if (!cur) continue;
      merged.push(...cur.pts);

      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (dx === 0 && dy === 0) continue;
          const nbKey = `${cur.bx + dx},${cur.by + dy}`;
          if (bins.has(nbKey) && !visited.has(nbKey)) {
            visited.add(nbKey);
            queue.push(nbKey);
          }
        }
      }
    }
    blobs.push(merged);
  }

  const minPixels = Math.max(14, Math.round((vw * vh) / 150000));
  const maxSpan = Math.max(48, Math.round(vw * 0.045));

  let best: GreenArrowDetection | null = null;
  let bestScore = -1;

  for (const pts of blobs) {
    if (pts.length < minPixels) continue;

    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let sumX = 0;
    let sumY = 0;
    let sumGMinusB = 0;

    for (const [x, y] of pts) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      sumX += x;
      sumY += y;
      const idx = (y * vw + x) * 4;
      sumGMinusB += data[idx + 1] - data[idx + 2];
    }

    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (bw > maxSpan || bh > maxSpan) continue;

    const fill = pts.length / Math.max(1, bw * bh);
    if (fill < 0.16) continue;

    const avgGMinusB = sumGMinusB / pts.length;
    if (avgGMinusB < 92) continue;

    const cx = sumX / pts.length;
    const cy = sumY / pts.length;

    // Score prefers vivid lime-green solid triangle blobs
    const score = pts.length * (avgGMinusB / 100);
    if (score > bestScore) {
      bestScore = score;

      // Estimate facing angle from farthest vertex (sharp nose of chevron points furthest from centroid)
      const withDist = pts
        .map(([x, y]) => ({
          x,
          y,
          d2: (x - cx) * (x - cx) + (y - cy) * (y - cy),
        }))
        .sort((a, b) => b.d2 - a.d2);

      const tipCount = Math.max(2, Math.min(8, Math.ceil(withDist.length * 0.06)));
      let tipX = 0;
      let tipY = 0;
      for (let i = 0; i < tipCount; i += 1) {
        tipX += withDist[i].x;
        tipY += withDist[i].y;
      }
      tipX /= tipCount;
      tipY /= tipCount;

      const dx = tipX - cx;
      const dy = tipY - cy;
      let headingDeg: number | undefined;
      if (Math.hypot(dx, dy) >= 2.2) {
        headingDeg = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360);
      }

      best = {
        cx,
        cy,
        pixelCount: pts.length,
        bbox: { x0, y0, x1, y1 },
        headingDeg,
      };
    }
  }

  return best;
}

interface WordBox {
  text: string;
  cx: number;
  cy: number;
}

function extractWordBoxesFromTesseract(
  res: unknown,
  originX: number,
  originY: number,
  scale: number
): WordBox[] {
  const out: WordBox[] = [];
  const data = (res as {
    data?: {
      blocks?: {
        paragraphs?: {
          lines?: {
            words?: {
              text?: string;
              bbox?: { x0: number; y0: number; x1: number; y1: number };
            }[];
          }[];
        }[];
      }[];
    };
  })?.data;

  for (const blk of data?.blocks || []) {
    for (const para of blk.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const w of line.words || []) {
          const text = (w.text || "").trim();
          const b = w.bbox;
          if (!text || !b) continue;
          out.push({
            text,
            cx: originX + (b.x0 + b.x1) / (2 * scale),
            cy: originY + (b.y0 + b.y1) / (2 * scale),
          });
        }
      }
    }
  }
  return out;
}

function parseAxisTicks(
  words: WordBox[],
  axis: "x" | "y"
): AxisTick[] {
  const maxVal = axis === "x" ? 240 : 180;
  const maxTwoDigit = axis === "x" ? 24 : 18;

  const threeDigit: AxisTick[] = [];
  const twoDigit: AxisTick[] = [];

  for (const w of words) {
    const clean = w.text.replace(/[^\d]/g, "");
    if (!clean) continue;
    const n = Number(clean);
    const px = axis === "x" ? w.cx : w.cy;

    if (clean.length === 3 && n >= 100 && n <= maxVal) {
      threeDigit.push({ value: n, px, raw: clean });
    } else if (clean.length === 2 && n >= 10 && n <= maxTwoDigit) {
      // Overview zoom (e.g. 2.1x) renders 12, 13, 14... meaning 120, 130, 140
      twoDigit.push({ value: n * 10, px, raw: clean });
    }
  }

  // Prefer whichever scale dominates (3-digit zoomed in vs 2-digit overview)
  if (threeDigit.length >= twoDigit.length && threeDigit.length > 0) {
    return threeDigit;
  }
  return twoDigit;
}

function fitAxisLinear(
  ticks: AxisTick[],
  axis: "x" | "y",
  expectedAbsSlope?: number
): AxisFit | null {
  if (ticks.length === 0) return null;

  const sorted = [...ticks].sort((a, b) => a.px - b.px);
  const expectedSign = axis === "x" ? 1 : -1;

  if (sorted.length === 1) {
    if (!expectedAbsSlope) return null;
    const slope = expectedSign * expectedAbsSlope;
    const t = sorted[0];
    return {
      slope,
      intercept: t.px - slope * t.value,
      inliers: 1,
      ticks: sorted,
    };
  }

  let bestFit: AxisFit | null = null;
  let bestScore = -1;

  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const dv = sorted[j].value - sorted[i].value;
      if (dv === 0) continue;
      // X increases left->right (dv > 0), Y decreases top->bottom (dv < 0)
      if (axis === "x" && dv <= 0) continue;
      if (axis === "y" && dv >= 0) continue;

      const dp = sorted[j].px - sorted[i].px;
      if (dp <= 12) continue;

      const slope = dp / dv;
      const absSlope = Math.abs(slope);
      if (absSlope < 6 || absSlope > 950) continue;

      if (expectedAbsSlope) {
        const diffRatio =
          Math.abs(absSlope - expectedAbsSlope) /
          Math.max(absSlope, expectedAbsSlope);
        if (diffRatio > 0.14) continue;
      }

      const intercept = sorted[i].px - slope * sorted[i].value;
      const tolPx = Math.max(10, Math.min(26, absSlope * 0.18));

      const matched: AxisTick[] = [];
      const seenVals = new Set<number>();
      for (const t of sorted) {
        const pred = intercept + slope * t.value;
        if (Math.abs(pred - t.px) <= tolPx && !seenVals.has(t.value)) {
          seenVals.add(t.value);
          matched.push(t);
        }
      }

      if (matched.length < 2) continue;

      // Refine OLS over inliers
      const n = matched.length;
      const meanV = matched.reduce((s, t) => s + t.value, 0) / n;
      const meanP = matched.reduce((s, t) => s + t.px, 0) / n;
      let num = 0;
      let den = 0;
      for (const t of matched) {
        num += (t.value - meanV) * (t.px - meanP);
        den += (t.value - meanV) * (t.value - meanV);
      }
      if (den === 0) continue;
      const refSlope = num / den;
      const refIntercept = meanP - refSlope * meanV;

      let errSum = 0;
      for (const t of matched) {
        errSum += Math.abs(refIntercept + refSlope * t.value - t.px);
      }
      const avgErr = errSum / n;

      const score = n * 100 - avgErr;
      if (score > bestScore) {
        bestScore = score;
        bestFit = {
          slope: refSlope,
          intercept: refIntercept,
          inliers: n,
          ticks: matched,
        };
      }
    }
  }

  // Fallback if 2+ ticks existed but none formed a pair (e.g. 1 outlier) & we have expectedAbsSlope
  if (!bestFit && expectedAbsSlope) {
    const slope = expectedSign * expectedAbsSlope;
    // Try anchoring on each tick and count agreement
    for (const anchor of sorted) {
      const intercept = anchor.px - slope * anchor.value;
      const matched = sorted.filter(
        (t) => Math.abs(intercept + slope * t.value - t.px) <= 14
      );
      if (!bestFit || matched.length > bestFit.inliers) {
        bestFit = {
          slope,
          intercept,
          inliers: matched.length,
          ticks: matched,
        };
      }
    }
  }

  return bestFit;
}

/**
 * Converts bright neutral gray/white axis ruler digits onto a crisp black-on-white canvas,
 * stripping colored vegetation (green) and Ground Zero red overlays.
 */
function renderNeutralRulerCanvas(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  scale: number
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(8, Math.round(sw * scale));
  c.height = Math.max(8, Math.round(sh * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return c;

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);

  const imgData = ctx.getImageData(0, 0, c.width, c.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const isNeutralText =
      lum >= 74 && Math.abs(r - b) < 36 && Math.abs(r - g) < 32;
    const v = isNeutralText ? 0 : 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

export async function scanTopCompassHeading(
  source: CanvasImageSource,
  vw: number,
  vh: number
): Promise<{ headingDeg: number; compassLabel: string; rawText: string } | null> {
  const sx = Math.round(vw * 0.42);
  const sy = Math.round(vh * 0.005);
  const sw = Math.max(40, Math.round(vw * 0.16));
  const sh = Math.max(24, Math.round(vh * 0.065));

  const c = renderNeutralRulerCanvas(source, sx, sy, sw, sh, 2.2);
  const worker = await getCoordOcrWorker("NESW ", "11");
  const res = await worker.recognize(c, {}, { blocks: true });
  const words = extractWordBoxesFromTesseract(res, sx, sy, 2.2);

  // Pick standalone cardinal/intercardinal token closest to horizontal screen center
  const centerX = vw * 0.5;
  let bestWord: { label: string; dist: number } | null = null;
  for (const w of words) {
    const tok = w.text.toUpperCase().replace(/[^NESW]/g, "");
    if (COMPASS_BEARINGS[tok] !== undefined) {
      const dist = Math.abs(w.cx - centerX);
      if (!bestWord || dist < bestWord.dist) {
        bestWord = { label: tok, dist };
      }
    }
  }

  const rawText = (res?.data?.text || "").trim();
  if (!bestWord) return null;

  return {
    headingDeg: COMPASS_BEARINGS[bestWord.label],
    compassLabel: bestWord.label,
    rawText,
  };
}

/**
 * Full-Screen GZW 0.5 Map Tracker:
 * 1) Scans the whole map for the bright green player arrow (never tracking the mouse cursor).
 * 2) Reads both Left (Y) and Bottom (X) grid ruler strips across all zoom levels (2-digit or 3-digit).
 * 3) Fits square-grid linear axes with outlier rejection and maps the green arrow to exact Lamang coords.
 */
export async function scanFullMapFrame(
  source: CanvasImageSource,
  vw: number,
  vh: number,
  previewCanvas?: HTMLCanvasElement | null,
  options?: { trackCompass?: boolean }
): Promise<{
  match: OcrCoordinateMatch | null;
  rawText: string;
  arrow: GreenArrowDetection | null;
  mapOpenDetected: boolean;
  compassOnly?: { headingDeg: number; compassLabel: string };
}> {
  // Draw full frame onto offscreen canvas once
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = vw;
  fullCanvas.height = vh;
  const fullCtx = fullCanvas.getContext("2d", { willReadFrequently: true });
  if (!fullCtx) {
    return { match: null, rawText: "", arrow: null, mapOpenDetected: false };
  }
  fullCtx.drawImage(source, 0, 0, vw, vh);
  const fullImg = fullCtx.getImageData(0, 0, vw, vh);

  // 1. Scan full map for player's lime-green arrow
  const arrow = detectGreenPlayerArrow(fullImg, vw, vh);

  // 2. OCR Bottom X-axis strip & Left Y-axis strip (wide enough for all 3 digits)
  const bx = Math.round(vw * 0.028);
  const by = Math.round(vh * 0.946);
  const bw = Math.max(80, Math.round(vw * 0.946));
  const bh = Math.max(24, Math.round(vh * 0.032));
  const rulerScale = vw >= 3000 ? 1.8 : vw < 1600 ? 3.0 : 2.5;
  const bottomScale = rulerScale;
  const bottomCanvas = renderNeutralRulerCanvas(
    fullCanvas,
    bx,
    by,
    bw,
    bh,
    bottomScale
  );

  const lx = Math.round(vw * 0.006);
  const ly = Math.round(vh * 0.115);
  const lw = Math.max(32, Math.round(vw * 0.026));
  const lh = Math.max(80, Math.round(vh * 0.835));
  const leftScale = rulerScale;
  const leftCanvas = renderNeutralRulerCanvas(
    fullCanvas,
    lx,
    ly,
    lw,
    lh,
    leftScale
  );

  const worker = await getCoordOcrWorker("0123456789 ", "11");
  const bRes = await worker.recognize(bottomCanvas, {}, { blocks: true });
  const lRes = await worker.recognize(leftCanvas, {}, { blocks: true });

  const xWords = extractWordBoxesFromTesseract(bRes, bx, by, bottomScale);
  const yWords = extractWordBoxesFromTesseract(lRes, lx, ly, leftScale);

  const xTicks = parseAxisTicks(xWords, "x");
  const yTicks = parseAxisTicks(yWords, "y");

  // 3. Linear scale fit with square-grid cross-validation
  let fitX = fitAxisLinear(xTicks, "x");
  let fitY = fitAxisLinear(yTicks, "y", fitX ? Math.abs(fitX.slope) : undefined);

  if (!fitX && fitY) {
    fitX = fitAxisLinear(xTicks, "x", Math.abs(fitY.slope));
  }
  if (fitX && fitY) {
    const ratioDiff =
      Math.abs(Math.abs(fitX.slope) - Math.abs(fitY.slope)) /
      Math.max(Math.abs(fitX.slope), Math.abs(fitY.slope));
    if (ratioDiff > 0.1) {
      if (fitX.inliers >= fitY.inliers) {
        fitY = fitAxisLinear(yTicks, "y", Math.abs(fitX.slope));
      } else {
        fitX = fitAxisLinear(xTicks, "x", Math.abs(fitY.slope));
      }
    }
  }

  const mapOpenDetected = Boolean(
    (fitX && fitX.inliers >= 2) || (fitY && fitY.inliers >= 2)
  );

  let match: OcrCoordinateMatch | null = null;
  if (arrow && fitX && fitY) {
    const gridX = (arrow.cx - fitX.intercept) / fitX.slope;
    const gridY = (arrow.cy - fitY.intercept) / fitY.slope;

    if (gridX >= 98 && gridX <= 242 && gridY >= 98 && gridY <= 182) {
      const metersX = Math.max(0, Math.min(14000, Math.round((gridX - 100) * 100)));
      const metersY = Math.max(0, Math.min(8000, Math.round((gridY - 100) * 100)));
      const gxFloor = Math.max(100, Math.min(239, Math.floor(gridX)));
      const gyFloor = Math.max(100, Math.min(179, Math.floor(gridY)));

      match = {
        grid: `${gxFloor} ${gyFloor}`,
        x: metersX,
        y: metersY,
        rawText: `Arrow(${Math.round(arrow.cx)},${Math.round(arrow.cy)}) · X:${fitX.inliers} Y:${fitY.inliers}`,
        headingDeg: arrow.headingDeg,
        compassLabel:
          arrow.headingDeg !== undefined
            ? headingToCompass8(arrow.headingDeg)
            : undefined,
        arrowDetected: true,
        mapOpenDetected: true,
        xTicksCount: fitX.inliers,
        yTicksCount: fitY.inliers,
      };
    }
  }

  // 4. If map is NOT open and compass tracking is enabled, check top HUD compass
  let compassOnly: { headingDeg: number; compassLabel: string } | undefined;
  let compassRaw = "";
  if (!mapOpenDetected && options?.trackCompass) {
    const compass = await scanTopCompassHeading(fullCanvas, vw, vh);
    if (compass) {
      compassOnly = {
        headingDeg: compass.headingDeg,
        compassLabel: compass.compassLabel,
      };
      compassRaw = ` · Compass:${compass.compassLabel}`;
    }
  }

  // 5. Render annotated full-screen diagnostic thumbnail into previewCanvas
  if (previewCanvas) {
    const pCtx = previewCanvas.getContext("2d");
    if (pCtx) {
      const pw = 320;
      const ph = Math.max(120, Math.round((vh / vw) * pw));
      previewCanvas.width = pw;
      previewCanvas.height = ph;
      pCtx.drawImage(fullCanvas, 0, 0, pw, ph);

      const sxScale = pw / vw;
      const syScale = ph / vh;

      // Subtle highlight along detected rulers
      pCtx.strokeStyle = fitX
        ? "rgba(56, 189, 248, 0.75)"
        : "rgba(148, 163, 184, 0.35)";
      pCtx.lineWidth = 1.5;
      pCtx.strokeRect(
        bx * sxScale,
        by * syScale,
        bw * sxScale,
        bh * syScale
      );

      pCtx.strokeStyle = fitY
        ? "rgba(56, 189, 248, 0.75)"
        : "rgba(148, 163, 184, 0.35)";
      pCtx.strokeRect(
        lx * sxScale,
        ly * syScale,
        lw * sxScale,
        lh * syScale
      );

      // Highlight locked green player arrow
      if (arrow) {
        const ax = arrow.cx * sxScale;
        const ay = arrow.cy * syScale;
        pCtx.strokeStyle = "#10b981";
        pCtx.lineWidth = 2;
        pCtx.beginPath();
        pCtx.arc(ax, ay, 11, 0, Math.PI * 2);
        pCtx.stroke();

        pCtx.beginPath();
        pCtx.moveTo(ax - 15, ay);
        pCtx.lineTo(ax - 6, ay);
        pCtx.moveTo(ax + 6, ay);
        pCtx.lineTo(ax + 15, ay);
        pCtx.moveTo(ax, ay - 15);
        pCtx.lineTo(ax, ay - 6);
        pCtx.moveTo(ax, ay + 6);
        pCtx.lineTo(ax, ay + 15);
        pCtx.stroke();

        if (match) {
          pCtx.fillStyle = "rgba(6, 20, 15, 0.92)";
          pCtx.fillRect(Math.max(2, ax - 32), Math.max(2, ay - 28), 64, 15);
          pCtx.fillStyle = "#6ee7b7";
          pCtx.font = "bold 10px monospace";
          pCtx.fillText(
            match.grid,
            Math.max(6, ax - 26),
            Math.max(13, ay - 17)
          );
        }
      }
    }
  }

  const rawText = match
    ? `${match.grid} (X:${fitX?.inliers ?? 0} Y:${fitY?.inliers ?? 0})`
    : mapOpenDetected
      ? `Rulers locked (X:${fitX?.inliers ?? 0} Y:${fitY?.inliers ?? 0}) · No green arrow in view`
      : `In-field${compassRaw || " · Open M to sync"}`;

  return {
    match,
    rawText,
    arrow,
    mapOpenDetected,
    compassOnly,
  };
}

/**
 * Main entry point used by Screen Sync loop.
 */
export async function scanVideoFrameForLamangCoords(
  video: HTMLVideoElement,
  rect: CropRectPct,
  previewCanvas?: HTMLCanvasElement | null,
  options?: { preset?: ScanRegionPreset; trackCompass?: boolean }
): Promise<{
  match: OcrCoordinateMatch | null;
  rawText: string;
  mapOpenDetected?: boolean;
  compassOnly?: { headingDeg: number; compassLabel: string };
}> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    return { match: null, rawText: "" };
  }

  const preset = options?.preset ?? "full-map";
  if (preset === "full-map") {
    const res = await scanFullMapFrame(video, vw, vh, previewCanvas, {
      trackCompass: options?.trackCompass,
    });
    return {
      match: res.match,
      rawText: res.rawText,
      mapOpenDetected: res.mapOpenDetected,
      compassOnly: res.compassOnly,
    };
  }

  if (preset === "top-center") {
    const compass = await scanTopCompassHeading(video, vw, vh);
    if (previewCanvas) {
      const pCtx = previewCanvas.getContext("2d");
      if (pCtx) {
        previewCanvas.width = 280;
        previewCanvas.height = 68;
        pCtx.drawImage(
          video,
          Math.round(vw * 0.4),
          0,
          Math.round(vw * 0.2),
          Math.round(vh * 0.08),
          0,
          0,
          280,
          68
        );
      }
    }
    return {
      match: null,
      rawText: compass ? `Compass ${compass.compassLabel} (${compass.headingDeg}°)` : "Scanning top compass...",
      compassOnly: compass
        ? { headingDeg: compass.headingDeg, compassLabel: compass.compassLabel }
        : undefined,
    };
  }

  // Legacy corner OCR mode
  const sx = Math.max(0, Math.round((rect.xPct / 100) * vw));
  const sy = Math.max(0, Math.round((rect.yPct / 100) * vh));
  const sw = Math.max(40, Math.min(vw - sx, Math.round((rect.wPct / 100) * vw)));
  const sh = Math.max(30, Math.min(vh - sy, Math.round((rect.hPct / 100) * vh)));

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

  const scale = sw < 520 ? 2.2 : 1.5;
  const workCanvas = renderNeutralRulerCanvas(video, sx, sy, sw, sh, scale);
  const worker = await getCoordOcrWorker("0123456789,./:- XYGridgrid");
  const res = await worker.recognize(workCanvas);
  const rawText = (res?.data?.text || "").trim();
  const match = extractLamangCoordsFromOcrText(rawText);

  return { match, rawText };
}
