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
    hint: "Locks strictly onto your green directional chevron arrow on full Map (M) or Hold-M quick map (ignoring squadmate green squares), calibrates grid rulers at any zoom, and tracks the top HUD compass while moving.",
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

let legacyWorkerPromise: Promise<Worker> | null = null;
let lastLegacyWorkerKey = "";
let rulerWorkerPromise: Promise<Worker> | null = null;
let compassWorkerPromise: Promise<Worker> | null = null;

async function getRulerOcrWorker(): Promise<Worker> {
  if (!rulerWorkerPromise) {
    rulerWorkerPromise = (async () => {
      const w = await createWorker("eng");
      await w.setParameters({
        tessedit_char_whitelist: "0123456789 ",
        tessedit_pageseg_mode: "11" as never,
      });
      return w;
    })();
  }
  return rulerWorkerPromise;
}

async function getCompassOcrWorker(): Promise<Worker> {
  if (!compassWorkerPromise) {
    compassWorkerPromise = (async () => {
      const w = await createWorker("eng");
      await w.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ",
        tessedit_pageseg_mode: "7" as never,
      });
      return w;
    })();
  }
  return compassWorkerPromise;
}

async function getCoordOcrWorker(
  whitelist = "0123456789 ",
  psm = "3"
): Promise<Worker> {
  if (!legacyWorkerPromise) {
    legacyWorkerPromise = createWorker("eng");
  }
  const worker = await legacyWorkerPromise;
  const key = `${whitelist}::${psm}`;
  if (lastLegacyWorkerKey !== key) {
    await worker.setParameters({
      tessedit_char_whitelist: whitelist,
      tessedit_pageseg_mode: psm as never,
    });
    lastLegacyWorkerKey = key;
  }
  return worker;
}

// Module-level caches & reusable offscreen canvases to avoid DOM allocation & redundant OCR
let reusableFullCanvas: HTMLCanvasElement | null = null;
let reusableRulerBottomCanvas: HTMLCanvasElement | null = null;
let reusableRulerLeftCanvas: HTMLCanvasElement | null = null;
let reusableCompassProbeCanvas: HTMLCanvasElement | null = null;
let reusableCompassCleanCanvas: HTMLCanvasElement | null = null;
let reusableCompassOutCanvas: HTMLCanvasElement | null = null;

interface RulerCacheEntry {
  vw: number;
  vh: number;
  sig: Uint8Array;
  fitX: AxisFit;
  fitY: AxisFit;
  ts: number;
}

let cachedFullRuler: RulerCacheEntry | null = null;
let cachedHoldRuler: RulerCacheEntry | null = null;
let lastLockedMapMode: "full" | "hold" | null = null;
let lastArrowCenterHint: { x: number; y: number; vw: number; vh: number; ts: number } | null = null;

interface CompassCacheEntry {
  vw: number;
  vh: number;
  sig: Uint8Array;
  result: {
    headingDeg: number;
    compassLabel: string;
    rawText: string;
    cropRect?: { sx: number; sy: number; sw: number; sh: number };
  };
  ts: number;
}

let cachedCompass: CompassCacheEntry | null = null;
let lastGoodCompassLumMin: number = 196;
let lastCompassOcrRunAt = 0;

function resetTrackingCaches(): void {
  cachedFullRuler = null;
  cachedHoldRuler = null;
  lastLockedMapMode = null;
  lastArrowCenterHint = null;
  cachedCompass = null;
  lastCompassOcrRunAt = 0;
}

export async function terminateCoordOcrWorker(): Promise<void> {
  resetTrackingCaches();
  const tasks: Promise<unknown>[] = [];
  if (legacyWorkerPromise) {
    const p = legacyWorkerPromise;
    legacyWorkerPromise = null;
    lastLegacyWorkerKey = "";
    tasks.push(p.then((w) => w.terminate()).catch(() => {}));
  }
  if (rulerWorkerPromise) {
    const p = rulerWorkerPromise;
    rulerWorkerPromise = null;
    tasks.push(p.then((w) => w.terminate()).catch(() => {}));
  }
  if (compassWorkerPromise) {
    const p = compassWorkerPromise;
    compassWorkerPromise = null;
    tasks.push(p.then((w) => w.terminate()).catch(() => {}));
  }
  await Promise.all(tasks);
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

interface ArrowGeometryAnalysis {
  headingDeg: number;
  m3Norm: number;
  p3Norm: number;
  reachRatio: number;
  taperRatio: number;
  maxSpanTaper: number;
  reflectionOverlap: number;
  isArrow: boolean;
  shapeScore: number;
}

let greenMaskBuffer: Uint8Array | null = null;

function getGreenMaskBuffer(size: number): Uint8Array {
  if (!greenMaskBuffer || greenMaskBuffer.length < size) {
    greenMaskBuffer = new Uint8Array(size);
  }
  return greenMaskBuffer;
}

/**
 * Analyzes a connected lime-green component to distinguish the player's directional
 * chevron/arrow from symmetric squadmate icons (squares, hollow squares, diamonds, circles).
 * Estimates facing angle (0°=N/Up, 90°=E/Right, 180°=S/Down, 270°=W/Left).
 */
function analyzeGreenArrowGeometry(
  pts: [number, number][],
  cx: number,
  cy: number,
  fill: number,
  mask: Uint8Array,
  vw: number,
  vh: number
): ArrowGeometryAnalysis | null {
  const n = pts.length;
  if (n < 14) return null;

  // Reject solid/rounded filled squares immediately (GZW arrow fill is ~0.51–0.65; solid squares are ~0.85–1.00)
  if (fill < 0.24 || fill > 0.78) return null;

  // 180° centrosymmetry test around centroid (cx, cy):
  // Squares, hollow squares, diamonds, and circles reflect onto themselves (~0.85–1.00);
  // a directional chevron arrow reflects poorly (~0.62–0.74).
  let reflHits = 0;
  for (let i = 0; i < n; i += 1) {
    const rx = Math.round(2 * cx - pts[i][0]);
    const ry = Math.round(2 * cy - pts[i][1]);
    if (rx >= 0 && rx < vw && ry >= 0 && ry < vh && mask[ry * vw + rx] > 0) {
      reflHits += 1;
    }
  }
  const reflectionOverlap = reflHits / n;
  if (reflectionOverlap > 0.8) return null;

  let sumR2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = pts[i][0] - cx;
    const dy = pts[i][1] - cy;
    sumR2 += dx * dx + dy * dy;
  }
  const rms = Math.sqrt(sumR2 / n);
  if (rms < 1.5) return null;

  const normDx = new Float64Array(n);
  const normDy = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    normDx[i] = (pts[i][0] - cx) / rms;
    normDy[i] = (pts[i][1] - cy) / rms;
  }

  let bestDeg = 0;
  let bestScore = -Infinity;
  let bestM3Norm = 0;
  let bestP3Norm = 0;
  let bestMaxF = 0;
  let bestMinF = 0;
  let bestUx = 0;
  let bestUy = -1;

  for (let deg = 0; deg < 360; deg += 1) {
    const rad = (deg * Math.PI) / 180;
    const ux = Math.sin(rad);
    const uy = -Math.cos(rad);
    let m3 = 0;
    let p3 = 0;
    let maxF = -Infinity;
    let minF = Infinity;

    for (let i = 0; i < n; i += 1) {
      const dx = normDx[i];
      const dy = normDy[i];
      const f = dx * ux + dy * uy;
      const p = -dx * uy + dy * ux;
      m3 += f * f * f;
      p3 += p * p * p;
      if (f > maxF) maxF = f;
      if (f < minF) minF = f;
    }

    const m3Norm = m3 / n;
    const p3Norm = Math.abs(p3 / n);
    const asym = maxF - Math.abs(minF);
    const score = m3Norm - 0.85 * p3Norm + asym * 0.35;
    if (score > bestScore) {
      bestScore = score;
      bestDeg = deg;
      bestM3Norm = m3Norm;
      bestP3Norm = p3Norm;
      bestMaxF = maxF;
      bestMinF = minF;
      bestUx = ux;
      bestUy = uy;
    }
  }

  const reachRatio = bestMaxF / Math.max(0.01, Math.abs(bestMinF));

  let frontP = 0;
  let frontCnt = 0;
  let backP = 0;
  let backCnt = 0;
  let maxFrontP = 0;
  let maxBackP = 0;

  for (let i = 0; i < n; i += 1) {
    const dx = normDx[i];
    const dy = normDy[i];
    const f = dx * bestUx + dy * bestUy;
    const ap = Math.abs(-dx * bestUy + dy * bestUx);
    if (f > 0.25 * bestMaxF) {
      frontP += ap;
      frontCnt += 1;
      if (ap > maxFrontP) maxFrontP = ap;
    }
    if (f < -0.25 * Math.abs(bestMinF)) {
      backP += ap;
      backCnt += 1;
      if (ap > maxBackP) maxBackP = ap;
    }
  }

  const meanFrontP = frontCnt > 0 ? frontP / frontCnt : 0;
  const meanBackP = backCnt > 0 ? backP / backCnt : 0;
  const taperRatio = meanBackP / Math.max(0.01, meanFrontP);
  const maxSpanTaper = maxBackP / Math.max(0.01, maxFrontP);

  // Strict directional chevron invariants:
  // Real GZW arrows across 720p–1440p score: m3Norm ~0.17–0.22, p3Norm ~0–0.02,
  // reachRatio ~1.53–1.60, taperRatio ~2.14–2.56, maxSpanTaper ~1.79–2.28.
  // Squares/diamonds/circles (even clipped or with inner digits) stay near m3<=0.05, taper<=1.31.
  const isArrow =
    bestM3Norm >= 0.11 &&
    bestP3Norm <= 0.12 &&
    reachRatio >= 1.32 &&
    taperRatio >= 1.55 &&
    maxSpanTaper >= 1.35;

  if (!isArrow) return null;

  const shapeScore =
    bestM3Norm * 2.5 +
    Math.min(1.5, taperRatio - 1) * 0.8 +
    (1 - reflectionOverlap) * 2.0 -
    bestP3Norm * 1.5;

  return {
    headingDeg: bestDeg,
    m3Norm: bestM3Norm,
    p3Norm: bestP3Norm,
    reachRatio,
    taperRatio,
    maxSpanTaper,
    reflectionOverlap,
    isArrow,
    shapeScore,
  };
}

function extractBestArrowFromMask(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  greenIndices: number[],
  vw: number,
  vh: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  minPixels: number,
  maxSpan: number
): GreenArrowDetection | null {
  let best: GreenArrowDetection | null = null;
  let bestScore = -1;
  const queue: number[] = [];

  for (let s = 0; s < greenIndices.length; s += 1) {
    const seedIdx = greenIndices[s];
    if (mask[seedIdx] !== 1) continue;

    mask[seedIdx] = 2;
    queue.length = 0;
    queue.push(seedIdx);
    let head = 0;
    const pts: [number, number][] = [];

    while (head < queue.length) {
      const curIdx = queue[head];
      head += 1;
      const cx = curIdx % vw;
      const cy = (curIdx - cx) / vw;
      pts.push([cx, cy]);

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = cy + dy;
        if (ny < yMin || ny >= yMax) continue;
        const nRow = ny * vw;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          if (nx < xMin || nx >= xMax) continue;
          const nIdx = nRow + nx;
          if (mask[nIdx] === 1) {
            mask[nIdx] = 2;
            queue.push(nIdx);
          }
        }
      }
    }

    if (pts.length < minPixels) continue;

    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let sumX = 0;
    let sumY = 0;
    let sumGMinusB = 0;

    for (let i = 0; i < pts.length; i += 1) {
      const x = pts[i][0];
      const y = pts[i][1];
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

    const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
    if (aspect > 1.85) continue;

    const fill = pts.length / Math.max(1, bw * bh);
    const avgGMinusB = sumGMinusB / pts.length;
    if (avgGMinusB < 92) continue;

    const cx = sumX / pts.length;
    const cy = sumY / pts.length;

    const geom = analyzeGreenArrowGeometry(pts, cx, cy, fill, mask, vw, vh);
    if (!geom) continue;

    const score =
      geom.shapeScore *
      (avgGMinusB / 100) *
      Math.min(2.2, Math.sqrt(pts.length / minPixels));
    if (score > bestScore) {
      bestScore = score;
      best = {
        cx,
        cy,
        pixelCount: pts.length,
        bbox: { x0, y0, x1, y1 },
        headingDeg: geom.headingDeg,
      };
    }
  }

  return best;
}

export function detectGreenPlayerArrow(
  imgData: ImageData,
  vw: number,
  vh: number,
  hintCenter?: { x: number; y: number } | null
): GreenArrowDetection | null {
  const data = imgData.data;
  const xMin = Math.floor(vw * 0.025);
  const xMax = Math.floor(vw * 0.985);
  const yMin = Math.floor(vh * 0.11);
  const yMax = Math.floor(vh * 0.945);

  const mask = getGreenMaskBuffer(vw * vh);
  const minPixels = Math.max(14, Math.round((vw * vh) / 150000));
  const maxSpan = Math.max(48, Math.round(vw * 0.045));

  // Stage 1: Fast local ROI scan around last locked arrow (~0.15ms)
  if (hintCenter) {
    const halfRoi = Math.max(56, Math.round(vw * 0.032));
    const rx0 = Math.max(xMin, Math.round(hintCenter.x) - halfRoi);
    const rx1 = Math.min(xMax, Math.round(hintCenter.x) + halfRoi);
    const ry0 = Math.max(yMin, Math.round(hintCenter.y) - halfRoi);
    const ry1 = Math.min(yMax, Math.round(hintCenter.y) + halfRoi);
    const roiIndices: number[] = [];

    for (let y = ry0; y < ry1; y += 1) {
      const rowOffset = y * vw;
      for (let x = rx0; x < rx1; x += 1) {
        const pixelIdx = rowOffset + x;
        const idx = pixelIdx * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        if (g >= 138 && g - r >= 62 && g - b >= 85) {
          mask[pixelIdx] = 1;
          roiIndices.push(pixelIdx);
        }
      }
    }

    let roiHit: GreenArrowDetection | null = null;
    try {
      if (roiIndices.length >= minPixels) {
        const candidate = extractBestArrowFromMask(
          data,
          mask,
          roiIndices,
          vw,
          vh,
          rx0,
          rx1,
          ry0,
          ry1,
          minPixels,
          maxSpan
        );
        // Accept only if clearly inside ROI interior (not clipped at ROI edge)
        const margin = 12;
        if (
          candidate &&
          candidate.bbox.x0 > rx0 + margin &&
          candidate.bbox.x1 < rx1 - margin &&
          candidate.bbox.y0 > ry0 + margin &&
          candidate.bbox.y1 < ry1 - margin
        ) {
          roiHit = candidate;
        }
      }
    } finally {
      for (let i = 0; i < roiIndices.length; i += 1) {
        mask[roiIndices[i]] = 0;
      }
    }
    if (roiHit) return roiHit;
  }

  // Stage 2: Fast 2x2 coarse probe across full frame, expanding exact 1x1 pixels only near green hits
  const greenIndices: number[] = [];
  const tileSize = 16;
  const tilesW = Math.ceil(vw / tileSize);
  const tilesH = Math.ceil(vh / tileSize);
  const scannedTiles = new Uint8Array(tilesW * tilesH);
  const expandPad = Math.max(32, Math.round(maxSpan * 0.75));

  try {
    for (let y = yMin; y < yMax; y += 2) {
      const rowOffset = y * vw;
      for (let x = xMin; x < xMax; x += 2) {
        const idx = (rowOffset + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        if (g >= 138 && g - r >= 62 && g - b >= 85) {
          const ex0 = Math.max(xMin, x - expandPad);
          const ex1 = Math.min(xMax, x + expandPad);
          const ey0 = Math.max(yMin, y - expandPad);
          const ey1 = Math.min(yMax, y + expandPad);

          const tx0 = Math.floor(ex0 / tileSize);
          const tx1 = Math.floor((ex1 - 1) / tileSize);
          const ty0 = Math.floor(ey0 / tileSize);
          const ty1 = Math.floor((ey1 - 1) / tileSize);

          for (let ty = ty0; ty <= ty1; ty += 1) {
            const py0 = Math.max(yMin, ty * tileSize);
            const py1 = Math.min(yMax, (ty + 1) * tileSize);
            for (let tx = tx0; tx <= tx1; tx += 1) {
              const tIdx = ty * tilesW + tx;
              if (scannedTiles[tIdx]) continue;
              scannedTiles[tIdx] = 1;

              const px0 = Math.max(xMin, tx * tileSize);
              const px1 = Math.min(xMax, (tx + 1) * tileSize);
              for (let py = py0; py < py1; py += 1) {
                const pRow = py * vw;
                for (let px = px0; px < px1; px += 1) {
                  const pIdx = pRow + px;
                  if (mask[pIdx]) continue;
                  const cIdx = pIdx * 4;
                  const cr = data[cIdx];
                  const cg = data[cIdx + 1];
                  const cb = data[cIdx + 2];
                  if (cg >= 138 && cg - cr >= 62 && cg - cb >= 85) {
                    mask[pIdx] = 1;
                    greenIndices.push(pIdx);
                  }
                }
              }
            }
          }
        }
      }
    }

    if (greenIndices.length < minPixels) return null;

    return extractBestArrowFromMask(
      data,
      mask,
      greenIndices,
      vw,
      vh,
      xMin,
      xMax,
      yMin,
      yMax,
      minPixels,
      maxSpan
    );
  } finally {
    for (let i = 0; i < greenIndices.length; i += 1) {
      mask[greenIndices[i]] = 0;
    }
  }
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
  scale: number,
  targetCanvas?: HTMLCanvasElement | null
): HTMLCanvasElement {
  const c = targetCanvas ?? document.createElement("canvas");
  const w = Math.max(8, Math.round(sw * scale));
  const h = Math.max(8, Math.round(sh * scale));
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
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

  if (!reusableCompassProbeCanvas) {
    reusableCompassProbeCanvas = document.createElement("canvas");
  }
  const probe = reusableCompassProbeCanvas;
  if (probe.width !== sw) probe.width = sw;
  if (probe.height !== sh0) probe.height = sh0;
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
  if (!reusableCompassCleanCanvas) {
    reusableCompassCleanCanvas = document.createElement("canvas");
  }
  const clean = reusableCompassCleanCanvas;
  if (clean.width !== sw) clean.width = sw;
  if (clean.height !== cropH) clean.height = cropH;
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
  if (!reusableCompassOutCanvas) {
    reusableCompassOutCanvas = document.createElement("canvas");
  }
  const out = reusableCompassOutCanvas;
  const outW = Math.round(sw * scale) + pad * 2;
  const outH = Math.round(cropH * scale) + pad * 2;
  if (out.width !== outW) out.width = outW;
  if (out.height !== outH) out.height = outH;
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

function sampleRectLumSignature(
  imgData: ImageData,
  vw: number,
  rect: { x: number; y: number; w: number; h: number },
  cols = 16,
  rows = 4
): Uint8Array {
  const sig = new Uint8Array(cols * rows);
  const d = imgData.data;
  let k = 0;
  for (let r = 0; r < rows; r += 1) {
    const py = Math.min(
      imgData.height - 1,
      rect.y + Math.floor(((r + 0.5) * rect.h) / rows)
    );
    const rowOff = py * vw;
    for (let c = 0; c < cols; c += 1) {
      const px = Math.min(
        vw - 1,
        rect.x + Math.floor(((c + 0.5) * rect.w) / cols)
      );
      const idx = (rowOff + px) * 4;
      sig[k] = Math.round(
        0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2]
      );
      k += 1;
    }
  }
  return sig;
}

function sampleRulerPairSignature(
  imgData: ImageData,
  vw: number,
  bRect: { x: number; y: number; w: number; h: number },
  lRect: { x: number; y: number; w: number; h: number }
): Uint8Array {
  const bSig = sampleRectLumSignature(imgData, vw, bRect, 24, 2);
  const lSig = sampleRectLumSignature(imgData, vw, lRect, 2, 24);
  const merged = new Uint8Array(bSig.length + lSig.length);
  merged.set(bSig, 0);
  merged.set(lSig, bSig.length);
  return merged;
}

function signaturesMatch(
  a: Uint8Array,
  b: Uint8Array,
  maxMeanDiff: number,
  maxSingleDiff: number
): boolean {
  if (a.length !== b.length) return false;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = Math.abs(a[i] - b[i]);
    if (diff > maxSingleDiff) return false;
    sum += diff;
  }
  return sum / a.length <= maxMeanDiff;
}

export async function scanTopCompassHeading(
  source: CanvasImageSource,
  vw: number,
  vh: number,
  fullImg?: ImageData
): Promise<{
  headingDeg: number;
  compassLabel: string;
  rawText: string;
  cropRect?: { sx: number; sy: number; sw: number; sh: number };
} | null> {
  const now = Date.now();
  let compSig: Uint8Array | null = null;
  if (fullImg) {
    compSig = sampleRectLumSignature(
      fullImg,
      vw,
      {
        x: Math.round(vw * 0.34),
        y: Math.round(vh * 0.045),
        w: Math.max(80, Math.round(vw * 0.32)),
        h: Math.max(24, Math.round(vh * 0.055)),
      },
      24,
      3
    );
    if (
      cachedCompass &&
      cachedCompass.vw === vw &&
      cachedCompass.vh === vh &&
      now - cachedCompass.ts < 1500 &&
      signaturesMatch(compSig, cachedCompass.sig, 2.2, 16)
    ) {
      return cachedCompass.result;
    }
  }

  const worker = await getCompassOcrWorker();
  const lumOrder = lastGoodCompassLumMin === 168 ? [168, 196] : [196, 168];

  for (const lumMin of lumOrder) {
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
      cachedCompass = null;
      return null;
    }

    const fit = fitCompassHeadingFromTokens(words, vw);
    if (fit) {
      lastGoodCompassLumMin = lumMin;
      const out = {
        ...fit,
        rawText,
        cropRect: { sx: prep.sx, sy: prep.sy, sw: prep.sw, sh: prep.sh },
      };
      if (compSig) {
        cachedCompass = { vw, vh, sig: compSig, result: out, ts: now };
      }
      return out;
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
  if (!reusableRulerBottomCanvas) {
    reusableRulerBottomCanvas = document.createElement("canvas");
  }
  if (!reusableRulerLeftCanvas) {
    reusableRulerLeftCanvas = document.createElement("canvas");
  }

  const rulerScale = vw >= 3000 ? 1.8 : vw < 1600 ? 3.0 : 2.5;
  const bottomCanvas = renderNeutralRulerCanvas(
    fullCanvas,
    bRect.x,
    bRect.y,
    bRect.w,
    bRect.h,
    rulerScale,
    reusableRulerBottomCanvas
  );
  const leftCanvas = renderNeutralRulerCanvas(
    fullCanvas,
    lRect.x,
    lRect.y,
    lRect.w,
    lRect.h,
    rulerScale,
    reusableRulerLeftCanvas
  );

  const worker = await getRulerOcrWorker();
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
 * 1) Scans the frame (Hint-ROI first, then 2x2 coarse-to-fine) for ONLY the bright green directional player arrow.
 * 2) Reads Left (Y) & Bottom (X) grid ruler strips across all zoom levels with strip-signature caching.
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
  if (!reusableFullCanvas) {
    reusableFullCanvas = document.createElement("canvas");
  }
  const fullCanvas = reusableFullCanvas;
  if (fullCanvas.width !== vw) fullCanvas.width = vw;
  if (fullCanvas.height !== vh) fullCanvas.height = vh;
  const fullCtx = fullCanvas.getContext("2d", { willReadFrequently: true });
  if (!fullCtx) {
    return { match: null, rawText: "", arrow: null, mapOpenDetected: false };
  }
  fullCtx.drawImage(source, 0, 0, vw, vh);
  const fullImg = fullCtx.getImageData(0, 0, vw, vh);

  const now = Date.now();
  const activeHint =
    lastArrowCenterHint &&
    lastArrowCenterHint.vw === vw &&
    lastArrowCenterHint.vh === vh &&
    now - lastArrowCenterHint.ts < 2500
      ? { x: lastArrowCenterHint.x, y: lastArrowCenterHint.y }
      : null;

  // 1. Scan for player's lime-green chevron arrow (square-proof & fast)
  const arrow = detectGreenPlayerArrow(fullImg, vw, vh, activeHint);
  if (arrow) {
    lastArrowCenterHint = { x: arrow.cx, y: arrow.cy, vw, vh, ts: now };
  }

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

  let activeBRect = fullBRect;
  let activeLRect = fullLRect;
  let fitX: AxisFit | null = null;
  let fitY: AxisFit | null = null;
  let holdMapMode = false;
  let fullScreenRulersLocked = false;

  const tryFullMapRulers = async (): Promise<boolean> => {
    const sig = sampleRulerPairSignature(fullImg, vw, fullBRect, fullLRect);
    if (
      cachedFullRuler &&
      cachedFullRuler.vw === vw &&
      cachedFullRuler.vh === vh &&
      now - cachedFullRuler.ts < 2500 &&
      signaturesMatch(sig, cachedFullRuler.sig, 2.2, 18)
    ) {
      fitX = cachedFullRuler.fitX;
      fitY = cachedFullRuler.fitY;
      activeBRect = fullBRect;
      activeLRect = fullLRect;
      return true;
    }
    const res = await scanRulerAxesPair(fullCanvas, vw, fullBRect, fullLRect);
    if (res.fitX && res.fitY && res.fitX.inliers >= 2 && res.fitY.inliers >= 2) {
      fitX = res.fitX;
      fitY = res.fitY;
      activeBRect = fullBRect;
      activeLRect = fullLRect;
      cachedFullRuler = { vw, vh, sig, fitX: res.fitX, fitY: res.fitY, ts: now };
      lastLockedMapMode = "full";
      return true;
    }
    return false;
  };

  const tryHoldMapRulers = async (): Promise<boolean> => {
    const sig = sampleRulerPairSignature(fullImg, vw, holdBRect, holdLRect);
    if (
      cachedHoldRuler &&
      cachedHoldRuler.vw === vw &&
      cachedHoldRuler.vh === vh &&
      now - cachedHoldRuler.ts < 2500 &&
      signaturesMatch(sig, cachedHoldRuler.sig, 2.2, 18)
    ) {
      fitX = cachedHoldRuler.fitX;
      fitY = cachedHoldRuler.fitY;
      activeBRect = holdBRect;
      activeLRect = holdLRect;
      holdMapMode = true;
      return true;
    }
    const res = await scanRulerAxesPair(fullCanvas, vw, holdBRect, holdLRect);
    if (res.fitX && res.fitY) {
      fitX = res.fitX;
      fitY = res.fitY;
      activeBRect = holdBRect;
      activeLRect = holdLRect;
      holdMapMode = true;
      cachedHoldRuler = { vw, vh, sig, fitX: res.fitX, fitY: res.fitY, ts: now };
      lastLockedMapMode = "hold";
      return true;
    }
    return false;
  };

  // 2. Only calibrate map rulers when green arrow is visible (or check cached full ruler if arrow scrolled off-screen)
  if (arrow) {
    const canBeHoldMap =
      arrow.cx >= vw * 0.56 && arrow.cy >= vh * 0.1 && arrow.cy <= vh * 0.92;
    const preferHoldFirst = canBeHoldMap && lastLockedMapMode === "hold";

    if (preferHoldFirst) {
      const holdOk = await tryHoldMapRulers();
      if (!holdOk) {
        fullScreenRulersLocked = await tryFullMapRulers();
      }
    } else {
      fullScreenRulersLocked = await tryFullMapRulers();
      if (!fullScreenRulersLocked && canBeHoldMap) {
        await tryHoldMapRulers();
      }
    }
  } else if (
    cachedFullRuler &&
    cachedFullRuler.vw === vw &&
    cachedFullRuler.vh === vh &&
    now - cachedFullRuler.ts < 2500 &&
    signaturesMatch(
      sampleRulerPairSignature(fullImg, vw, fullBRect, fullLRect),
      cachedFullRuler.sig,
      2.2,
      18
    )
  ) {
    // Instant 0ms recognition that full map is still open while arrow panned out of view
    fitX = cachedFullRuler.fitX;
    fitY = cachedFullRuler.fitY;
    fullScreenRulersLocked = true;
  }

  const mapOpenDetected = Boolean(
    (fitX && fitX.inliers >= 2) || (fitY && fitY.inliers >= 2)
  );

  // 3. Read Top HUD Compass whenever full-screen Map menu is NOT covering it (in-field OR Hold-M)
  let compassHeading: {
    headingDeg: number;
    compassLabel: string;
    rawText: string;
    cropRect?: { sx: number; sy: number; sw: number; sh: number };
  } | null = null;
  if (options?.trackCompass && !fullScreenRulersLocked) {
    if (now - lastCompassOcrRunAt >= 260 || (arrow && holdMapMode)) {
      lastCompassOcrRunAt = now;
      compassHeading = await scanTopCompassHeading(fullCanvas, vw, vh, fullImg);
    } else if (cachedCompass && now - cachedCompass.ts < 1500) {
      compassHeading = cachedCompass.result;
    }
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
