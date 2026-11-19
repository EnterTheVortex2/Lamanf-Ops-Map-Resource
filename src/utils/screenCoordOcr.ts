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
    hint: "Locks onto your green player arrow on full Map (M) or Hold-M quick map, calibrates grid rulers at any zoom, and tracks the top HUD compass while moving.",
    rect: { xPct: 0, yPct: 0, wPct: 100, hPct: 100 },
  },
  "bottom-right": {
    label: "Legacy · Corner Coords (Bottom-Right)",
    hint: "Legacy OCR box for bottom-right numeric coordinate readouts only.",
    rect: { xPct: 68, yPct: 74, wPct: 30, hPct: 23 },
  },
  "top-center": {
    label: "Top HUD Compass Strip",
    hint: "Reads continuous N / NE / E / SE / S / SW / W / NW compass facing from the top-center HUD while walking.",
    rect: { xPct: 33, yPct: 4, wPct: 34, hPct: 8 },
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
 * Estimates facing angle (0°=N/Up, 90°=E/Right, 180°=S/Down, 270°=W/Left)
 * from the green player chevron using bilateral symmetry (|Σp³| ≈ 0) +
 * forward axial skewness (Σf³ > 0) + nose-to-tail reach asymmetry.
 */
function estimateArrowHeadingDeg(
  pts: [number, number][],
  cx: number,
  cy: number
): number | undefined {
  const n = pts.length;
  if (n < 8) return undefined;

  let sumR2 = 0;
  for (const [x, y] of pts) {
    const dx = x - cx;
    const dy = y - cy;
    sumR2 += dx * dx + dy * dy;
  }
  const rms = Math.sqrt(sumR2 / n);
  if (rms < 1.5) return undefined;

  let bestDeg = 0;
  let bestScore = -Infinity;

  for (let deg = 0; deg < 360; deg += 1) {
    const rad = (deg * Math.PI) / 180;
    const ux = Math.sin(rad);
    const uy = -Math.cos(rad);
    let m3 = 0;
    let p3 = 0;
    let maxF = -Infinity;
    let minF = Infinity;

    for (const [x, y] of pts) {
      const dx = (x - cx) / rms;
      const dy = (y - cy) / rms;
      const f = dx * ux + dy * uy;
      const p = -dx * uy + dy * ux;
      m3 += f * f * f;
      p3 += p * p * p;
      if (f > maxF) maxF = f;
      if (f < minF) minF = f;
    }

    const asym = maxF - Math.abs(minF);
    const score = m3 / n - 0.85 * Math.abs(p3 / n) + asym * 0.35;
    if (score > bestScore) {
      bestScore = score;
      bestDeg = deg;
    }
  }

  return bestDeg;
}

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

    // Score prefers vivid lime-green solid chevron blobs
    const score = pts.length * (avgGMinusB / 100);
    if (score > bestScore) {
      bestScore = score;
      best = {
        cx,
        cy,
        pixelCount: pts.length,
        bbox: { x0, y0, x1, y1 },
        headingDeg: estimateArrowHeadingDeg(pts, cx, cy),
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

function renderCompassGlyphLineCanvas(
  source: CanvasImageSource,
  vw: number,
  vh: number,
  lumMin: number
): {
  canvas: HTMLCanvasElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  scale: number;
  pad: number;
} | null {
  const sx = Math.round(vw * 0.34);
  const sw = Math.max(80, Math.round(vw * 0.32));
  const sy0 = Math.round(vh * 0.04);
  const sh0 = Math.max(36, Math.round(vh * 0.08));

  const probe = document.createElement("canvas");
  probe.width = sw;
  probe.height = sh0;
  const pCtx = probe.getContext("2d", { willReadFrequently: true });
  if (!pCtx) return null;
  pCtx.drawImage(source, sx, sy0, sw, sh0, 0, 0, sw, sh0);
  const d = pCtx.getImageData(0, 0, sw, sh0).data;

  const bin = new Uint8Array(sw * sh0);
  for (let i = 0; i < sw * sh0; i += 1) {
    const p = i * 4;
    const r = d[p];
    const g = d[p + 1];
    const b = d[p + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum >= lumMin && sat < 26) bin[i] = 1;
  }

  // Isolate strictly character-sized bright components (rejects overcast sky & clouds)
  const seen = new Uint8Array(sw * sh0);
  const glyphs: {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    cy: number;
  }[] = [];
  const minH = Math.max(5, Math.round(vh * 0.0045));
  const maxH = Math.max(16, Math.round(vh * 0.015));
  const maxW = Math.max(18, Math.round(vw * 0.01));
  const q = new Int32Array(sw * sh0);

  for (let idx = 0; idx < sw * sh0; idx += 1) {
    if (!bin[idx] || seen[idx]) continue;
    let head = 0;
    let tail = 0;
    q[tail++] = idx;
    seen[idx] = 1;
    let x0 = sw;
    let x1 = 0;
    let y0 = sh0;
    let y1 = 0;
    let cnt = 0;

    while (head < tail) {
      const cur = q[head++];
      const cx = cur % sw;
      const cy = (cur - cx) / sw;
      if (cx < x0) x0 = cx;
      if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy;
      if (cy > y1) y1 = cy;
      cnt += 1;

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = cy + dy;
        if (ny < 0 || ny >= sh0) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx;
          if (nx < 0 || nx >= sw) continue;
          const ni = ny * sw + nx;
          if (bin[ni] && !seen[ni]) {
            seen[ni] = 1;
            q[tail++] = ni;
          }
        }
      }
    }

    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (bh >= minH && bh <= maxH && bw <= maxW && cnt >= 6) {
      glyphs.push({ x0, x1, y0, y1, cy: (y0 + y1) / 2 });
    }
  }

  if (glyphs.length === 0) return null;

  // Pick horizontal baseline row with most character glyphs
  let bestBaseY = 0;
  let bestCount = 0;
  for (let y = 0; y < sh0; y += 1) {
    let count = 0;
    for (const g of glyphs) {
      if (g.cy >= y && g.cy <= y + maxH) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      bestBaseY = y;
    }
  }

  const lineGlyphs = glyphs.filter(
    (g) => g.cy >= bestBaseY && g.cy <= bestBaseY + maxH
  );
  if (lineGlyphs.length === 0) return null;

  let ly0 = sh0;
  let ly1 = 0;
  for (const g of lineGlyphs) {
    if (g.y0 < ly0) ly0 = g.y0;
    if (g.y1 > ly1) ly1 = g.y1;
  }

  const cropY0 = Math.max(0, ly0 - 2);
  const cropH = Math.max(8, ly1 - ly0 + 5);
  const clean = document.createElement("canvas");
  clean.width = sw;
  clean.height = cropH;
  const cCtx = clean.getContext("2d");
  if (!cCtx) return null;
  const cImg = cCtx.createImageData(sw, cropH);
  for (let p = 0; p < cImg.data.length; p += 4) {
    cImg.data[p] = 255;
    cImg.data[p + 1] = 255;
    cImg.data[p + 2] = 255;
    cImg.data[p + 3] = 255;
  }
  for (const g of lineGlyphs) {
    for (let y = g.y0; y <= g.y1; y += 1) {
      const outY = y - cropY0;
      if (outY < 0 || outY >= cropH) continue;
      for (let x = g.x0; x <= g.x1; x += 1) {
        if (bin[y * sw + x]) {
          const p = (outY * sw + x) * 4;
          cImg.data[p] = 0;
          cImg.data[p + 1] = 0;
          cImg.data[p + 2] = 0;
        }
      }
    }
  }
  cCtx.putImageData(cImg, 0, 0);

  const scale = vw >= 2000 ? 3.0 : 3.4;
  const pad = 24;
  const out = document.createElement("canvas");
  out.width = Math.round(sw * scale) + pad * 2;
  out.height = Math.round(cropH * scale) + pad * 2;
  const oCtx = out.getContext("2d");
  if (!oCtx) return null;
  oCtx.fillStyle = "#ffffff";
  oCtx.fillRect(0, 0, out.width, out.height);
  oCtx.imageSmoothingEnabled = false;
  oCtx.drawImage(
    clean,
    0,
    0,
    sw,
    cropH,
    pad,
    pad,
    Math.round(sw * scale),
    Math.round(cropH * scale)
  );

  return {
    canvas: out,
    sx,
    sy: sy0 + cropY0,
    sw,
    sh: cropH,
    scale,
    pad,
  };
}

function fitCompassHeadingFromTokens(
  words: WordBox[],
  vw: number
): { headingDeg: number; compassLabel: string } | null {
  const menuWordsRegex =
    /(HIDEO|HIDEQ|TASKS|STATI|VEND|DORS|YORS|JORS|CHARA|BACK|DEPLO|SQUAD|MANUAL)/i;
  if (words.some((w) => menuWordsRegex.test(w.text))) {
    return null;
  }

  const tokens: { cx: number; deg: number; label: string }[] = [];
  for (const w of words) {
    const clean = w.text.toUpperCase().replace(/[^A-Z]/g, "");
    const deg = COMPASS_BEARINGS[clean];
    if (deg !== undefined) {
      tokens.push({ cx: w.cx, deg, label: clean });
    }
  }

  if (tokens.length === 0) return null;

  const centerX = vw * 0.5;
  const nomPxPerDeg = vw * 0.00144; // ~3.61 px/deg at 2506w (~162px per 45°)
  const minPxPerDeg = vw * 0.00085;
  const maxPxPerDeg = vw * 0.0024;
  const maxErrPx = Math.max(18, vw * 0.011);

  if (tokens.length >= 2) {
    let bestInliers: { cx: number; degUnwrapped: number }[] = [];

    for (let i = 0; i < tokens.length; i += 1) {
      const a = tokens[i];
      const group: { cx: number; degUnwrapped: number }[] = [];

      for (let j = 0; j < tokens.length; j += 1) {
        const b = tokens[j];
        const dx = b.cx - a.cx;
        if (Math.abs(dx) < 1) {
          if (b.deg === a.deg) {
            group.push({ cx: b.cx, degUnwrapped: a.deg });
          }
          continue;
        }

        // Resolve 360° wraparound near N (0°/360°) using expected linear direction
        const estDiffDeg = dx / nomPxPerDeg;
        let bestDiffDeg = b.deg - a.deg;
        let bestWrapDist = Infinity;
        for (const shift of [-360, 0, 360]) {
          const cand = b.deg + shift - a.deg;
          const dist = Math.abs(cand - estDiffDeg);
          if (dist < bestWrapDist) {
            bestWrapDist = dist;
            bestDiffDeg = cand;
          }
        }

        if (bestDiffDeg === 0 || Math.sign(bestDiffDeg) !== Math.sign(dx)) {
          continue;
        }
        const pxPerDeg = dx / bestDiffDeg;
        if (pxPerDeg < minPxPerDeg || pxPerDeg > maxPxPerDeg) {
          continue;
        }

        group.push({ cx: b.cx, degUnwrapped: a.deg + bestDiffDeg });
      }

      if (group.length < 2) continue;

      // Refine linear regression x -> degUnwrapped & reject outlier mismatch
      const n = group.length;
      const meanX = group.reduce((s, p) => s + p.cx, 0) / n;
      const meanD = group.reduce((s, p) => s + p.degUnwrapped, 0) / n;
      let num = 0;
      let den = 0;
      for (const p of group) {
        num += (p.cx - meanX) * (p.degUnwrapped - meanD);
        den += (p.cx - meanX) * (p.cx - meanX);
      }
      if (den <= 0) continue;
      const slopeDegPerPx = num / den;
      const pxPerDegFit = 1 / slopeDegPerPx;
      if (pxPerDegFit < minPxPerDeg || pxPerDegFit > maxPxPerDeg) continue;

      const interceptDeg = meanD - slopeDegPerPx * meanX;
      const consistent = group.filter(
        (p) =>
          Math.abs(p.cx - (p.degUnwrapped - interceptDeg) / slopeDegPerPx) <=
          maxErrPx
      );

      if (consistent.length > bestInliers.length) {
        bestInliers = consistent;
      }
    }

    if (bestInliers.length >= 2) {
      const n = bestInliers.length;
      const meanX = bestInliers.reduce((s, p) => s + p.cx, 0) / n;
      const meanD = bestInliers.reduce((s, p) => s + p.degUnwrapped, 0) / n;
      let num = 0;
      let den = 0;
      for (const p of bestInliers) {
        num += (p.cx - meanX) * (p.degUnwrapped - meanD);
        den += (p.cx - meanX) * (p.cx - meanX);
      }
      if (den > 0) {
        const slopeDegPerPx = num / den;
        const rawCenterDeg = meanD + slopeDegPerPx * (centerX - meanX);
        const headingDeg = Math.round(((rawCenterDeg % 360) + 360) % 360) % 360;
        return {
          headingDeg,
          compassLabel: headingToCompass8(headingDeg),
        };
      }
    }
  }

  // Fallback when clouds cover outer cardinals: allow 1 clean central cardinal token
  if (tokens.length === 1 && words.length <= 3) {
    const t = tokens[0];
    if (Math.abs(t.cx - centerX) <= vw * 0.045) {
      const est = t.deg + (centerX - t.cx) / nomPxPerDeg;
      const headingDeg = Math.round(((est % 360) + 360) % 360) % 360;
      return {
        headingDeg,
        compassLabel: headingToCompass8(headingDeg),
      };
    }
  }

  return null;
}

export async function scanTopCompassHeading(
  source: CanvasImageSource,
  vw: number,
  vh: number
): Promise<{
  headingDeg: number;
  compassLabel: string;
  rawText: string;
  cropRect?: { sx: number; sy: number; sw: number; sh: number };
} | null> {
  const worker = await getCoordOcrWorker(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ",
    "7"
  );

  for (const lumMin of [196, 168]) {
    const prep = renderCompassGlyphLineCanvas(source, vw, vh, lumMin);
    if (!prep) continue;
    const res = await worker.recognize(prep.canvas, {}, { blocks: true });
    const words: WordBox[] = [];
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
            words.push({
              text,
              cx: prep.sx + (b.x0 + b.x1 - 2 * prep.pad) / (2 * prep.scale),
              cy: prep.sy + (b.y0 + b.y1 - 2 * prep.pad) / (2 * prep.scale),
            });
          }
        }
      }
    }

    const rawText = (res?.data?.text || "").trim();
    if (
      /(HIDEO|HIDEQ|TASKS|STATI|VEND|DORS|YORS|JORS|CHARA|BACK|DEPLO)/i.test(
        rawText
      )
    ) {
      return null;
    }

    const fit = fitCompassHeadingFromTokens(words, vw);
    if (fit) {
      return {
        ...fit,
        rawText,
        cropRect: { sx: prep.sx, sy: prep.sy, sw: prep.sw, sh: prep.sh },
      };
    }
  }

  return null;
}

async function scanRulerAxesPair(
  fullCanvas: HTMLCanvasElement,
  vw: number,
  bRect: { x: number; y: number; w: number; h: number },
  lRect: { x: number; y: number; w: number; h: number }
): Promise<{ fitX: AxisFit | null; fitY: AxisFit | null }> {
  const rulerScale = vw >= 3000 ? 1.8 : vw < 1600 ? 3.0 : 2.5;
  const bottomCanvas = renderNeutralRulerCanvas(
    fullCanvas,
    bRect.x,
    bRect.y,
    bRect.w,
    bRect.h,
    rulerScale
  );
  const leftCanvas = renderNeutralRulerCanvas(
    fullCanvas,
    lRect.x,
    lRect.y,
    lRect.w,
    lRect.h,
    rulerScale
  );

  const worker = await getCoordOcrWorker("0123456789 ", "11");
  const bRes = await worker.recognize(bottomCanvas, {}, { blocks: true });
  const lRes = await worker.recognize(leftCanvas, {}, { blocks: true });

  const xWords = extractWordBoxesFromTesseract(
    bRes,
    bRect.x,
    bRect.y,
    rulerScale
  );
  const yWords = extractWordBoxesFromTesseract(
    lRes,
    lRect.x,
    lRect.y,
    rulerScale
  );

  const xTicks = parseAxisTicks(xWords, "x");
  const yTicks = parseAxisTicks(yWords, "y");

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

  return { fitX, fitY };
}

/**
 * Full-Screen GZW 0.5 Map Tracker:
 * 1) Scans the whole map (or Hold-M quick minimap) for the bright green player arrow (never the cursor).
 * 2) Reads Left (Y) & Bottom (X) grid ruler strips across all zoom levels (2-digit overview or 3-digit).
 * 3) Calibrates exact facing direction from the top HUD compass (when visible) or map arrow geometry.
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
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = vw;
  fullCanvas.height = vh;
  const fullCtx = fullCanvas.getContext("2d", { willReadFrequently: true });
  if (!fullCtx) {
    return { match: null, rawText: "", arrow: null, mapOpenDetected: false };
  }
  fullCtx.drawImage(source, 0, 0, vw, vh);
  const fullImg = fullCtx.getImageData(0, 0, vw, vh);

  // 1. Scan full frame for player's lime-green chevron arrow
  const arrow = detectGreenPlayerArrow(fullImg, vw, vh);

  // 2. Try Full-Screen Map Rulers first (M tab)
  const fullBRect = {
    x: Math.round(vw * 0.028),
    y: Math.round(vh * 0.946),
    w: Math.max(80, Math.round(vw * 0.946)),
    h: Math.max(24, Math.round(vh * 0.032)),
  };
  const fullLRect = {
    x: Math.round(vw * 0.006),
    y: Math.round(vh * 0.115),
    w: Math.max(32, Math.round(vw * 0.026)),
    h: Math.max(80, Math.round(vh * 0.835)),
  };

  let activeBRect = fullBRect;
  let activeLRect = fullLRect;
  let { fitX, fitY } = await scanRulerAxesPair(
    fullCanvas,
    vw,
    fullBRect,
    fullLRect
  );

  const fullScreenRulersLocked = Boolean(
    fitX && fitY && fitX.inliers >= 2 && fitY.inliers >= 2
  );
  let holdMapMode = false;

  // 3. Fallback: Hold-M quick floating minimap on the right side of the HUD
  if (
    !fullScreenRulersLocked &&
    arrow &&
    arrow.cx >= vw * 0.56 &&
    arrow.cy >= vh * 0.1 &&
    arrow.cy <= vh * 0.92
  ) {
    const holdBRect = {
      x: Math.round(vw * 0.612),
      y: Math.round(vh * 0.882),
      w: Math.max(80, Math.round(vw * 0.372)),
      h: Math.max(22, Math.round(vh * 0.036)),
    };
    const holdLRect = {
      x: Math.round(vw * 0.59),
      y: Math.round(vh * 0.108),
      w: Math.max(28, Math.round(vw * 0.028)),
      h: Math.max(80, Math.round(vh * 0.794)),
    };
    const holdFits = await scanRulerAxesPair(
      fullCanvas,
      vw,
      holdBRect,
      holdLRect
    );
    if (holdFits.fitX && holdFits.fitY) {
      fitX = holdFits.fitX;
      fitY = holdFits.fitY;
      activeBRect = holdBRect;
      activeLRect = holdLRect;
      holdMapMode = true;
    }
  }

  const mapOpenDetected = Boolean(
    (fitX && fitX.inliers >= 2) || (fitY && fitY.inliers >= 2)
  );

  // 4. Read Top HUD Compass whenever full-screen Map menu is NOT covering it (in-field OR Hold-M!)
  let compassHeading: {
    headingDeg: number;
    compassLabel: string;
    rawText: string;
    cropRect?: { sx: number; sy: number; sw: number; sh: number };
  } | null = null;
  if (options?.trackCompass && !fullScreenRulersLocked) {
    compassHeading = await scanTopCompassHeading(fullCanvas, vw, vh);
  }

  let match: OcrCoordinateMatch | null = null;
  if (arrow && fitX && fitY) {
    const gridX = (arrow.cx - fitX.intercept) / fitX.slope;
    const gridY = (arrow.cy - fitY.intercept) / fitY.slope;

    if (gridX >= 98 && gridX <= 242 && gridY >= 98 && gridY <= 182) {
      const metersX = Math.max(
        0,
        Math.min(14000, Math.round((gridX - 100) * 100))
      );
      const metersY = Math.max(
        0,
        Math.min(8000, Math.round((gridY - 100) * 100))
      );
      const gxFloor = Math.max(100, Math.min(239, Math.floor(gridX)));
      const gyFloor = Math.max(100, Math.min(179, Math.floor(gridY)));

      const bestHeadingDeg = compassHeading?.headingDeg ?? arrow.headingDeg;
      const bestCompassLabel =
        bestHeadingDeg !== undefined
          ? headingToCompass8(bestHeadingDeg)
          : undefined;

      match = {
        grid: `${gxFloor} ${gyFloor}`,
        x: metersX,
        y: metersY,
        rawText: `${holdMapMode ? "Hold-M" : "Map"}(${Math.round(arrow.cx)},${Math.round(arrow.cy)}) · X:${fitX.inliers} Y:${fitY.inliers}${compassHeading ? ` · ${compassHeading.compassLabel} ${compassHeading.headingDeg}°` : ""}`,
        headingDeg: bestHeadingDeg,
        compassLabel: bestCompassLabel,
        arrowDetected: true,
        mapOpenDetected: true,
        xTicksCount: fitX.inliers,
        yTicksCount: fitY.inliers,
      };
    }
  }

  let compassOnly: { headingDeg: number; compassLabel: string } | undefined;
  let compassRaw = "";
  if (!match && compassHeading) {
    compassOnly = {
      headingDeg: compassHeading.headingDeg,
      compassLabel: compassHeading.compassLabel,
    };
    compassRaw = ` · Compass ${compassHeading.compassLabel} (${compassHeading.headingDeg}°)`;
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

      pCtx.strokeStyle = fitX
        ? holdMapMode
          ? "rgba(250, 204, 21, 0.85)"
          : "rgba(56, 189, 248, 0.75)"
        : "rgba(148, 163, 184, 0.35)";
      pCtx.lineWidth = 1.5;
      pCtx.strokeRect(
        activeBRect.x * sxScale,
        activeBRect.y * syScale,
        activeBRect.w * sxScale,
        activeBRect.h * syScale
      );

      pCtx.strokeStyle = fitY
        ? holdMapMode
          ? "rgba(250, 204, 21, 0.85)"
          : "rgba(56, 189, 248, 0.75)"
        : "rgba(148, 163, 184, 0.35)";
      pCtx.strokeRect(
        activeLRect.x * sxScale,
        activeLRect.y * syScale,
        activeLRect.w * sxScale,
        activeLRect.h * syScale
      );

      if (compassHeading?.cropRect) {
        const cr = compassHeading.cropRect;
        pCtx.strokeStyle = "rgba(52, 211, 153, 0.85)";
        pCtx.strokeRect(
          cr.sx * sxScale,
          cr.sy * syScale,
          cr.sw * sxScale,
          cr.sh * syScale
        );
      }

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
          const badge = match.compassLabel
            ? `${match.grid} · ${match.compassLabel}`
            : match.grid;
          const bwPx = badge.length * 6.5 + 10;
          pCtx.fillStyle = "rgba(6, 20, 15, 0.92)";
          pCtx.fillRect(
            Math.max(2, Math.min(pw - bwPx - 2, ax - bwPx / 2)),
            Math.max(2, ay - 28),
            bwPx,
            15
          );
          pCtx.fillStyle = "#6ee7b7";
          pCtx.font = "bold 10px monospace";
          pCtx.fillText(
            badge,
            Math.max(6, Math.min(pw - bwPx + 2, ax - bwPx / 2 + 5)),
            Math.max(13, ay - 17)
          );
        }
      }
    }
  }

  const rawText = match
    ? `${match.grid}${match.compassLabel ? ` · ${match.compassLabel} (${match.headingDeg}°)` : ""} (${holdMapMode ? "Hold-M" : "Map"} X:${fitX?.inliers ?? 0} Y:${fitY?.inliers ?? 0})`
    : mapOpenDetected
      ? `Rulers locked (X:${fitX?.inliers ?? 0} Y:${fitY?.inliers ?? 0}) · No green arrow in view`
      : `In-field${compassRaw || " · Open/Hold M to sync"}`;

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
          Math.round(vw * 0.33),
          Math.round(vh * 0.04),
          Math.round(vw * 0.34),
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
      rawText: compass
        ? `Compass ${compass.compassLabel} (${compass.headingDeg}°)`
        : "Scanning top compass...",
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
