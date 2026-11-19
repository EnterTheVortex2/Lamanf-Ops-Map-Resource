import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  Compass,
  Crosshair,
  Eye,
  Grid3X3,
  KeyRound,
  Layers,
  LocateFixed,
  MapPin,
  Monitor,
  Navigation,
  Pencil,
  Radio,
  Ruler,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  BLUE_CRATES_05,
  CHEMICAL_AREAS_05,
  DISASSEMBLY_SPAWNS_05,
  FACTIONS,
  formatGridSquare,
  LAMANG_DIRECT_TILE_URL,
  LAMANG_POIS,
  LAMANG_TILE_URL,
  MAP_EXTENT,
  parseGridInputToMeters,
  type CustomMapPin,
  type FactionId,
  type LamangPoi,
  type MapLayerKey,
} from "../config/mapConfig";
import {
  isStaticHostingEnvironment,
  type ItemSpawnLookupResult,
  type NormalizedApiRecord,
} from "../services/gzwApi";
import {
  resolveSpawnPointsForMaterial,
  type CatalogMaterial,
} from "../utils/catalogBuilder";
import type { GzwKeyDoorDef } from "../utils/keyBuilder";
import {
  SCAN_PRESETS,
  scanVideoFrameForLamangCoords,
  terminateCoordOcrWorker,
  type CropRectPct,
  type ScanRegionPreset,
} from "../utils/screenCoordOcr";
import type { GzwTaskDef } from "../utils/taskBuilder";
import { ItemThumbnail } from "./ItemThumbnail";

interface NavEndpoint {
  x: number;
  y: number;
  label: string;
  grid: string;
  kind: "live" | "lz" | "cop" | "fob" | "task" | "key" | "poi" | "pin" | "point";
}

interface LivePlayerPosition {
  x: number;
  y: number;
  grid: string;
  source: "ocr" | "manual";
  updatedAt: number;
}

interface TacticalMapPanelProps {
  catalog: CatalogMaterial[];
  customPins: CustomMapPin[];
  onAddPin: (pin: CustomMapPin) => void;
  onUpdatePin: (pin: CustomMapPin) => void;
  onRemovePin: (pinId: string) => void;
  tickedMapMaterials: Record<string, boolean>;
  onToggleMapMaterial: (matKey: string, visible: boolean) => void;
  inspectedMaterial: CatalogMaterial | null;
  inspectedLookup: ItemSpawnLookupResult | null;
  isLookupLoading: boolean;
  onCloseInspect: () => void;
  inspectedTask: GzwTaskDef | null;
  onCloseInspectTask: () => void;
  onSelectTask?: (task: GzwTaskDef) => void;
  allTasks?: GzwTaskDef[];
  selectedFaction: FactionId;
  activeOperatorName?: string;
  glanceMode?: boolean;
  onToggleGlanceMode?: (force?: boolean) => void;
  keysList?: GzwKeyDoorDef[];
  ownedKeys?: Record<string, boolean>;
  onToggleOwnedKey?: (keyId: string) => void;
  inspectedKey?: GzwKeyDoorDef | null;
  onSelectKey?: (keyDef: GzwKeyDoorDef) => void;
  onCloseInspectKey?: () => void;
  onSelectMaterial?: (mat: CatalogMaterial) => void;
  completedTasks?: Record<string, boolean>;
  onToggleTaskComplete?: (taskId: string) => void;
  apiRecords: NormalizedApiRecord[];
  pinDropMode: boolean;
  onTogglePinDropMode: (force?: boolean) => void;
  preselectedPinMaterialId: string;
  onNotify: (msg: string) => void;
  layoutTrigger: string;
  isResizing?: boolean;
}

const toLatLng = (x: number, y: number): L.LatLng =>
  L.CRS.EPSG3857.unproject(L.point(x, y));

const fromLatLng = (ll: L.LatLng): { x: number; y: number } => {
  const p = L.CRS.EPSG3857.project(ll);
  return { x: Math.round(p.x), y: Math.round(p.y) };
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createTargetPinIcon(color: string, labelGlyph: string, pulse = false): L.DivIcon {
  const size = pulse ? 22 : 16;
  const half = size / 2;
  return L.divIcon({
    className: "gzw-map-label",
    html: `<div style="
      width:${size}px;
      height:${size}px;
      border-radius:9999px;
      background:rgba(8, 11, 16, 0.92);
      border:1.5px solid ${color};
      color:${color};
      display:flex;
      align-items:center;
      justify-content:center;
      font-family:'JetBrains Mono',monospace;
      font-size:${pulse ? "10px" : "8px"};
      font-weight:700;
      box-shadow:0 0 ${pulse ? "14px" : "6px"} ${color}88;
    ">${labelGlyph}</div>`,
    iconSize: [size, size],
    iconAnchor: [half, half],
  });
}

function createDotIcon(color: string, size = 8): L.DivIcon {
  const half = size / 2;
  return L.divIcon({
    className: "gzw-map-label",
    html: `<div style="
      width:${size}px;
      height:${size}px;
      border-radius:2px;
      background:${color};
      border:1px solid rgba(5, 8, 12, 0.9);
      box-shadow:0 1px 4px rgba(0, 0, 0, 0.85);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [half, half],
  });
}

function formatBearing(dx: number, dy: number): string {
  // Note: y increases northwards in EPSG:3857
  const rad = Math.atan2(dx, dy);
  const deg = ((rad * 180) / Math.PI + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const card = dirs[Math.round(deg / 45) % 8];
  return `${Math.round(deg).toString().padStart(3, "0")}° ${card}`;
}

export function TacticalMapPanel({
  catalog,
  customPins,
  onAddPin,
  onUpdatePin,
  onRemovePin,
  tickedMapMaterials,
  onToggleMapMaterial,
  inspectedMaterial,
  inspectedLookup,
  isLookupLoading,
  onCloseInspect,
  inspectedTask,
  onCloseInspectTask,
  onSelectTask,
  allTasks = [],
  selectedFaction,
  activeOperatorName = "Operator 1",
  glanceMode = false,
  onToggleGlanceMode,
  keysList = [],
  ownedKeys = {},
  onToggleOwnedKey,
  inspectedKey = null,
  onSelectKey,
  onCloseInspectKey,
  onSelectMaterial,
  completedTasks = {},
  onToggleTaskComplete,
  apiRecords,
  pinDropMode,
  onTogglePinDropMode,
  preselectedPinMaterialId,
  onNotify,
  layoutTrigger,
  isResizing = false,
}: TacticalMapPanelProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const taskPinsLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const keyFocusLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const measureLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const navRouteLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const playerPosLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const layersRef = useRef<Record<MapLayerKey, L.LayerGroup>>({
    gridOverlay: L.layerGroup(),
    blueCrates: L.layerGroup(),
    pcSpawns: L.layerGroup(),
    chemicalAreas: L.layerGroup(),
    disassemblySpawns: L.layerGroup(),
    lockedDoors: L.layerGroup(),
    tickedSpawns: L.layerGroup(),
    apiLoot: L.layerGroup(),
    customPins: L.layerGroup(),
    poiLabels: L.layerGroup(),
    subLocations: L.layerGroup(),
    copsAndLzs: L.layerGroup(),
  });

  const [layerVisibility, setLayerVisibility] = useState<Record<MapLayerKey, boolean>>({
    gridOverlay: true,
    blueCrates: true,
    pcSpawns: true,
    chemicalAreas: false,
    disassemblySpawns: false,
    lockedDoors: true,
    tickedSpawns: true,
    apiLoot: false,
    customPins: true,
    poiLabels: true,
    subLocations: true,
    copsAndLzs: true,
  });

  const [layersOpen, setLayersOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [pinsDrawerOpen, setPinsDrawerOpen] = useState(false);
  const [pinsFilterTab, setPinsFilterTab] = useState<"user" | "all">("user");
  const [mapSearchQuery, setMapSearchQuery] = useState("");
  const [mapSearchOpen, setMapSearchOpen] = useState(false);
  const [inspectedPoi, setInspectedPoi] = useState<LamangPoi | null>(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<
    { x: number; y: number; grid: string }[]
  >([]);
  const [cursorCoords, setCursorCoords] = useState({ x: 7000, y: 4200 });
  const [zoomLevel, setZoomLevel] = useState(14);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [capturedCoords, setCapturedCoords] = useState<{ x: number; y: number } | null>(null);
  const [editingPin, setEditingPin] = useState<CustomMapPin | null>(null);
  const [repositioningPin, setRepositioningPin] = useState(false);
  const [pinMaterialId, setPinMaterialId] = useState("");
  const [pinLayer, setPinLayer] = useState<"customPins" | "blueCrates" | "pcSpawns">("customPins");
  const [pinNote, setPinNote] = useState("");
  const [mapLightbox, setMapLightbox] = useState<{ src: string; title: string } | null>(null);

  // Monitor 2 Compass Bearing Lock & Live Operator Tracking ("You Are Here")
  const [navOrigin, setNavOrigin] = useState<NavEndpoint | null>(null);
  const [navTarget, setNavTarget] = useState<NavEndpoint | null>(null);
  const [originLockedManually, setOriginLockedManually] = useState(false);
  const [originPickerOpen, setOriginPickerOpen] = useState(false);
  const [livePlayerPos, setLivePlayerPos] = useState<LivePlayerPosition | null>(null);
  const [manualPosMode, setManualPosMode] = useState(false);
  const [manualGridInput, setManualGridInput] = useState("");

  // Browser Screen-Watcher (getDisplayMedia + Local OCR)
  const [screenSyncPanelOpen, setScreenSyncPanelOpen] = useState(false);
  const [screenSyncActive, setScreenSyncActive] = useState(false);
  const [scanPreset, setScanPreset] = useState<ScanRegionPreset>("bottom-right");
  const [customCrop, setCustomCrop] = useState<CropRectPct>(
    SCAN_PRESETS["bottom-right"].rect
  );
  const [autoFollowLive, setAutoFollowLive] = useState(true);
  const [scanIntervalMs, setScanIntervalMs] = useState(1200);
  const [ocrStatusText, setOcrStatusText] = useState(
    "Ready — 100% local in-browser scan"
  );
  const [lastOcrRawText, setLastOcrRawText] = useState("");
  const [screenSyncError, setScreenSyncError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const isScanningRef = useRef(false);
  const autoFollowLiveRef = useRef(autoFollowLive);
  autoFollowLiveRef.current = autoFollowLive;
  const livePlayerPosRef = useRef(livePlayerPos);
  livePlayerPosRef.current = livePlayerPos;
  const manualPosModeRef = useRef(manualPosMode);
  manualPosModeRef.current = manualPosMode;

  const markerByPinIdRef = useRef<Map<string, L.Marker>>(new Map());
  const pendingFocusPinRef = useRef<{ id: string; moved: boolean } | null>(null);
  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  useEffect(() => {
    if (preselectedPinMaterialId && !editingPin) {
      setPinMaterialId(preselectedPinMaterialId);
    }
  }, [preselectedPinMaterialId, editingPin]);

  const pinDropModeRef = useRef(pinDropMode);
  pinDropModeRef.current = pinDropMode;
  const measureModeRef = useRef(measureMode);
  measureModeRef.current = measureMode;
  const repositioningPinRef = useRef(repositioningPin);
  repositioningPinRef.current = repositioningPin;

  const stopScreenSync = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    isScanningRef.current = false;
    setScreenSyncActive(false);
    setOcrStatusText("Stopped — local OCR worker closed");
    terminateCoordOcrWorker();
  }, []);

  useEffect(() => {
    return () => {
      stopScreenSync();
    };
  }, [stopScreenSync]);

  const runSingleOcrScan = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || isScanningRef.current) return;
    isScanningRef.current = true;
    try {
      const activeRect =
        scanPreset === "custom" ? customCrop : SCAN_PRESETS[scanPreset].rect;
      const { match, rawText } = await scanVideoFrameForLamangCoords(
        video,
        activeRect,
        previewCanvasRef.current
      );
      if (rawText) setLastOcrRawText(rawText);
      if (match) {
        const prev = livePlayerPosRef.current;
        const moved = !prev || prev.grid !== match.grid;
        setLivePlayerPos({
          x: match.x,
          y: match.y,
          grid: match.grid,
          source: "ocr",
          updatedAt: Date.now(),
        });
        setOcrStatusText(`Synced Grid ${match.grid}`);
        if (moved && autoFollowLiveRef.current && mapRef.current) {
          mapRef.current.panTo(toLatLng(match.x, match.y), { animate: true });
        }
      } else {
        setOcrStatusText("Watching stream — open GZW map (M) to sync grid");
      }
    } catch {
      setOcrStatusText("OCR busy — retrying next tick");
    } finally {
      isScanningRef.current = false;
    }
  }, [scanPreset, customCrop]);

  useEffect(() => {
    if (!screenSyncActive) return;
    const t0 = setTimeout(() => {
      void runSingleOcrScan();
    }, 300);
    const id = setInterval(() => {
      void runSingleOcrScan();
    }, scanIntervalMs);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  }, [screenSyncActive, scanIntervalMs, runSingleOcrScan]);

  const startScreenSync = async () => {
    setScreenSyncError(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getDisplayMedia
    ) {
      setScreenSyncError(
        "Screen capture is unavailable in this browser context. Requires Chrome/Edge/Firefox on HTTPS or localhost."
      );
      return;
    }

    try {
      stopScreenSync();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 4, max: 6 } },
        audio: false,
      });
      mediaStreamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.addEventListener("ended", () => {
          stopScreenSync();
          onNotify("Screen Sync stopped");
        });
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScreenSyncActive(true);
      setOcrStatusText("Watching captured screen locally...");
      onNotify("Screen Sync active — tap M in-game anytime to sync position");
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Screen capture permission cancelled."
          : "Could not start screen capture. Make sure you allow window/screen access.";
      setScreenSyncError(msg);
      stopScreenSync();
    }
  };

  const handleApplyManualGridPos = (rawInput: string) => {
    const parsed = parseGridInputToMeters(rawInput);
    if (!parsed) {
      onNotify("Enter a valid 3-digit grid square, e.g. 174 142");
      return;
    }
    setLivePlayerPos({
      x: parsed.x,
      y: parsed.y,
      grid: parsed.grid,
      source: "manual",
      updatedAt: Date.now(),
    });
    mapRef.current?.flyTo(toLatLng(parsed.x, parsed.y), 16, { duration: 0.55 });
    onNotify(`Marked your position at Grid ${parsed.grid}`);
  };

  const lockBearingTo = (
    target: { x: number; y: number; label: string; kind: NavEndpoint["kind"] },
    explicitOrigin?: NavEndpoint
  ) => {
    const targetEndpoint: NavEndpoint = {
      ...target,
      grid: formatGridSquare(target.x, target.y),
    };
    setOriginLockedManually(Boolean(explicitOrigin));
    let nextOrigin: NavEndpoint | null = explicitOrigin || null;

    if (!nextOrigin) {
      const live = livePlayerPosRef.current;
      if (live) {
        nextOrigin = {
          x: live.x,
          y: live.y,
          label: "You Are Here",
          grid: live.grid,
          kind: "live",
        };
      } else {
        const closestLz = LAMANG_POIS.filter((p) => p.kind === "lz")
          .map((lz) => ({
            lz,
            dist: Math.hypot(lz.x - target.x, lz.y - target.y),
          }))
          .sort((a, b) => a.dist - b.dist)[0]?.lz;
        if (closestLz) {
          nextOrigin = {
            x: closestLz.x,
            y: closestLz.y,
            label: `LZ ${closestLz.lz}`,
            grid: formatGridSquare(closestLz.x, closestLz.y),
            kind: "lz",
          };
        }
      }
    }

    setNavOrigin(nextOrigin);
    setNavTarget(targetEndpoint);
    setOriginPickerOpen(false);
    if (nextOrigin) {
      const b = formatBearing(
        targetEndpoint.x - nextOrigin.x,
        targetEndpoint.y - nextOrigin.y
      );
      const dist = Math.round(
        Math.hypot(
          targetEndpoint.x - nextOrigin.x,
          targetEndpoint.y - nextOrigin.y
        )
      );
      onNotify(`Bearing locked: HEAD ${b} · ${dist}m to ${targetEndpoint.label}`);
    }
  };

  const handleLockExfilNearestLz = () => {
    const startPt = livePlayerPosRef.current
      ? {
          x: livePlayerPosRef.current.x,
          y: livePlayerPosRef.current.y,
          label: "You Are Here",
          grid: livePlayerPosRef.current.grid,
          kind: "live" as const,
        }
      : navTarget || navOrigin;
    if (!startPt) {
      onNotify("Set your position or lock an objective first to calculate Exfil");
      return;
    }
    const closestLz = LAMANG_POIS.filter((p) => p.kind === "lz")
      .map((lz) => ({
        lz,
        dist: Math.hypot(lz.x - startPt.x, lz.y - startPt.y),
      }))
      .sort((a, b) => a.dist - b.dist)[0]?.lz;
    if (!closestLz) return;

    const exfilTarget: NavEndpoint = {
      x: closestLz.x,
      y: closestLz.y,
      label: `Exfil LZ ${closestLz.lz}`,
      grid: formatGridSquare(closestLz.x, closestLz.y),
      kind: "lz",
    };
    setOriginLockedManually(false);
    setNavOrigin(startPt);
    setNavTarget(exfilTarget);
    setOriginPickerOpen(false);
    const b = formatBearing(exfilTarget.x - startPt.x, exfilTarget.y - startPt.y);
    onNotify(`Exfil vector: HEAD ${b} to LZ ${closestLz.lz}`);
  };

  const startEditingPin = (pin: CustomMapPin) => {
    setEditingPin(pin);
    setCapturedCoords({ x: pin.x, y: pin.y });
    setPinMaterialId(pin.materialId || "");
    setPinLayer(pin.layer);
    setPinNote(pin.label);
    setRepositioningPin(false);
    setLayersOpen(false);
    setJumpOpen(false);
    setMapSearchOpen(false);
    setScreenSyncPanelOpen(false);
  };
  const startEditingPinRef = useRef(startEditingPin);
  startEditingPinRef.current = startEditingPin;

  const openZoneBriefing = (poi: LamangPoi) => {
    onCloseInspect();
    onCloseInspectTask();
    onCloseInspectKey?.();
    setInspectedPoi(poi);
    setMapSearchOpen(false);
    setJumpOpen(false);
    setLayersOpen(false);
    setScreenSyncPanelOpen(false);
  };

  const fitIslandView = () => {
    mapRef.current?.fitBounds(
      L.latLngBounds(toLatLng(2800, 850), toLatLng(11200, 7300)),
      { animate: true }
    );
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const maxBounds = L.latLngBounds(
      toLatLng(MAP_EXTENT.minX - 1800, MAP_EXTENT.minY - 1200),
      toLatLng(MAP_EXTENT.maxX + 1800, MAP_EXTENT.maxY + 1200)
    );

    const map = L.map(mapContainerRef.current, {
      crs: L.CRS.EPSG3857,
      minZoom: 13.5,
      maxZoom: 19,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 70,
      maxBounds,
      maxBoundsViscosity: 0.9,
      attributionControl: false,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomleft" }).addTo(map);

    let disposed = false;
    const attachTileLayer = (tileUrl: string) => {
      if (disposed) return;
      L.tileLayer(tileUrl, {
        minZoom: 13.5,
        maxZoom: 19,
        minNativeZoom: 14,
        maxNativeZoom: 19,
        tileSize: 256,
        bounds: L.latLngBounds(toLatLng(0, 0), toLatLng(14000, 8000)),
        keepBuffer: 4,
      }).addTo(map);
    };

    if (isStaticHostingEnvironment()) {
      attachTileLayer(LAMANG_DIRECT_TILE_URL);
    } else {
      fetch("/api/gzw/health", { signal: AbortSignal.timeout(1200) })
        .then((res) => {
          const ct = res.headers.get("content-type") || "";
          attachTileLayer(
            res.ok && ct.includes("application/json")
              ? LAMANG_TILE_URL
              : LAMANG_DIRECT_TILE_URL
          );
        })
        .catch(() => {
          attachTileLayer(LAMANG_DIRECT_TILE_URL);
        });
    }

    map.fitBounds(L.latLngBounds(toLatLng(2800, 850), toLatLng(11200, 7300)));
    setZoomLevel(map.getZoom());

    (Object.keys(layersRef.current) as MapLayerKey[]).forEach((key) => {
      layersRef.current[key].addTo(map);
    });
    taskPinsLayerRef.current.addTo(map);
    keyFocusLayerRef.current.addTo(map);
    measureLayerRef.current.addTo(map);
    navRouteLayerRef.current.addTo(map);
    playerPosLayerRef.current.addTo(map);

    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      setCursorCoords(fromLatLng(e.latlng));
    });

    map.on("zoomend", () => {
      setZoomLevel(map.getZoom());
      setViewportVersion((v) => v + 1);
    });

    map.on("moveend", () => {
      setViewportVersion((v) => v + 1);
    });

    map.on("resize", () => {
      setViewportVersion((v) => v + 1);
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      setLayersOpen(false);
      setJumpOpen(false);
      setMapSearchOpen(false);
      setOriginPickerOpen(false);

      const { x, y } = fromLatLng(e.latlng);
      const grid = formatGridSquare(x, y);

      if (manualPosModeRef.current) {
        setLivePlayerPos({
          x,
          y,
          grid,
          source: "manual",
          updatedAt: Date.now(),
        });
        setManualPosMode(false);
        onNotify(`Set Your Position at Grid ${grid}`);
        return;
      }

      if (measureModeRef.current) {
        setMeasurePoints((prev) =>
          prev.length >= 2 ? [{ x, y, grid }] : [...prev, { x, y, grid }]
        );
        return;
      }

      if (repositioningPinRef.current) {
        setCapturedCoords({ x, y });
        setRepositioningPin(false);
        onNotify(`Moved pin position to Grid ${grid} (${x}, ${y})`);
        return;
      }

      if (!pinDropModeRef.current) return;
      setEditingPin(null);
      setPinNote("");
      setPinLayer("customPins");
      setCapturedCoords({ x, y });
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(`${x}, ${y}`).catch(() => {});
      }
      onNotify(`Captured Grid ${grid} (${x}, ${y})`);
    });

    mapRef.current = map;

    return () => {
      disposed = true;
      map.remove();
      mapRef.current = null;
    };
  }, [onNotify]);

  // Keep Leaflet sizing accurate when switching mobile views, Glance Mode, or dragging split divider
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      mapRef.current?.invalidateSize({ animate: false });
      setViewportVersion((v) => v + 1);
    });
    const t = setTimeout(() => {
      mapRef.current?.invalidateSize({ animate: false });
      setViewportVersion((v) => v + 1);
    }, 140);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [layoutTrigger]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (Object.keys(layersRef.current) as MapLayerKey[]).forEach((key) => {
      const group = layersRef.current[key];
      if (layerVisibility[key]) {
        if (!map.hasLayer(group)) group.addTo(map);
      } else {
        if (map.hasLayer(group)) map.removeLayer(group);
      }
    });
  }, [layerVisibility]);

  // Render crisp 100m In-Game Grid Lines & Coordinate Labels strictly inside visible padded viewport
  useEffect(() => {
    const map = mapRef.current;
    const gridGroup = layersRef.current.gridOverlay;
    gridGroup.clearLayers();
    if (!map || !layerVisibility.gridOverlay) return;

    const bounds = map.getBounds();
    const sw = fromLatLng(bounds.getSouthWest());
    const ne = fromLatLng(bounds.getNorthEast());

    const pad = zoomLevel >= 16.5 ? 400 : zoomLevel >= 15 ? 800 : 1500;
    const step = zoomLevel >= 15 ? 100 : zoomLevel >= 14.5 ? 500 : 1000;

    const minX = Math.max(
      MAP_EXTENT.minX,
      Math.floor((sw.x - pad) / step) * step
    );
    const maxX = Math.min(
      MAP_EXTENT.maxX,
      Math.ceil((ne.x + pad) / step) * step
    );
    const minY = Math.max(
      MAP_EXTENT.minY,
      Math.floor((sw.y - pad) / step) * step
    );
    const maxY = Math.min(
      MAP_EXTENT.maxY,
      Math.ceil((ne.y + pad) / step) * step
    );

    if (maxX <= minX || maxY <= minY) return;

    for (let x = minX; x <= maxX; x += step) {
      const isMajor = x % 500 === 0;
      L.polyline([toLatLng(x, minY), toLatLng(x, maxY)], {
        color: isMajor ? "#e5a93c" : "#cbd5e1",
        weight: isMajor ? 1.2 : 0.8,
        opacity: isMajor ? 0.3 : zoomLevel >= 15 ? 0.18 : 0.2,
        interactive: false,
      }).addTo(gridGroup);
    }

    for (let y = minY; y <= maxY; y += step) {
      const isMajor = y % 500 === 0;
      L.polyline([toLatLng(minX, y), toLatLng(maxX, y)], {
        color: isMajor ? "#e5a93c" : "#cbd5e1",
        weight: isMajor ? 1.2 : 0.8,
        opacity: isMajor ? 0.3 : zoomLevel >= 15 ? 0.18 : 0.2,
        interactive: false,
      }).addTo(gridGroup);
    }

    // Non-blocking grid square labels (1000m overview -> 500m -> 200m -> every 100m square at close zoom)
    const labelStep =
      zoomLevel >= 17.5
        ? 100
        : zoomLevel >= 16.5
          ? 200
          : zoomLevel >= 14.5
            ? 500
            : 1000;
    const startLX = Math.max(MAP_EXTENT.minX, Math.floor(Math.max(sw.x, 0) / labelStep) * labelStep);
    const endLX = Math.min(MAP_EXTENT.maxX - 100, Math.ceil(Math.min(ne.x, MAP_EXTENT.maxX) / labelStep) * labelStep);
    const startLY = Math.max(MAP_EXTENT.minY, Math.floor(Math.max(sw.y, 0) / labelStep) * labelStep);
    const endLY = Math.min(MAP_EXTENT.maxY - 100, Math.ceil(Math.min(ne.y, MAP_EXTENT.maxY) / labelStep) * labelStep);

    let labelCount = 0;
    for (let x = startLX; x <= endLX && labelCount < 200; x += labelStep) {
      for (let y = startLY; y <= endLY && labelCount < 200; y += labelStep) {
        labelCount += 1;
        const gridStr = formatGridSquare(x + 10, y + 10);
        L.marker(toLatLng(x + 10, y + 88), {
          interactive: false,
          keyboard: false,
          zIndexOffset: 50,
          icon: L.divIcon({
            className: "gzw-grid-coord-label",
            html: `<div style="
              pointer-events:none;
              font-family:'JetBrains Mono',monospace;
              font-size:${zoomLevel >= 15 ? "9.5px" : "10px"};
              font-weight:600;
              color:rgba(241, 245, 249, ${zoomLevel >= 15 ? "0.56" : "0.42"});
              text-shadow:0 1px 3px rgba(0,0,0,0.95);
              white-space:nowrap;
            ">${gridStr}</div>`,
            iconSize: [0, 0],
          }),
        }).addTo(gridGroup);
      }
    }
  }, [zoomLevel, viewportVersion, layerVisibility.gridOverlay]);

  // Effective Origin (auto-follows Live Position unless user explicitly picked an FOB/LZ origin)
  const effectiveNavOrigin = useMemo<NavEndpoint | null>(() => {
    if (!navTarget) return null;
    if (livePlayerPos && (!originLockedManually || navOrigin?.kind === "live")) {
      return {
        x: livePlayerPos.x,
        y: livePlayerPos.y,
        label: "You Are Here",
        grid: livePlayerPos.grid,
        kind: "live",
      };
    }
    if (navOrigin) return navOrigin;
    if (livePlayerPos) {
      return {
        x: livePlayerPos.x,
        y: livePlayerPos.y,
        label: "You Are Here",
        grid: livePlayerPos.grid,
        kind: "live",
      };
    }
    return null;
  }, [navOrigin, navTarget, livePlayerPos, originLockedManually]);

  const activeNavTelemetry = useMemo(() => {
    if (!effectiveNavOrigin || !navTarget) return null;
    const dx = navTarget.x - effectiveNavOrigin.x;
    const dy = navTarget.y - effectiveNavOrigin.y;
    const dist = Math.round(Math.hypot(dx, dy));
    const bearing = formatBearing(dx, dy);
    const deg = Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360);
    const sprintSec = Math.round(dist / 6.2);
    const etaLabel =
      sprintSec >= 60
        ? `~${Math.floor(sprintSec / 60)}m ${sprintSec % 60}s`
        : `~${sprintSec}s`;
    return { dx, dy, dist, bearing, deg, etaLabel };
  }, [effectiveNavOrigin, navTarget]);

  // Render Live Operator Beacon ("You Are Here")
  useEffect(() => {
    const layer = playerPosLayerRef.current;
    layer.clearLayers();
    if (!livePlayerPos) return;

    const ll = toLatLng(livePlayerPos.x, livePlayerPos.y);
    L.circle(ll, {
      radius: 45,
      color: "#10b981",
      weight: 1.5,
      fillColor: "#10b981",
      fillOpacity: 0.14,
      interactive: false,
    }).addTo(layer);

    const marker = L.marker(ll, {
      zIndexOffset: 980,
      icon: L.divIcon({
        className: "gzw-map-label",
        html: `<div style="
          transform:translate(-50%,-50%);
          display:flex;
          flex-direction:column;
          align-items:center;
          gap:3px;
          pointer-events:auto;
        ">
          <div style="
            padding:2px 6px;
            border-radius:6px;
            background:rgba(6, 24, 18, 0.94);
            border:1.5px solid #10b981;
            color:#6ee7b7;
            font-family:'JetBrains Mono',monospace;
            font-size:10px;
            font-weight:700;
            white-space:nowrap;
            box-shadow:0 0 14px rgba(16,185,129,0.45);
          ">YOU · ${livePlayerPos.grid}</div>
          <div style="
            width:12px;
            height:12px;
            border-radius:9999px;
            background:#10b981;
            border:2px solid #06120e;
            box-shadow:0 0 12px #10b981;
          "></div>
        </div>`,
        iconSize: [0, 0],
      }),
    });
    marker.bindPopup(`
      <div style="min-width:190px;">
        <div style="font-family:monospace;font-size:10px;color:#34d399;font-weight:700;">LIVE OPERATOR POSITION</div>
        <div style="font-weight:700;font-size:13px;margin:2px 0;">Grid ${livePlayerPos.grid}</div>
        <div style="font-size:11px;color:#94a3b8;">Source: ${livePlayerPos.source === "ocr" ? "Screen Sync OCR" : "Manual Map / Grid"}</div>
      </div>
    `);
    marker.addTo(layer);
  }, [livePlayerPos]);

  // Render Compass Bearing Lock Route Vector
  useEffect(() => {
    const layer = navRouteLayerRef.current;
    layer.clearLayers();
    if (!effectiveNavOrigin || !navTarget || !activeNavTelemetry) return;

    const aLl = toLatLng(effectiveNavOrigin.x, effectiveNavOrigin.y);
    const bLl = toLatLng(navTarget.x, navTarget.y);

    // Outer dark casing + glowing amber dashed vector
    L.polyline([aLl, bLl], {
      color: "#05080d",
      weight: 5.5,
      opacity: 0.78,
      interactive: false,
    }).addTo(layer);

    L.polyline([aLl, bLl], {
      color: "#e5a93c",
      weight: 2.5,
      dashArray: "9 6",
      opacity: 0.96,
      interactive: false,
    }).addTo(layer);

    // Midpoint directional arrow + distance badge
    const midX = (effectiveNavOrigin.x + navTarget.x) / 2;
    const midY = (effectiveNavOrigin.y + navTarget.y) / 2;
    L.marker(toLatLng(midX, midY), {
      interactive: false,
      zIndexOffset: 940,
      icon: L.divIcon({
        className: "gzw-map-label",
        html: `<div style="
          transform:translate(-50%,-50%);
          display:inline-flex;
          align-items:center;
          gap:6px;
          white-space:nowrap;
          background:rgba(11, 15, 22, 0.94);
          border:1px solid #e5a93c;
          color:#fde68a;
          padding:3px 8px;
          border-radius:6px;
          font-family:'JetBrains Mono',monospace;
          font-size:10.5px;
          font-weight:700;
          box-shadow:0 4px 14px rgba(0,0,0,0.85);
        ">
          <svg width="11" height="11" viewBox="0 0 12 12" style="transform:rotate(${activeNavTelemetry.deg}deg);flex-shrink:0;">
            <path d="M6 1L10.5 10.5L6 8.2L1.5 10.5Z" fill="#e5a93c"/>
          </svg>
          <span>${activeNavTelemetry.bearing} · ${activeNavTelemetry.dist}m</span>
        </div>`,
        iconSize: [0, 0],
      }),
    }).addTo(layer);

    // Origin ring & Target ring
    L.marker(aLl, {
      interactive: false,
      zIndexOffset: 920,
      icon: createTargetPinIcon("#38bdf8", "S", false),
    }).addTo(layer);

    L.marker(bLl, {
      interactive: false,
      zIndexOffset: 930,
      icon: createTargetPinIcon("#e5a93c", "◎", true),
    }).addTo(layer);
  }, [effectiveNavOrigin, navTarget, activeNavTelemetry]);

  const inspectedSpawnPoints = useMemo(() => {
    if (!inspectedMaterial) return [];
    const extraNotes =
      inspectedLookup?.foundIn.map((f) => `${f.source} ${f.table}`) || [];
    return resolveSpawnPointsForMaterial(inspectedMaterial, customPins, extraNotes);
  }, [inspectedMaterial, inspectedLookup, customPins]);

  useEffect(() => {
    if (inspectedMaterial && inspectedSpawnPoints.length > 0 && mapRef.current) {
      const first = inspectedSpawnPoints[0];
      mapRef.current.flyTo(toLatLng(first.x, first.y), 16, { duration: 0.65 });
    }
  }, [inspectedMaterial, inspectedSpawnPoints]);

  // Render & fly to inspected Vendor Task POIs + exact Grid waypoints
  useEffect(() => {
    const layer = taskPinsLayerRef.current;
    layer.clearLayers();
    if (!inspectedTask) return;

    inspectedTask.matchedPois.forEach((poi) => {
      const marker = L.marker(toLatLng(poi.x, poi.y), {
        icon: createTargetPinIcon("#38bdf8", "T", true),
        zIndexOffset: 800,
      });
      marker.bindPopup(`
        <div style="min-width:210px;">
          <div style="font-family:monospace;font-size:10px;color:#38bdf8;font-weight:700;">${escapeHtml(inspectedTask.vendor)} · ${escapeHtml(inspectedTask.category)}</div>
          <div style="font-weight:700;font-size:13px;margin:2px 0;">${escapeHtml(inspectedTask.name)}</div>
          <div style="font-size:11px;color:#cbd5e1;">AO: ${escapeHtml(poi.name)} (${escapeHtml(poi.tier)})</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Nearest LZ: ${escapeHtml(poi.lz)}</div>
          <div style="font-family:monospace;font-size:10px;color:#e5a93c;margin-top:4px;">Grid ${formatGridSquare(poi.x, poi.y)}</div>
        </div>
      `);
      marker.addTo(layer);
    });

    inspectedTask.exactCoords.forEach((coord, idx) => {
      const marker = L.marker(toLatLng(coord.x, coord.y), {
        icon: createTargetPinIcon("#e5a93c", `${idx + 1}`, true),
        zIndexOffset: 900,
      });
      marker.bindPopup(`
        <div style="min-width:210px;">
          <div style="font-family:monospace;font-size:10px;color:#e5a93c;font-weight:700;">TASK OBJECTIVE WAYPOINT #${idx + 1}</div>
          <div style="font-weight:700;font-size:13px;margin:2px 0;">${escapeHtml(inspectedTask.name)}</div>
          <div style="font-size:11px;color:#cbd5e1;">${escapeHtml(coord.label)}</div>
          <div style="font-family:monospace;font-size:10px;color:#38bdf8;margin-top:4px;">Exact Grid ${escapeHtml(coord.grid)}</div>
        </div>
      `);
      marker.addTo(layer);
    });

    if (mapRef.current) {
      if (inspectedTask.exactCoords.length > 0) {
        const firstCoord = inspectedTask.exactCoords[0];
        mapRef.current.flyTo(toLatLng(firstCoord.x, firstCoord.y), 16.5, { duration: 0.65 });
      } else if (inspectedTask.matchedPois.length > 0) {
        const starterTown =
          selectedFaction !== "ALL"
            ? FACTIONS[selectedFaction].starterTown
            : null;
        const preferred =
          (starterTown &&
            inspectedTask.matchedPois.find(
              (p) =>
                p.name === starterTown || p.parentRegion === starterTown
            )) ||
          inspectedTask.matchedPois[0];
        mapRef.current.flyTo(toLatLng(preferred.x, preferred.y), 16, { duration: 0.65 });
      } else {
        fitIslandView();
      }
    }
  }, [inspectedTask, selectedFaction]);

  // Render & fly to inspected Key / Locked Door
  useEffect(() => {
    const layer = keyFocusLayerRef.current;
    layer.clearLayers();
    if (!inspectedKey) return;

    const marker = L.marker(toLatLng(inspectedKey.x, inspectedKey.y), {
      icon: createTargetPinIcon(
        inspectedKey.kind === "Keycard" ? "#38bdf8" : "#e5a93c",
        "K",
        true
      ),
      zIndexOffset: 920,
    });
    marker.bindPopup(`
      <div style="min-width:205px;">
        <div style="font-family:monospace;font-size:10px;color:#e5a93c;font-weight:700;">${escapeHtml(inspectedKey.kind.toUpperCase())} · LOCKED DOOR</div>
        <div style="font-weight:700;font-size:13px;margin:2px 0;">${escapeHtml(inspectedKey.name)}</div>
        <div style="font-size:11px;color:#cbd5e1;">${escapeHtml(inspectedKey.usage)}</div>
        <div style="font-family:monospace;font-size:10px;color:#38bdf8;margin-top:4px;">Grid ${escapeHtml(inspectedKey.grid)} · ${escapeHtml(inspectedKey.sublocation || inspectedKey.region)}</div>
      </div>
    `);
    marker.addTo(layer);

    if (mapRef.current) {
      mapRef.current.flyTo(toLatLng(inspectedKey.x, inspectedKey.y), 17, {
        duration: 0.65,
      });
    }
  }, [inspectedKey]);

  // Render Distance & Bearing Measure Line
  useEffect(() => {
    const layer = measureLayerRef.current;
    layer.clearLayers();
    if (measurePoints.length === 0) return;

    measurePoints.forEach((pt, idx) => {
      L.marker(toLatLng(pt.x, pt.y), {
        icon: createTargetPinIcon("#38bdf8", idx === 0 ? "A" : "B", false),
        zIndexOffset: 950,
      }).addTo(layer);
    });

    if (measurePoints.length === 2) {
      const [a, b] = measurePoints;
      const dist = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
      const bearing = formatBearing(b.x - a.x, b.y - a.y);
      const sprintSec = Math.round(dist / 6.2);
      const sprintLabel =
        sprintSec >= 60
          ? `~${Math.floor(sprintSec / 60)}m ${sprintSec % 60}s`
          : `~${sprintSec}s`;

      L.polyline([toLatLng(a.x, a.y), toLatLng(b.x, b.y)], {
        color: "#38bdf8",
        weight: 2.5,
        dashArray: "6 6",
        opacity: 0.9,
      }).addTo(layer);

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      L.marker(toLatLng(midX, midY), {
        icon: L.divIcon({
          className: "gzw-map-label",
          html: `<div style="
            transform:translate(-50%,-50%);
            white-space:nowrap;
            background:rgba(10,14,20,0.94);
            border:1px solid #38bdf8;
            color:#eef3f8;
            padding:3px 8px;
            border-radius:4px;
            font-family:'JetBrains Mono',monospace;
            font-size:10px;
            font-weight:700;
            box-shadow:0 4px 12px rgba(0,0,0,0.75);
          ">${dist} m · ${bearing} · ${sprintLabel}</div>`,
          iconSize: [0, 0],
        }),
        zIndexOffset: 960,
      }).addTo(layer);
    }
  }, [measurePoints]);

  // Render clean, borderless, zoom-gated Update 0.5 markers
  useEffect(() => {
    const groups = layersRef.current;
    (Object.keys(groups) as MapLayerKey[]).forEach((k) => {
      if (k !== "gridOverlay") groups[k].clearLayers();
    });

    const hasFocusedMaterial =
      !!inspectedMaterial || Object.values(tickedMapMaterials).some(Boolean);

    // 1. Primary POIs, Tier 4 Regions, Bases, Sub-Locations, COPs, LZs
    LAMANG_POIS.forEach((poi) => {
      if (zoomLevel < poi.minZoom) return;
      const ll = toLatLng(poi.x, poi.y);
      const grid = formatGridSquare(poi.x, poi.y);

      if (poi.kind === "base" || poi.kind === "tier4" || poi.kind === "major") {
        // Softly fade major region plaques when deeply zoomed into building-level detail
        const fadeAtCloseZoom = zoomLevel >= 17.5 ? 0.38 : 1;
        const isTier4 = poi.kind === "tier4";
        const isBase = poi.kind === "base";
        const isTier3 = poi.tier === "Tier 3";
        const isExclusionCenter = poi.id === "poi-ground-zero";
        const activeFactionInfo =
          selectedFaction !== "ALL" ? FACTIONS[selectedFaction] : null;
        const isOwnFob = Boolean(
          isBase && activeFactionInfo && poi.id === activeFactionInfo.baseId
        );
        const isRivalFob = Boolean(
          isBase && activeFactionInfo && poi.id !== activeFactionInfo.baseId
        );

        const borderColor = isExclusionCenter
          ? "rgba(239, 68, 68, 0.35)"
          : isOwnFob && activeFactionInfo
            ? activeFactionInfo.color
            : isTier4
              ? "rgba(248, 113, 113, 0.55)"
              : isBase
                ? "rgba(96, 165, 250, 0.45)"
                : isTier3
                  ? "rgba(229, 169, 60, 0.52)"
                  : "rgba(203, 213, 225, 0.28)";

        const dotColor = isOwnFob && activeFactionInfo
          ? activeFactionInfo.color
          : isTier4
            ? "#ef4444"
            : isBase
              ? "#60a5fa"
              : isTier3
                ? "#e5a93c"
                : "#94a3b8";

        const titleColor = isExclusionCenter
          ? "#fca5a5"
          : isOwnFob
            ? "#ffffff"
            : isTier4
              ? "#fee2e2"
              : isBase
                ? "#dbeafe"
                : "#f8fafc";

        const tierColor = isOwnFob && activeFactionInfo
          ? activeFactionInfo.color
          : isTier4
            ? "#fca5a5"
            : isBase
              ? "#93c5fd"
              : isTier3
                ? "#fbbf24"
                : "#cbd5e1";

        const tierText = isOwnFob ? "YOUR FOB" : poi.tier;
        const plaqueOpacity = isRivalFob
          ? Math.min(fadeAtCloseZoom, 0.48)
          : fadeAtCloseZoom;

        const overviewOffsetTransform =
          zoomLevel < 14.5
            ? poi.name === "Hunter's Paradise"
              ? "translate(-100%, -92%)"
              : poi.name === "Midnight Sapphire"
                ? "translate(-10%, -18%)"
                : poi.name === "Sawmill"
                  ? "translate(-100%, -95%)"
                  : poi.name === "RLSL-1 Radio Observatory"
                    ? "translate(-26%, 16%)"
                    : "translate(-50%, -50%)"
            : "translate(-50%, -50%)";

        const marker = L.marker(ll, {
          zIndexOffset: isOwnFob ? 360 : isTier4 ? 320 : isBase ? 260 : 280,
          icon: L.divIcon({
            className: "gzw-map-label",
            html: isExclusionCenter
              ? `<div class="gzw-text-shadow" style="
                  transform: translate(-50%, -50%);
                  text-align: center;
                  white-space: nowrap;
                  opacity: ${zoomLevel >= 16 ? 0.5 : 0.85};
                  cursor: pointer;
                ">
                  <div style="
                    font-family: 'Outfit', system-ui, sans-serif;
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.06em;
                    color: ${titleColor};
                  ">${escapeHtml(poi.name)}</div>
                  <div style="
                    font-family: 'Manrope', system-ui, sans-serif;
                    font-size: 9.5px;
                    font-weight: 600;
                    color: #f87171;
                  ">Exclusion Zone</div>
                </div>`
              : `<div class="gzw-poi-plaque" style="
                  display: inline-flex;
                  align-items: center;
                  gap: 6px;
                  transform: ${overviewOffsetTransform};
                  white-space: nowrap;
                  opacity: ${plaqueOpacity};
                  padding: ${zoomLevel < 14.5 ? "2.5px 7.5px" : "4px 10px"};
                  border-radius: 8px;
                  background: rgba(9, 13, 20, 0.88);
                  backdrop-filter: blur(6px);
                  border: 1px solid ${borderColor};
                  box-shadow: ${isOwnFob ? `0 0 18px ${dotColor}55, 0 4px 16px rgba(0,0,0,0.85)` : "0 4px 16px rgba(0, 0, 0, 0.82)"};
                  cursor: pointer;
                ">
                  <span style="
                    width: 6px;
                    height: 6px;
                    border-radius: 9999px;
                    background: ${dotColor};
                    box-shadow: 0 0 8px ${dotColor};
                    flex-shrink: 0;
                  "></span>
                  <span style="
                    font-family: 'Outfit', system-ui, sans-serif;
                    font-size: ${zoomLevel < 14.5 ? (isTier4 ? "11.5px" : "11px") : isTier4 ? "13px" : "12.5px"};
                    font-weight: 600;
                    letter-spacing: 0.01em;
                    color: ${titleColor};
                    line-height: 1.15;
                  ">${escapeHtml(poi.name)}</span>
                  <span style="
                    font-family: 'Manrope', system-ui, sans-serif;
                    font-size: 10px;
                    font-weight: 600;
                    color: ${tierColor};
                    padding-left: 5px;
                    border-left: 1px solid rgba(255, 255, 255, 0.14);
                    line-height: 1.1;
                  ">${escapeHtml(tierText)}</span>
                </div>`,
            iconSize: [0, 0],
          }),
        });

        marker.on("click", () => openZoneBriefing(poi));
        marker.addTo(groups.poiLabels);
      } else if (poi.kind === "sublocation") {
        // High-legibility micro-plaques when zoomed in so compounds never merge into terrain
        const opacity = hasFocusedMaterial && zoomLevel < 17 ? 0.65 : 0.96;
        const isT4Sub = poi.tier === "Tier 4";
        const dotColor = isT4Sub ? "#f87171" : "#38bdf8";
        const borderColor = isT4Sub
          ? "rgba(248, 113, 113, 0.42)"
          : "rgba(148, 163, 184, 0.34)";
        const textColor = isT4Sub ? "#fee2e2" : "#f1f5f9";

        const marker = L.marker(ll, {
          zIndexOffset: 240,
          icon: L.divIcon({
            className: "gzw-map-label",
            html: `<div class="gzw-subpoi-chip" style="
              display: inline-flex;
              align-items: center;
              gap: 6px;
              transform: translate(-8px, -50%);
              white-space: nowrap;
              opacity: ${opacity};
              padding: 3px 8px;
              border-radius: 7px;
              background: rgba(9, 13, 20, 0.88);
              backdrop-filter: blur(5px);
              border: 1px solid ${borderColor};
              box-shadow: 0 3px 12px rgba(0, 0, 0, 0.8);
              cursor: pointer;
            ">
              <span style="
                width: 6px;
                height: 6px;
                border-radius: 9999px;
                background: ${dotColor};
                box-shadow: 0 0 6px ${dotColor};
                flex-shrink: 0;
              "></span>
              <span style="
                font-family: 'Manrope', system-ui, sans-serif;
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.01em;
                color: ${textColor};
              ">${escapeHtml(poi.name)}</span>
            </div>`,
            iconSize: [0, 0],
          }),
        });
        marker.on("click", () => openZoneBriefing(poi));
        marker.addTo(groups.subLocations);
      } else if (poi.kind === "cop") {
        const shortName = poi.name.replace(/^Outpost\s+/i, "");
        const marker = L.marker(ll, {
          zIndexOffset: 210,
          icon: L.divIcon({
            className: "gzw-map-label",
            html: `<div style="
              display: inline-flex;
              align-items: center;
              gap: 5px;
              transform: translate(-7px, -50%);
              white-space: nowrap;
              padding: 2px 7px;
              border-radius: 6px;
              background: rgba(9, 14, 22, 0.84);
              backdrop-filter: blur(4px);
              border: 1px solid rgba(56, 189, 248, 0.34);
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.72);
              cursor: pointer;
            ">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M6 1.5L11 10.5H1L6 1.5Z" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5"/>
              </svg>
              <span style="
                font-family: 'Manrope', system-ui, sans-serif;
                font-size: 10px;
                font-weight: 600;
                color: #bae6fd;
              ">${escapeHtml(shortName)}</span>
            </div>`,
            iconSize: [0, 0],
          }),
        });
        marker.on("click", () => openZoneBriefing(poi));
        marker.addTo(groups.copsAndLzs);
      } else if (poi.kind === "lz") {
        const marker = L.marker(ll, {
          zIndexOffset: 200,
          icon: L.divIcon({
            className: "gzw-map-label",
            html: `<div style="
              display: inline-flex;
              align-items: center;
              gap: 5px;
              transform: translate(-6px, -50%);
              white-space: nowrap;
              padding: 2px 7px;
              border-radius: 6px;
              background: rgba(10, 14, 20, 0.82);
              backdrop-filter: blur(4px);
              border: 1px solid rgba(234, 179, 8, 0.36);
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.72);
              cursor: pointer;
            ">
              <span style="
                width: 7px;
                height: 7px;
                transform: rotate(45deg);
                background: #eab308;
                border: 1px solid #090d12;
                flex-shrink: 0;
              "></span>
              <span style="
                font-family: 'Manrope', system-ui, sans-serif;
                font-size: 10px;
                font-weight: 700;
                color: #fde047;
              ">${escapeHtml(poi.lz)}</span>
            </div>`,
            iconSize: [0, 0],
          }),
        });
        marker.on("click", () => openZoneBriefing(poi));
        marker.addTo(groups.copsAndLzs);
      }
    });

    // 2. Blue-Planked Building Material Crates (95 exact spawns — shown cleanly on zoom >= 15)
    if (zoomLevel >= 15) {
      BLUE_CRATES_05.forEach((crate) => {
        const marker = L.marker(toLatLng(crate.x, crate.y), {
          icon: createDotIcon("#3b82f6", zoomLevel >= 16.5 ? 10 : 7),
        });
        marker.bindPopup(
          `<div style="min-width:185px;">
            <div style="font-size:10px;font-family:monospace;color:#60a5fa;font-weight:700;">BLUE-PLANKED MATERIAL CRATE</div>
            <div style="font-size:13px;font-weight:600;margin-top:2px;">${escapeHtml(crate.poi)}</div>
            <div style="font-size:11px;color:#cbd5e1;margin-top:2px;">Plastics · Steel · Wood · Plumbing · Construction</div>
            <div style="font-family:monospace;font-size:10px;color:#94a3b8;margin-top:4px;">Grid ${formatGridSquare(crate.x, crate.y)} · ${crate.x}, ${crate.y}</div>
          </div>`
        );
        marker.addTo(groups.blueCrates);
      });
    }

    // 3. Chemicals Supplies Areas (19 exact spawns)
    CHEMICAL_AREAS_05.forEach((chem) => {
      const marker = L.marker(toLatLng(chem.x, chem.y), {
        icon: createTargetPinIcon("#a855f7", "C"),
      });
      marker.bindPopup(
        `<div style="min-width:185px;">
          <div style="font-size:10px;font-family:monospace;color:#c084fc;font-weight:700;">CHEMICALS SUPPLIES AREA</div>
          <div style="font-size:13px;font-weight:600;margin-top:2px;">${escapeHtml(chem.poi)}</div>
          <div style="font-family:monospace;font-size:10px;color:#94a3b8;margin-top:4px;">Grid ${formatGridSquare(chem.x, chem.y)} · ${chem.x}, ${chem.y}</div>
        </div>`
      );
      marker.addTo(groups.chemicalAreas);
    });

    // 4. Disassembly Items (54 exact spawns — UNLRA Field Terminal, IMSI Catcher, Containers, etc.)
    DISASSEMBLY_SPAWNS_05.forEach((dis) => {
      const marker = L.marker(toLatLng(dis.x, dis.y), {
        icon: createTargetPinIcon("#f97316", "D"),
      });
      marker.bindPopup(
        `<div style="min-width:190px;">
          <div style="font-size:10px;font-family:monospace;color:#fb923c;font-weight:700;">DISASSEMBLY ITEM SPAWN</div>
          <div style="font-size:13px;font-weight:600;margin-top:2px;">${escapeHtml(dis.name)}</div>
          <div style="font-size:11px;color:#cbd5e1;margin-top:2px;">Region: ${escapeHtml(dis.poi)}</div>
          <div style="font-family:monospace;font-size:10px;color:#94a3b8;margin-top:4px;">Grid ${formatGridSquare(dis.x, dis.y)} · ${dis.x}, ${dis.y}</div>
        </div>`
      );
      marker.addTo(groups.disassemblySpawns);
    });

    // 5. PC Part Spawns & Custom Pins
    markerByPinIdRef.current.clear();
    customPins.forEach((pin) => {
      if (pin.layer === "pcSpawns" && zoomLevel < 14.5 && !hasFocusedMaterial) {
        return;
      }
      const style =
        pin.layer === "blueCrates"
          ? { color: "#3b82f6", glyph: "B", title: "Blue-Planked Crate" }
          : pin.layer === "pcSpawns"
            ? { color: "#06b6d4", glyph: "PC", title: "PC / Tech Spawn" }
            : { color: "#10b981", glyph: "+", title: "Custom Recon Pin" };

      const linkedMat = catalog.find(
        (m) => m.id === pin.materialId || m.key === pin.materialId
      );

      const popupEl = document.createElement("div");
      popupEl.style.minWidth = "205px";
      popupEl.innerHTML = `
        <div style="font-size:10px;font-family:monospace;color:${style.color};font-weight:700;">${style.title}</div>
        <div style="font-weight:600;font-size:13px;margin:3px 0;">${escapeHtml(pin.label)}</div>
        ${linkedMat ? `<div style="font-size:11px;color:#cbd5e1;">Material: ${escapeHtml(linkedMat.name)}</div>` : ""}
        <div style="font-family:monospace;font-size:10px;color:#94a3b8;margin-top:4px;">Grid ${formatGridSquare(pin.x, pin.y)} · ${pin.x}, ${pin.y}</div>
      `;

      const actionsEl = document.createElement("div");
      actionsEl.style.cssText =
        "display:flex;align-items:center;gap:6px;margin-top:9px;";

      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit Pin";
      editBtn.style.cssText =
        "flex:1;background:#111d2e;border:1px solid #38bdf8;color:#7dd3fc;padding:4px 8px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;";
      editBtn.onclick = (ev) => {
        ev.stopPropagation();
        mapRef.current?.closePopup();
        startEditingPinRef.current(pin);
      };

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "Delete";
      removeBtn.style.cssText =
        "background:#261215;border:1px solid #ef4444;color:#fca5a5;padding:4px 8px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;";
      removeBtn.onclick = (ev) => {
        ev.stopPropagation();
        mapRef.current?.closePopup();
        onRemovePin(pin.id);
      };

      actionsEl.appendChild(editBtn);
      actionsEl.appendChild(removeBtn);
      popupEl.appendChild(actionsEl);

      const marker = L.marker(toLatLng(pin.x, pin.y), {
        icon: createTargetPinIcon(style.color, style.glyph),
      }).bindPopup(popupEl);

      markerByPinIdRef.current.set(pin.id, marker);
      marker.addTo(groups[pin.layer] || groups.customPins);
      if (
        pendingFocusPinRef.current?.id === pin.id &&
        pendingFocusPinRef.current.moved
      ) {
        pendingFocusPinRef.current = null;
        setTimeout(() => {
          marker.openPopup();
        }, 30);
      }
    });

    // 6. Ticked / Inspected Hideout Material Spawns (Bright pulsing amber focus)
    const groupedSpawns = new Map<
      string,
      { x: number; y: number; title: string; items: { name: string; note: string }[] }
    >();

    const activeMaterialsToPlot = catalog.filter(
      (m) => tickedMapMaterials[m.key] || inspectedMaterial?.key === m.key
    );

    activeMaterialsToPlot.forEach((mat) => {
      const pts = resolveSpawnPointsForMaterial(mat, customPins);
      pts.forEach((pt) => {
        const key = `${pt.x},${pt.y}`;
        if (!groupedSpawns.has(key)) {
          groupedSpawns.set(key, {
            x: pt.x,
            y: pt.y,
            title: pt.title,
            items: [],
          });
        }
        groupedSpawns.get(key)!.items.push({
          name: mat.name,
          note: pt.source,
        });
      });
    });

    groupedSpawns.forEach((spot) => {
      const marker = L.marker(toLatLng(spot.x, spot.y), {
        icon: createTargetPinIcon("#e5a93c", "★", true),
        zIndexOffset: 700,
      });
      marker.bindPopup(`
        <div style="min-width:210px;">
          <div style="font-family:monospace;font-size:10px;color:#e5a93c;font-weight:700;">REPORTED MATERIAL SPAWN</div>
          <div style="font-weight:700;font-size:13px;margin:3px 0 6px;">${escapeHtml(spot.title)}</div>
          <div style="font-family:monospace;font-size:10px;color:#38bdf8;margin-bottom:6px;">Grid ${formatGridSquare(spot.x, spot.y)} · ${spot.x}, ${spot.y}</div>
          ${spot.items
            .map(
              (item) => `
              <div style="font-size:11px;margin-bottom:4px;">
                <span style="color:#7dd3fc;font-weight:600;">• ${escapeHtml(item.name)}</span>
                <span style="color:#94a3b8;font-size:10px;"> (${escapeHtml(item.note)})</span>
              </div>`
            )
            .join("")}
        </div>
      `);
      marker.addTo(groups.tickedSpawns);
    });

    // 7. Locked Door / Key Compound Clusters (zoom >= 15)
    if (zoomLevel >= 15 && keysList.length > 0) {
      const groupedKeys = new Map<
        string,
        { x: number; y: number; place: string; keys: GzwKeyDoorDef[] }
      >();
      keysList.forEach((kd) => {
        const coordKey = `${kd.x},${kd.y}`;
        if (!groupedKeys.has(coordKey)) {
          groupedKeys.set(coordKey, {
            x: kd.x,
            y: kd.y,
            place: kd.sublocation || kd.region,
            keys: [],
          });
        }
        groupedKeys.get(coordKey)!.keys.push(kd);
      });

      groupedKeys.forEach((cluster) => {
        const hasKeycard = cluster.keys.some((k) => k.kind === "Keycard");
        const countLabel =
          cluster.keys.length > 1 ? `K${cluster.keys.length}` : "K";
        const marker = L.marker(toLatLng(cluster.x, cluster.y), {
          icon: createTargetPinIcon(
            hasKeycard ? "#38bdf8" : "#f59e0b",
            countLabel,
            false
          ),
          zIndexOffset: 550,
        });
        marker.on("click", () => {
          if (cluster.keys.length === 1 && onSelectKey) {
            setInspectedPoi(null);
            onSelectKey(cluster.keys[0]);
          } else {
            const matchedPoi = LAMANG_POIS.find(
              (p) => p.x === cluster.x && p.y === cluster.y
            );
            if (matchedPoi) {
              openZoneBriefing(matchedPoi);
            } else if (onSelectKey) {
              setInspectedPoi(null);
              onSelectKey(cluster.keys[0]);
            }
          }
        });
        marker.addTo(groups.lockedDoors);
      });
    }

    // 8. API records with coordinates
    apiRecords.forEach((rec) => {
      if (!rec.coords) return;
      const marker = L.marker(toLatLng(rec.coords.x, rec.coords.y), {
        icon: createTargetPinIcon("#f59e0b", "!"),
      });
      marker.bindPopup(`
        <div style="min-width:170px;">
          <div style="font-family:monospace;font-size:10px;color:#f59e0b;">${escapeHtml(rec.dataset)}</div>
          <div style="font-weight:600;font-size:13px;margin:2px 0;">${escapeHtml(rec.name)}</div>
          ${rec.description ? `<div style="font-size:11px;color:#94a3b8;">${escapeHtml(rec.description)}</div>` : ""}
        </div>
      `);
      marker.addTo(groups.apiLoot);
    });
  }, [catalog, customPins, tickedMapMaterials, inspectedMaterial, apiRecords, keysList, onRemovePin, zoomLevel, selectedFaction]);

  const activeFactionInfo =
    selectedFaction !== "ALL" ? FACTIONS[selectedFaction] : null;

  const quickJumpPois = useMemo(() => {
    const list = LAMANG_POIS.filter(
      (p) =>
        ((p.kind === "tier4" || p.kind === "major") &&
          p.id !== "poi-ground-zero") ||
        (activeFactionInfo && p.id === activeFactionInfo.baseId)
    );
    const tierOrder = (p: LamangPoi) => {
      if (activeFactionInfo && p.id === activeFactionInfo.baseId) return -2;
      if (activeFactionInfo && p.name === activeFactionInfo.starterTown) return -1;
      if (p.tier === "Tier 4") return 0;
      if (p.tier === "Tier 3") return 1;
      if (p.tier === "Tier 2") return 2;
      return 3;
    };
    return list.sort((a, b) => tierOrder(a) - tierOrder(b) || a.name.localeCompare(b.name));
  }, [activeFactionInfo]);

  const activeLayerCount = useMemo(
    () => Object.values(layerVisibility).filter(Boolean).length,
    [layerVisibility]
  );

  // Instant Map Quick Search across Grid Coordinates, POIs, COPs, LZs & Keys
  const mapSearchResults = useMemo(() => {
    const raw = mapSearchQuery.trim();
    if (!raw) return { gridJump: null as ReturnType<typeof parseGridInputToMeters>, pois: [] as LamangPoi[], keys: [] as GzwKeyDoorDef[] };
    const gridJump = parseGridInputToMeters(raw);
    const q = raw.toLowerCase();
    const pois = LAMANG_POIS.filter(
      (p) =>
        p.id !== "poi-ground-zero" &&
        (p.name.toLowerCase().includes(q) ||
          p.lz.toLowerCase().includes(q) ||
          (p.parentRegion || "").toLowerCase().includes(q))
    ).slice(0, 7);
    const keys = keysList
      .filter(
        (k) =>
          k.name.toLowerCase().includes(q) ||
          k.doorTarget.toLowerCase().includes(q) ||
          k.region.toLowerCase().includes(q)
      )
      .slice(0, 5);
    return { gridJump, pois, keys };
  }, [mapSearchQuery, keysList]);

  // Precomputed Zone Intel for directly clicked POIs/Compounds/COPs/LZs
  const zoneIntel = useMemo(() => {
    if (!inspectedPoi) return null;
    const regionName =
      inspectedPoi.kind === "major" || inspectedPoi.kind === "tier4"
        ? inspectedPoi.name
        : inspectedPoi.parentRegion || inspectedPoi.name;

    const nearestLzs = LAMANG_POIS.filter((p) => p.kind === "lz")
      .map((p) => ({
        poi: p,
        dist: Math.round(
          Math.hypot(p.x - inspectedPoi.x, p.y - inspectedPoi.y)
        ),
        bearing: formatBearing(p.x - inspectedPoi.x, p.y - inspectedPoi.y),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 4);

    const nearestCops = LAMANG_POIS.filter((p) => p.kind === "cop")
      .map((p) => ({
        poi: p,
        dist: Math.round(
          Math.hypot(p.x - inspectedPoi.x, p.y - inspectedPoi.y)
        ),
        bearing: formatBearing(p.x - inspectedPoi.x, p.y - inspectedPoi.y),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);

    const nearbyKeys = keysList.filter(
      (k) =>
        k.region.toLowerCase() === regionName.toLowerCase() ||
        (k.sublocation || "").toLowerCase() === inspectedPoi.name.toLowerCase() ||
        Math.hypot(k.x - inspectedPoi.x, k.y - inspectedPoi.y) < 350
    );

    const zoneTasks = allTasks.filter((t) =>
      t.areas.some(
        (a) =>
          a.toLowerCase() === regionName.toLowerCase() ||
          a.toLowerCase() === inspectedPoi.name.toLowerCase()
      )
    );

    const cratesNearby = BLUE_CRATES_05.filter(
      (c) =>
        c.poi.toLowerCase().includes(regionName.toLowerCase()) ||
        Math.hypot(c.x - inspectedPoi.x, c.y - inspectedPoi.y) < 600
    ).length;

    const disassemblyNearby = DISASSEMBLY_SPAWNS_05.filter(
      (d) =>
        d.poi.toLowerCase().includes(regionName.toLowerCase()) ||
        Math.hypot(d.x - inspectedPoi.x, d.y - inspectedPoi.y) < 600
    );

    const chemicalsNearby = CHEMICAL_AREAS_05.filter(
      (c) =>
        c.poi.toLowerCase().includes(regionName.toLowerCase()) ||
        Math.hypot(c.x - inspectedPoi.x, c.y - inspectedPoi.y) < 600
    ).length;

    const matchingMaterials = catalog
      .filter((m) =>
        inspectedPoi.tags.some(
          (tag) =>
            m.name.toLowerCase().includes(tag) ||
            tag.includes(m.name.toLowerCase())
        )
      )
      .slice(0, 8);

    const flightFromFob =
      activeFactionInfo && inspectedPoi.id !== activeFactionInfo.baseId
        ? {
            fobName: activeFactionInfo.short,
            dist: Math.round(
              Math.hypot(
                inspectedPoi.x - activeFactionInfo.x,
                inspectedPoi.y - activeFactionInfo.y
              )
            ),
            bearing: formatBearing(
              inspectedPoi.x - activeFactionInfo.x,
              inspectedPoi.y - activeFactionInfo.y
            ),
          }
        : null;

    return {
      regionName,
      nearestLzs,
      nearestCops,
      nearbyKeys,
      zoneTasks,
      cratesNearby,
      disassemblyNearby,
      chemicalsNearby,
      matchingMaterials,
      flightFromFob,
    };
  }, [inspectedPoi, keysList, allTasks, catalog, activeFactionInfo]);

  const userDroppedPins = useMemo(
    () =>
      customPins
        .filter((p) => !p.id.startsWith("seed-"))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [customPins]
  );

  const seedCustomPins = useMemo(
    () => customPins.filter((p) => p.id.startsWith("seed-")),
    [customPins]
  );

  const visibleDrawerPins =
    pinsFilterTab === "user" ? userDroppedPins : [...userDroppedPins, ...seedCustomPins];

  const closePinModal = () => {
    setCapturedCoords(null);
    setEditingPin(null);
    setRepositioningPin(false);
  };

  const handleSavePin = () => {
    if (!capturedCoords) return;
    const linked = catalog.find(
      (m) => m.id === pinMaterialId || m.key === pinMaterialId
    );
    const nextLabel = pinNote.trim() || linked?.name || "Recon Pin";

    if (editingPin) {
      onUpdatePin({
        ...editingPin,
        x: capturedCoords.x,
        y: capturedCoords.y,
        layer: pinLayer,
        materialId: pinMaterialId,
        label: nextLabel,
      });
    } else {
      onAddPin({
        id: `pin_${Date.now()}`,
        x: capturedCoords.x,
        y: capturedCoords.y,
        layer: pinLayer,
        materialId: pinMaterialId,
        label: nextLabel,
        createdAt: Date.now(),
      });
      onNotify(
        `Saved pin at Grid ${formatGridSquare(capturedCoords.x, capturedCoords.y)}`
      );
    }

    setPinNote("");
    closePinModal();
  };

  const handleDeletePinById = (pinId: string) => {
    if (editingPin?.id === pinId) {
      closePinModal();
    }
    onRemovePin(pinId);
  };

  const focusPinOnMap = (pin: CustomMapPin) => {
    const needsLayerEnable = !layerVisibility[pin.layer];
    if (needsLayerEnable) {
      setLayerVisibility((prev) => ({ ...prev, [pin.layer]: true }));
    }
    if (typeof window !== "undefined" && window.innerWidth < 640) {
      setPinsDrawerOpen(false);
    }
    const map = mapRef.current;
    if (!map) return;

    const targetLl = toLatLng(pin.x, pin.y);
    const alreadyCentered =
      map.distance(map.getCenter(), targetLl) < 20 &&
      Math.abs(map.getZoom() - 17) < 0.01 &&
      !needsLayerEnable;

    if (alreadyCentered) {
      const m = markerByPinIdRef.current.get(pin.id);
      if (m) {
        m.openPopup();
        return;
      }
    }

    pendingFocusPinRef.current = { id: pin.id, moved: false };
    const onMoveEnd = () => {
      if (pendingFocusPinRef.current?.id !== pin.id) return;
      pendingFocusPinRef.current.moved = true;
      if (Math.abs(map.getZoom() - zoomLevelRef.current) < 0.01) {
        const m = markerByPinIdRef.current.get(pin.id);
        if (m) {
          pendingFocusPinRef.current = null;
          setTimeout(() => {
            m.openPopup();
          }, 30);
        }
      }
    };
    map.once("moveend", onMoveEnd);
    map.flyTo(targetLl, 17, { duration: 0.45 });
  };

  return (
    <section className="relative flex-1 h-full min-h-0 bg-[#06090d] overflow-hidden">
      {/* Floating Map Toolbar + Flowing Left/Right Drawers */}
      <div className="absolute top-2.5 left-2.5 right-2.5 z-[725] flex flex-col gap-2 pointer-events-none">
        {/* Compact Floating Map Controls */}
        <div className="flex items-start justify-between gap-1.5 flex-wrap relative z-[740]">
          <div className="pointer-events-auto flex items-center gap-1.5 relative flex-wrap">
            {/* Quick Search (POIs, LZs, Keys, Grid 171 152) */}
            <div className="relative">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-[#7f8ea1] absolute left-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={mapSearchQuery}
                  onFocus={() => {
                    setMapSearchOpen(true);
                    setJumpOpen(false);
                    setLayersOpen(false);
                    setScreenSyncPanelOpen(false);
                  }}
                  onChange={(e) => {
                    setMapSearchQuery(e.target.value);
                    setMapSearchOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && mapSearchResults.gridJump) {
                      const g = mapSearchResults.gridJump;
                      mapRef.current?.flyTo(toLatLng(g.x, g.y), 16.5, {
                        duration: 0.65,
                      });
                      setMapSearchOpen(false);
                      onNotify(`Jumped to Grid ${g.grid}`);
                    }
                  }}
                  placeholder="Search POI, grid, or key..."
                  aria-label="Search map locations or grid"
                  className="min-h-[38px] w-40 sm:w-44 xl:w-52 pl-8 pr-7 py-1.5 rounded-lg bg-[#0d121a]/90 backdrop-blur-xl border border-white/[0.1] focus:border-[#38bdf8] text-xs text-[#eef3f8] placeholder:text-[#7a899c] shadow-xl focus:outline-none transition-colors"
                />
              {mapSearchQuery && (
                <button
                  type="button"
                  aria-label="Clear map search"
                  onClick={() => {
                    setMapSearchQuery("");
                    setMapSearchOpen(false);
                  }}
                  className="absolute right-2 text-[#7f8ea1] hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {mapSearchOpen && mapSearchQuery.trim() && (
              <div className="absolute top-full left-0 mt-1.5 w-76 max-h-80 overflow-y-auto rounded-xl bg-[#0d121a]/96 backdrop-blur-xl border border-white/[0.12] p-1.5 shadow-2xl z-[810] space-y-1">
                {mapSearchResults.gridJump && (
                  <div className="flex items-center gap-1 rounded-lg bg-[#16202e] p-1">
                    <button
                      type="button"
                      onClick={() => {
                        const g = mapSearchResults.gridJump!;
                        mapRef.current?.flyTo(toLatLng(g.x, g.y), 16.5, {
                          duration: 0.65,
                        });
                        setMapSearchOpen(false);
                        onNotify(`Centered on Grid ${g.grid}`);
                      }}
                      className="flex-1 text-left px-2 py-1.5 rounded hover:bg-[#1d2a3c] flex items-center justify-between gap-2 text-xs text-[#7dd3fc]"
                    >
                      <span className="font-medium">
                        Go to Grid {mapSearchResults.gridJump.grid}
                      </span>
                      <span className="font-mono-tabular text-[10px]">
                        {mapSearchResults.gridJump.x}, {mapSearchResults.gridJump.y}
                      </span>
                    </button>
                    <button
                      type="button"
                      title="Lock bearing to this grid"
                      onClick={() => {
                        const g = mapSearchResults.gridJump!;
                        lockBearingTo({
                          x: g.x,
                          y: g.y,
                          label: `Grid ${g.grid}`,
                          kind: "point",
                        });
                        setMapSearchOpen(false);
                      }}
                      className="px-2 py-1.5 rounded bg-[#e5a93c]/15 border border-[#e5a93c]/40 text-[#e5a93c] hover:bg-[#e5a93c]/25 text-[10px] font-semibold shrink-0"
                    >
                      Lock
                    </button>
                  </div>
                )}

                {mapSearchResults.pois.map((poi) => (
                  <div
                    key={poi.id}
                    className="flex items-center gap-1 rounded-lg hover:bg-white/[0.06] pr-1"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        mapRef.current?.flyTo(
                          toLatLng(poi.x, poi.y),
                          poi.kind === "sublocation" ? 17 : 16,
                          { duration: 0.65 }
                        );
                        openZoneBriefing(poi);
                      }}
                      className="flex-1 min-w-0 text-left px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="text-[#eef3f8] font-medium truncate">
                          {poi.name}
                        </div>
                        <div className="text-[11px] text-[#8392a6] truncate">
                          {poi.kind === "lz"
                            ? `Landing Zone · ${poi.faction}`
                            : poi.kind === "cop"
                              ? `Combat Outpost · ${poi.parentRegion || "Lamang"}`
                              : `${poi.tier}${poi.parentRegion ? ` · ${poi.parentRegion}` : ""}`}
                        </div>
                      </div>
                      <span className="font-mono-tabular text-[10px] text-[#e5a93c] shrink-0">
                        {formatGridSquare(poi.x, poi.y)}
                      </span>
                    </button>
                    <button
                      type="button"
                      title={`Lock bearing to ${poi.name}`}
                      onClick={() => {
                        lockBearingTo({
                          x: poi.x,
                          y: poi.y,
                          label: poi.name,
                          kind: "poi",
                        });
                        setMapSearchOpen(false);
                      }}
                      className="p-1.5 rounded text-[#8b98a9] hover:text-[#e5a93c] shrink-0"
                    >
                      <Compass className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                {mapSearchResults.keys.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => {
                      setInspectedPoi(null);
                      setMapSearchOpen(false);
                      onSelectKey?.(k);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="text-[#fde68a] font-medium truncate">
                        {k.name}
                      </div>
                      <div className="text-[11px] text-[#8392a6] truncate">
                        {k.doorTarget} · {k.region}
                      </div>
                    </div>
                    <span className="font-mono-tabular text-[10px] text-[#38bdf8] shrink-0">
                      {k.grid}
                    </span>
                  </button>
                ))}

                {!mapSearchResults.gridJump &&
                  mapSearchResults.pois.length === 0 &&
                  mapSearchResults.keys.length === 0 && (
                    <div className="px-2.5 py-3 text-center text-xs text-[#7f8ea1]">
                      No locations, keys, or grids matched.
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* Region Quick-Jump Popover (Hidden in Glance Mode to reduce clutter) */}
          {!glanceMode && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setJumpOpen((v) => !v);
                  setLayersOpen(false);
                  setMapSearchOpen(false);
                  setScreenSyncPanelOpen(false);
                }}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-[#0d121a]/90 backdrop-blur-xl border border-white/[0.1] hover:border-white/[0.22] text-xs font-medium text-[#e2e9f2] shadow-xl transition-colors"
              >
                <Navigation className="w-3.5 h-3.5 text-[#e5a93c]" />
                <span className="hidden md:inline">Regions</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#7f8ea1]" />
              </button>

              {jumpOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-64 max-h-72 overflow-y-auto rounded-xl bg-[#0d121a]/96 backdrop-blur-xl border border-white/[0.12] p-1.5 shadow-2xl z-[800]">
                  {quickJumpPois.map((poi) => {
                    const isOwnFob =
                      activeFactionInfo && poi.id === activeFactionInfo.baseId;
                    const isStarter =
                      activeFactionInfo && poi.name === activeFactionInfo.starterTown;
                    return (
                      <button
                        key={poi.id}
                        type="button"
                        onClick={() => {
                          mapRef.current?.flyTo(toLatLng(poi.x, poi.y), 16, { duration: 0.65 });
                          openZoneBriefing(poi);
                        }}
                        className="w-full min-h-[36px] text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] flex items-center justify-between gap-2 text-xs transition-colors"
                      >
                        <span className="text-[#eef3f8] font-medium truncate">{poi.name}</span>
                        <span
                          className={`text-[11px] font-medium shrink-0 ${
                            isOwnFob
                              ? "text-[#38bdf8]"
                              : isStarter
                                ? "text-[#34d399]"
                                : poi.kind === "tier4"
                                  ? "text-red-400"
                                  : poi.tier === "Tier 3"
                                    ? "text-[#e5a93c]"
                                    : "text-[#8b98a9]"
                          }`}
                        >
                          {isOwnFob
                            ? "Your FOB"
                            : isStarter
                              ? `${activeFactionInfo.short} Starter`
                              : poi.tier}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Quick 100m Grid Lines Toggle */}
          <button
            type="button"
            aria-pressed={layerVisibility.gridOverlay}
            onClick={() =>
              setLayerVisibility((prev) => ({
                ...prev,
                gridOverlay: !prev.gridOverlay,
              }))
            }
            title="Toggle 100m in-game map grid lines & coordinates"
            className={`min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium backdrop-blur-xl shadow-xl transition-colors whitespace-nowrap shrink-0 ${
              layerVisibility.gridOverlay
                ? "bg-[#e5a93c]/16 border border-[#e5a93c]/55 text-[#fde68a]"
                : "bg-[#0d121a]/90 border border-white/[0.1] text-[#94a3b8] hover:text-white"
            }`}
          >
            <Grid3X3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Grid</span>
          </button>

          {/* Compact Layers Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setLayersOpen((v) => !v);
                setJumpOpen(false);
                setMapSearchOpen(false);
                setScreenSyncPanelOpen(false);
              }}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-[#0d121a]/90 backdrop-blur-xl border border-white/[0.1] hover:border-white/[0.22] text-xs font-medium text-[#e2e9f2] shadow-xl transition-colors"
            >
              <Layers className="w-3.5 h-3.5 text-[#38bdf8]" />
              <span className="hidden sm:inline">Layers</span>
              <span className="font-mono-tabular text-[11px] text-[#8b98a9]">
                {activeLayerCount}
              </span>
            </button>

            {layersOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-60 rounded-xl bg-[#0d121a]/96 backdrop-blur-xl border border-white/[0.12] p-2.5 shadow-2xl z-[800] space-y-1">
                {(
                  [
                    { key: "gridOverlay", label: "100m Grid Lines & Coords", dot: "bg-slate-400" },
                    { key: "poiLabels", label: "Main Regions & Tier 4", dot: "bg-red-400" },
                    { key: "subLocations", label: "Sub-Locations (Zoomed)", dot: "bg-sky-400" },
                    { key: "copsAndLzs", label: "Outposts & Landing Zones", dot: "bg-yellow-400" },
                    { key: "lockedDoors", label: "Locked Doors & Keys", dot: "bg-amber-400" },
                    { key: "tickedSpawns", label: "Material Spawns", dot: "bg-[#e5a93c]" },
                    { key: "blueCrates", label: "Blue Material Crates (95)", dot: "bg-blue-500" },
                    { key: "pcSpawns", label: "PC & Tech Spawns", dot: "bg-cyan-400" },
                    { key: "chemicalAreas", label: "Chemicals Areas (19)", dot: "bg-purple-400" },
                    { key: "disassemblySpawns", label: "Disassembly Items (54)", dot: "bg-orange-400" },
                    { key: "customPins", label: "Custom Pins", dot: "bg-emerald-500" },
                  ] as { key: MapLayerKey; label: string; dot: string }[]
                ).map((layer) => (
                  <label
                    key={layer.key}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.06] text-xs text-[#cbd5e1] cursor-pointer select-none"
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${layer.dot}`} />
                      <span className="truncate">{layer.label}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={layerVisibility[layer.key]}
                      onChange={(e) =>
                        setLayerVisibility((prev) => ({
                          ...prev,
                          [layer.key]: e.target.checked,
                        }))
                      }
                      className="accent-[#e5a93c] w-3.5 h-3.5 cursor-pointer shrink-0"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Top-Right Monitor 2 Tools: Screen Sync, Glance Mode, Measure, Drop Pin, My Pins, Reset View */}
        <div className="pointer-events-auto flex items-center gap-1.5 flex-wrap justify-end">
          {/* Screen Sync (Local OCR Position Tracker) */}
          <button
            type="button"
            onClick={() => {
              setScreenSyncPanelOpen((v) => !v);
              setPinsDrawerOpen(false);
              setLayersOpen(false);
              setJumpOpen(false);
              setMapSearchOpen(false);
            }}
            aria-label="Open screen sync tracker"
            title="Live Position Sync (Local Screen Watcher OCR or Manual Grid)"
            className={`min-h-[38px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-xl shadow-xl transition-colors whitespace-nowrap shrink-0 ${
              screenSyncActive
                ? "bg-emerald-500/20 border border-emerald-400 text-[#a7f3d0]"
                : screenSyncPanelOpen
                  ? "bg-[#38bdf8]/20 border border-[#38bdf8] text-[#bae6fd]"
                  : "bg-[#0d121a]/90 border border-white/[0.1] text-[#e2e9f2] hover:border-white/[0.22]"
            }`}
          >
            {screenSyncActive ? (
              <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            ) : (
              <Monitor className="w-3.5 h-3.5 text-[#38bdf8]" />
            )}
            <span className="hidden sm:inline">
              {screenSyncActive
                ? livePlayerPos
                  ? `Live ${livePlayerPos.grid}`
                  : "Watching"
                : livePlayerPos
                  ? `Pos ${livePlayerPos.grid}`
                  : "Screen Sync"}
            </span>
          </button>

          {/* Glance Mode Toggle (Monitor 2 Fullscreen Intel) */}
          {onToggleGlanceMode && (
            <button
              type="button"
              onClick={() => onToggleGlanceMode(!glanceMode)}
              title="Toggle Glance Mode — fullscreen map & oversized bearing HUD for Monitor 2"
              className={`min-h-[38px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-xl shadow-xl transition-colors whitespace-nowrap shrink-0 ${
                glanceMode
                  ? "bg-[#e5a93c]/25 border border-[#e5a93c] text-[#fde68a]"
                  : "bg-[#0d121a]/90 border border-white/[0.1] text-[#e2e9f2] hover:border-white/[0.22]"
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-[#e5a93c]" />
              <span className="hidden sm:inline">
                {glanceMode ? "Glance On" : "Glance"}
              </span>
            </button>
          )}

          {!glanceMode && (
            <>
              <button
                type="button"
                onClick={() => {
                  const next = !measureMode;
                  setMeasureMode(next);
                  if (next) {
                    onTogglePinDropMode(false);
                    setManualPosMode(false);
                    setRepositioningPin(false);
                    onNotify("Click two points on the map to measure distance");
                  } else {
                    setMeasurePoints([]);
                  }
                }}
                title="Measure distance and bearing between two points"
                className={`min-h-[38px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-xl shadow-xl transition-colors whitespace-nowrap shrink-0 ${
                  measureMode
                    ? "bg-[#38bdf8]/20 border border-[#38bdf8] text-[#bae6fd]"
                    : "bg-[#0d121a]/90 border border-white/[0.1] text-[#e2e9f2] hover:border-white/[0.22]"
                }`}
              >
                <Ruler className="w-3.5 h-3.5" />
                <span className="hidden md:inline">
                  {measureMode ? "Measuring" : "Measure"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!pinDropMode) {
                    setMeasureMode(false);
                    setMeasurePoints([]);
                    setManualPosMode(false);
                    setRepositioningPin(false);
                  }
                  onTogglePinDropMode();
                }}
                className={`min-h-[38px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-xl shadow-xl transition-colors whitespace-nowrap shrink-0 ${
                  pinDropMode
                    ? "bg-cyan-500/20 border border-cyan-400 text-cyan-200"
                    : "bg-[#0d121a]/90 border border-white/[0.1] text-[#e2e9f2] hover:border-white/[0.22]"
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{pinDropMode ? "Placing Pin" : "Drop Pin"}</span>
                <span className="sm:hidden">{pinDropMode ? "Placing" : "Pin"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPinsDrawerOpen((v) => !v);
                  setScreenSyncPanelOpen(false);
                  setLayersOpen(false);
                  setJumpOpen(false);
                  setMapSearchOpen(false);
                }}
                aria-label="Open saved pins list"
                className={`min-h-[38px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-xl shadow-xl transition-colors whitespace-nowrap shrink-0 ${
                  pinsDrawerOpen
                    ? "bg-[#10b981]/20 border border-[#34d399]/70 text-[#a7f3d0]"
                    : "bg-[#0d121a]/90 border border-white/[0.1] text-[#e2e9f2] hover:border-white/[0.22]"
                }`}
              >
                <Bookmark className="w-3.5 h-3.5 text-[#34d399]" />
                <span className="hidden sm:inline">My Pins</span>
                <span
                  className={`font-mono-tabular text-[11px] px-1.5 py-0.5 rounded-md ${
                    userDroppedPins.length > 0
                      ? "bg-[#10b981]/20 text-[#6ee7b7]"
                      : "bg-white/[0.06] text-[#94a3b8]"
                  }`}
                >
                  {userDroppedPins.length}
                </span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={fitIslandView}
            title="Reset Island View"
            className="min-h-[38px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-[#0d121a]/90 backdrop-blur-xl border border-white/[0.1] text-[#e2e9f2] hover:border-white/[0.22] shadow-xl transition-colors whitespace-nowrap shrink-0"
          >
            <LocateFixed className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Reset View</span>
          </button>
        </div>
        </div>

        {/* Left & Right Floating Intel Drawers (Flows naturally below toolbar row so wrapped toolbars never collide) */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2.5 w-full pointer-events-none relative z-[715]">
          <div className="min-w-0 max-w-full pointer-events-none">
      {/* Interactive Zone Intel Slide-Over Drawer (Direct Map Click on any POI / Compound / COP / LZ) */}
      {inspectedPoi && zoneIntel && !inspectedMaterial && !inspectedTask && !inspectedKey && (
        <div className="pointer-events-auto w-[370px] max-w-full max-h-[52vh] lg:max-h-[calc(100vh-240px)] overflow-y-auto rounded-xl bg-[#0d121a]/95 backdrop-blur-xl border border-white/[0.12] p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-white/[0.08]">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-[#e5a93c]">
                {inspectedPoi.tier} · {inspectedPoi.faction} · Grid {formatGridSquare(inspectedPoi.x, inspectedPoi.y)}
              </div>
              <h3 className="font-display text-base font-semibold text-[#f1f5f9] leading-snug mt-0.5">
                {inspectedPoi.name}
              </h3>
              {zoneIntel.flightFromFob && (
                <div className="text-[11px] text-[#7dd3fc] font-mono-tabular mt-1">
                  From {zoneIntel.flightFromFob.fobName} FOB: {zoneIntel.flightFromFob.dist} m · {zoneIntel.flightFromFob.bearing}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() =>
                  lockBearingTo({
                    x: inspectedPoi.x,
                    y: inspectedPoi.y,
                    label: inspectedPoi.name,
                    kind: "poi",
                  })
                }
                title="Lock compass bearing from nearest LZ / your position"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#e5a93c]/15 border border-[#e5a93c]/50 text-[#fde68a] hover:bg-[#e5a93c]/25 text-[11px] font-semibold shrink-0 transition-colors"
              >
                <Compass className="w-3.5 h-3.5 text-[#e5a93c]" />
                <span>Lock Bearing</span>
              </button>
              <button
                type="button"
                aria-label="Close zone intel"
                onClick={() => setInspectedPoi(null)}
                className="p-1.5 rounded-lg text-[#8b98a9] hover:text-white hover:bg-white/[0.08] shrink-0 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-3 text-xs">
            {/* Nearest LZs & COPs (Click to Fly or Set Bearing Origin) */}
            <div>
              <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[#38bdf8] mb-1.5">
                Nearest LZs &amp; Outposts (Fly or Start Bearing)
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {zoneIntel.nearestLzs.map(({ poi: lzPoi, dist, bearing }) => (
                  <div
                    key={lzPoi.id}
                    className="rounded bg-[#080b0f] border border-[#1f2834] hover:border-[#eab308] p-1.5 flex items-center justify-between gap-1 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        mapRef.current?.flyTo(toLatLng(lzPoi.x, lzPoi.y), 16, { duration: 0.55 })
                      }
                      className="text-left min-w-0 flex-1"
                    >
                      <div className="text-[11px] font-semibold text-[#fde047] truncate">
                        LZ {lzPoi.lz}
                      </div>
                      <div className="font-mono-tabular text-[10px] text-[#8b98a9]">
                        {dist} m · {bearing}
                      </div>
                    </button>
                    <button
                      type="button"
                      title={`Navigate from LZ ${lzPoi.lz} to ${inspectedPoi.name}`}
                      onClick={() =>
                        lockBearingTo(
                          {
                            x: inspectedPoi.x,
                            y: inspectedPoi.y,
                            label: inspectedPoi.name,
                            kind: "poi",
                          },
                          {
                            x: lzPoi.x,
                            y: lzPoi.y,
                            label: `LZ ${lzPoi.lz}`,
                            grid: formatGridSquare(lzPoi.x, lzPoi.y),
                            kind: "lz",
                          }
                        )
                      }
                      className="p-1 rounded bg-[#141a23] border border-white/[0.08] text-[#e5a93c] hover:border-[#e5a93c] shrink-0"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {zoneIntel.nearestCops.map(({ poi: copPoi, dist, bearing }) => (
                  <div
                    key={copPoi.id}
                    className="rounded bg-[#080b0f] border border-[#1f2834] hover:border-[#38bdf8] p-1.5 flex items-center justify-between gap-1 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        mapRef.current?.flyTo(toLatLng(copPoi.x, copPoi.y), 16, { duration: 0.55 })
                      }
                      className="text-left min-w-0 flex-1"
                    >
                      <div className="text-[11px] font-semibold text-[#bae6fd] truncate">
                        {copPoi.name.replace(/^Outpost\s+/i, "COP ")}
                      </div>
                      <div className="font-mono-tabular text-[10px] text-[#8b98a9]">
                        {dist} m · {bearing}
                      </div>
                    </button>
                    <button
                      type="button"
                      title={`Navigate from ${copPoi.name} to ${inspectedPoi.name}`}
                      onClick={() =>
                        lockBearingTo(
                          {
                            x: inspectedPoi.x,
                            y: inspectedPoi.y,
                            label: inspectedPoi.name,
                            kind: "poi",
                          },
                          {
                            x: copPoi.x,
                            y: copPoi.y,
                            label: copPoi.name.replace(/^Outpost\s+/i, "COP "),
                            grid: formatGridSquare(copPoi.x, copPoi.y),
                            kind: "cop",
                          }
                        )
                      }
                      className="p-1 rounded bg-[#141a23] border border-white/[0.08] text-[#38bdf8] hover:border-[#38bdf8] shrink-0"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Locked Doors & Keys in This Zone */}
            {zoneIntel.nearbyKeys.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono-tabular text-[10px] uppercase tracking-wider text-[#e5a93c]">
                    Locked Doors &amp; Keys ({zoneIntel.nearbyKeys.length})
                  </span>
                </div>
                <div className="space-y-1">
                  {zoneIntel.nearbyKeys.slice(0, 8).map((k) => {
                    const isOwned = !!ownedKeys[k.id];
                    return (
                      <div
                        key={k.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#080b0f] border border-[#1f2834]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setInspectedPoi(null);
                            onSelectKey?.(k);
                          }}
                          className="min-w-0 text-left flex-1 hover:text-[#38bdf8] transition-colors"
                        >
                          <div className="text-[11px] font-medium text-[#eef3f8] truncate">
                            {k.name}
                          </div>
                          <div className="text-[10px] text-[#7f8ea1] truncate">
                            {k.doorTarget}
                          </div>
                        </button>
                        {onToggleOwnedKey && (
                          <button
                            type="button"
                            onClick={() => onToggleOwnedKey(k.id)}
                            className={`px-2 py-1 rounded border text-[10px] font-medium shrink-0 transition-colors ${
                              isOwned
                                ? "bg-[#112720] border-[#2b6b53] text-[#34d399]"
                                : "bg-[#121720] border-[#253040] text-[#8b98a9] hover:text-white"
                            }`}
                          >
                            {isOwned ? "Owned" : "Need"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tasks in This Zone */}
            {zoneIntel.zoneTasks.length > 0 && (
              <div>
                <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[#38bdf8] mb-1.5">
                  Tasks in {zoneIntel.regionName} ({zoneIntel.zoneTasks.length})
                </div>
                <div className="space-y-1">
                  {zoneIntel.zoneTasks.slice(0, 6).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setInspectedPoi(null);
                        onSelectTask?.(t);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded bg-[#080b0f] border border-[#1f2834] hover:border-[#38bdf8] flex items-center justify-between gap-2 transition-colors"
                    >
                      <div className="min-w-0">
                        <div
                          className={`text-[11px] font-medium truncate ${
                            completedTasks[t.id]
                              ? "text-[#7f8ea1] line-through"
                              : "text-[#eef3f8]"
                          }`}
                        >
                          {t.name}
                        </div>
                        <div className="text-[10px] text-[#8b98a9] truncate">
                          {t.vendor} · {t.category}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono-tabular text-[#38bdf8] shrink-0">
                        Walkthrough
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Loot Spawns & Hideout Materials in This Area */}
            {(zoneIntel.cratesNearby > 0 ||
              zoneIntel.disassemblyNearby.length > 0 ||
              zoneIntel.chemicalsNearby > 0 ||
              zoneIntel.matchingMaterials.length > 0) && (
              <div>
                <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[#8b98a9] mb-1.5">
                  Area Loot &amp; Hideout Materials
                </div>
                <div className="font-mono-tabular text-[11px] text-[#cbd5e1] mb-2">
                  {zoneIntel.cratesNearby} Blue Crates
                  <span className="mx-1.5 text-[#3a4657]">·</span>
                  {zoneIntel.disassemblyNearby.length} Disassembly
                  <span className="mx-1.5 text-[#3a4657]">·</span>
                  {zoneIntel.chemicalsNearby} Chemical Spawns
                </div>
                {zoneIntel.matchingMaterials.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {zoneIntel.matchingMaterials.map((mat) => (
                      <button
                        key={mat.key}
                        type="button"
                        onClick={() => {
                          setInspectedPoi(null);
                          onSelectMaterial?.(mat);
                        }}
                        className="px-2 py-1 rounded bg-[#080b0f] border border-[#222c3a] hover:border-[#e5a93c] text-[11px] text-[#dce4ee] transition-colors"
                      >
                        {mat.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Locked Door & Key Slide-Over Drawer */}
      {inspectedKey && !inspectedMaterial && !inspectedTask && (
        <div className="pointer-events-auto w-[355px] max-w-full max-h-[52vh] lg:max-h-[calc(100vh-240px)] overflow-y-auto rounded-xl bg-[#0d121a]/95 backdrop-blur-xl border border-white/[0.12] p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-2.5 min-w-0">
              <ItemThumbnail
                src={inspectedKey.image}
                alt={inspectedKey.name}
                sizeClass="w-10 h-10"
              />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#e5a93c]">
                  {inspectedKey.kind} · {inspectedKey.region}
                </div>
                <h3 className="font-display text-base font-semibold text-[#f1f5f9] leading-snug">
                  {inspectedKey.name}
                </h3>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() =>
                  lockBearingTo({
                    x: inspectedKey.x,
                    y: inspectedKey.y,
                    label: inspectedKey.name,
                    kind: "key",
                  })
                }
                title="Lock compass bearing to this locked door"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#e5a93c]/15 border border-[#e5a93c]/50 text-[#fde68a] hover:bg-[#e5a93c]/25 text-[11px] font-semibold shrink-0 transition-colors"
              >
                <Compass className="w-3.5 h-3.5 text-[#e5a93c]" />
                <span>Lock</span>
              </button>
              <button
                type="button"
                aria-label="Close key drawer"
                onClick={onCloseInspectKey}
                className="p-1.5 rounded-lg text-[#8b98a9] hover:text-white hover:bg-white/[0.08] shrink-0 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-3 text-xs">
            <p className="text-[#dce4ee] leading-relaxed">{inspectedKey.usage}</p>

            <div className="rounded bg-[#080b0f] border border-[#1d2531] px-2.5 py-2 space-y-1 font-mono-tabular text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-[#8b98a9]">Door Location</span>
                <span className="text-[#eef3f8]">
                  {inspectedKey.sublocation || inspectedKey.region}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#8b98a9]">Grid Square</span>
                <span className="text-[#38bdf8]">Grid {inspectedKey.grid}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#8b98a9]">Nearest LZ</span>
                <span className="text-[#fde047]">{inspectedKey.lz}</span>
              </div>
            </div>

            {onToggleOwnedKey && (
              <button
                type="button"
                onClick={() => onToggleOwnedKey(inspectedKey.id)}
                className={`w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors ${
                  ownedKeys[inspectedKey.id]
                    ? "bg-[#112720] border-[#2b6b53] text-[#34d399]"
                    : "bg-[#141a23] border-[#2b3748] text-[#dce4ee] hover:border-[#e5a93c]"
                }`}
              >
                {ownedKeys[inspectedKey.id] && <Check className="w-3.5 h-3.5" />}
                <span>
                  {ownedKeys[inspectedKey.id]
                    ? "In Your Keyholder"
                    : "Mark Key as Owned"}
                </span>
              </button>
            )}

            {inspectedKey.linkedTasks.length > 0 && (
              <div>
                <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[#38bdf8] mb-1.5">
                  Required for Tasks
                </div>
                <div className="space-y-1">
                  {inspectedKey.linkedTasks.map((lt) => {
                    const fullTask = allTasks.find((t) => t.id === lt.id);
                    return (
                      <button
                        key={lt.id}
                        type="button"
                        onClick={() => {
                          if (fullTask && onSelectTask) {
                            onCloseInspectKey?.();
                            onSelectTask(fullTask);
                          }
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded bg-[#080b0f] border border-[#1f2834] hover:border-[#38bdf8] flex items-center justify-between gap-2 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[#eef3f8] truncate">
                            {lt.name}
                          </div>
                          <div className="text-[10px] text-[#8b98a9]">
                            {lt.vendor}
                          </div>
                        </div>
                        <span className="text-[10px] font-mono-tabular text-[#38bdf8] shrink-0">
                          Walkthrough
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Task AO & Full Walkthrough Slide-Over Drawer */}
      {inspectedTask && !inspectedMaterial && (
        <div className="pointer-events-auto w-[385px] max-w-full max-h-[52vh] lg:max-h-[calc(100vh-240px)] overflow-y-auto rounded-xl bg-[#0d121a]/95 backdrop-blur-xl border border-white/[0.12] p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-white/[0.08]">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-[#38bdf8]">
                {inspectedTask.vendor} · {inspectedTask.areas.join(", ")} · {inspectedTask.category}
              </div>
              <h3 className="font-display text-base font-semibold text-[#f1f5f9] leading-snug mt-0.5">
                {inspectedTask.name}
              </h3>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {(inspectedTask.exactCoords.length > 0 ||
                inspectedTask.matchedPois.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    const firstExact = inspectedTask.exactCoords[0];
                    const firstPoi = inspectedTask.matchedPois[0];
                    const target = firstExact
                      ? {
                          x: firstExact.x,
                          y: firstExact.y,
                          label: `${inspectedTask.name}`,
                          kind: "task" as const,
                        }
                      : {
                          x: firstPoi!.x,
                          y: firstPoi!.y,
                          label: `${inspectedTask.name} (${firstPoi!.name})`,
                          kind: "task" as const,
                        };
                    lockBearingTo(target);
                  }}
                  title="Lock compass bearing to this task objective"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border bg-[#e5a93c]/15 border-[#e5a93c]/50 text-[#fde68a] hover:bg-[#e5a93c]/25 text-[11px] font-semibold transition-colors"
                >
                  <Compass className="w-3 h-3 text-[#e5a93c]" />
                  <span>Bearing</span>
                </button>
              )}
              {onToggleTaskComplete && (
                <button
                  type="button"
                  onClick={() => onToggleTaskComplete(inspectedTask.id)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
                    completedTasks[inspectedTask.id]
                      ? "bg-[#112720] border-[#2b6b53] text-[#34d399]"
                      : "bg-[#141a23] border-[#2b3748] text-[#dce4ee] hover:border-[#e5a93c] hover:text-[#e5a93c]"
                  }`}
                >
                  {completedTasks[inspectedTask.id] && (
                    <Check className="w-3 h-3 stroke-[2.5]" />
                  )}
                  <span>
                    {completedTasks[inspectedTask.id] ? "Done" : "Mark Done"}
                  </span>
                </button>
              )}
              <button
                type="button"
                aria-label="Close task overlay"
                onClick={onCloseInspectTask}
                className="p-1.5 rounded text-[#8b98a9] hover:text-white hover:bg-[#1a222d]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-3 text-xs">
            {/* Location / Guide Visual Preview */}
            {(inspectedTask.guideImage || inspectedTask.image) && (
              <button
                type="button"
                onClick={() =>
                  setMapLightbox({
                    src: inspectedTask.guideImage || inspectedTask.image || "",
                    title: `${inspectedTask.name} — Task Intel`,
                  })
                }
                className="w-full text-left rounded bg-[#080b0f] border border-[#222c3a] hover:border-[#38bdf8] overflow-hidden transition-colors block"
              >
                <img
                  src={inspectedTask.guideImage || inspectedTask.image || ""}
                  alt={inspectedTask.name}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const btn = e.currentTarget.closest("button");
                    if (btn) btn.style.display = "none";
                  }}
                  className={`w-full object-cover ${
                    inspectedTask.guideImage ? "max-h-40" : "max-h-20 opacity-85"
                  }`}
                />
                <div className="px-2.5 py-1 flex items-center justify-between text-[10px] font-mono-tabular text-[#8b98a9] bg-[#0a0e13]">
                  <span>
                    {inspectedTask.guideImage
                      ? "Location Reference Image"
                      : `${inspectedTask.vendor} Operation Banner`}
                  </span>
                  <span className="text-[#38bdf8]">Enlarge</span>
                </div>
              </button>
            )}

            {/* Objectives Checklist */}
            {inspectedTask.objectivesText && (
              <div className="rounded bg-[#080b0f] border border-[#1d2531] px-2.5 py-2">
                <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[#e5a93c] mb-1">
                  Objectives
                </div>
                <p className="text-[#e6ecf2] leading-relaxed">
                  {inspectedTask.objectivesText}
                </p>
                {inspectedTask.objectivesList.length > 0 && (
                  <ul className="mt-1.5 pl-4 space-y-0.5 text-[11px] text-[#9fb0c4] list-disc">
                    {inspectedTask.objectivesList.map((st, idx) => (
                      <li key={idx}>{st}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Step-by-Step Task Walkthrough */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-1.5 font-mono-tabular text-[10px] uppercase tracking-wider text-[#38bdf8] font-semibold">
                  <BookOpen className="w-3 h-3" />
                  Walkthrough Steps
                </span>
                <span className="font-mono-tabular text-[9px] uppercase text-[#6f7e91]">
                  {inspectedTask.walkthroughSource === "api-guide"
                    ? "API Field Guide"
                    : inspectedTask.walkthroughSource === "curated"
                      ? "0.5 Tactical Guide"
                      : "Mission Intel"}
                </span>
              </div>
              <ol className="space-y-1.5">
                {inspectedTask.walkthroughSteps.map((step, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 rounded bg-[#080b0f] border border-[#1a222d] px-2.5 py-2 text-[#dce4ee] leading-relaxed"
                  >
                    <span className="font-mono-tabular text-[10px] font-bold text-[#e5a93c] shrink-0 mt-0.5">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Exact Waypoint Coordinates & Area POIs (Click to Fly) */}
            {(inspectedTask.exactCoords.length > 0 ||
              inspectedTask.matchedPois.length > 0) && (
              <div>
                <div className="inline-flex items-center gap-1.5 font-mono-tabular text-[10px] uppercase tracking-wider text-[#e5a93c] mb-1.5">
                  <Compass className="w-3 h-3" />
                  Target Areas &amp; Grids (Click to Fly)
                </div>
                <div className="space-y-1.5">
                  {inspectedTask.exactCoords.map((coord, idx) => (
                    <div
                      key={`coord-${coord.grid}`}
                      className="rounded bg-[#14120c] border border-[#e5a93c]/40 hover:border-[#e5a93c] transition-colors flex items-center gap-1.5 pr-1.5"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          mapRef.current?.flyTo(toLatLng(coord.x, coord.y), 17, {
                            duration: 0.55,
                          })
                        }
                        className="flex-1 min-w-0 text-left px-2.5 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-[#eef3f8] truncate">
                            Waypoint #{idx + 1}: {coord.label}
                          </div>
                          <div className="text-[11px] text-[#cbd5e1] truncate">
                            Exact task coordinate marker
                          </div>
                        </div>
                        <div className="flex items-center gap-1 font-mono-tabular text-[11px] text-[#e5a93c] shrink-0">
                          <MapPin className="w-3 h-3" />
                          {coord.grid}
                        </div>
                      </button>
                      <button
                        type="button"
                        title={`Lock bearing to Waypoint #${idx + 1}`}
                        onClick={() =>
                          lockBearingTo({
                            x: coord.x,
                            y: coord.y,
                            label: `${inspectedTask.name} #${idx + 1}`,
                            kind: "task",
                          })
                        }
                        className="p-1.5 rounded bg-[#090d14] border border-[#e5a93c]/40 text-[#e5a93c] hover:bg-[#e5a93c]/20 shrink-0"
                      >
                        <Compass className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {inspectedTask.matchedPois.map((poi) => (
                    <div
                      key={poi.id}
                      className="rounded bg-[#080b0f] border border-[#1f2834] hover:border-[#38bdf8] transition-colors flex items-center gap-1.5 pr-1.5"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          mapRef.current?.flyTo(toLatLng(poi.x, poi.y), 16.5, {
                            duration: 0.6,
                          })
                        }
                        className="flex-1 min-w-0 text-left px-2.5 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-[#eef3f8] truncate">
                            {poi.name}
                          </div>
                          <div className="text-[11px] text-[#8b98a9] truncate">
                            {poi.tier} · LZ {poi.lz}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 font-mono-tabular text-[11px] text-[#38bdf8] shrink-0">
                          <MapPin className="w-3 h-3" />
                          {formatGridSquare(poi.x, poi.y)}
                        </div>
                      </button>
                      <button
                        type="button"
                        title={`Lock bearing to ${poi.name}`}
                        onClick={() =>
                          lockBearingTo({
                            x: poi.x,
                            y: poi.y,
                            label: `${inspectedTask.name} · ${poi.name}`,
                            kind: "task",
                          })
                        }
                        className="p-1.5 rounded bg-[#090d14] border border-white/[0.1] text-[#38bdf8] hover:border-[#e5a93c] hover:text-[#e5a93c] shrink-0"
                      >
                        <Compass className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Required Gear, Keys & Task Items */}
            {inspectedTask.relatedItems.length > 0 && (
              <div>
                <div className="inline-flex items-center gap-1.5 font-mono-tabular text-[10px] uppercase tracking-wider text-[#e5a93c] mb-1.5">
                  <KeyRound className="w-3 h-3" />
                  Required Gear, Keys &amp; Items
                </div>
                <div className="space-y-1.5">
                  {inspectedTask.relatedItems.map((item, idx) => (
                    <div
                      key={`${item.name}-${idx}`}
                      className="flex items-center gap-2.5 rounded bg-[#080b0f] border border-[#1d2531] px-2.5 py-1.5"
                    >
                      <ItemThumbnail
                        src={item.image}
                        alt={item.name}
                        sizeClass="w-7 h-7"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-[#eef3f8] truncate">
                            {item.name}
                          </span>
                          <span className="font-mono-tabular text-[9px] uppercase text-[#38bdf8] shrink-0">
                            {item.kind}
                          </span>
                        </div>
                        {item.note && (
                          <div className="text-[11px] text-[#8b98a9] truncate">
                            {item.note}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tactical Tip */}
            {inspectedTask.guideTip && (
              <div className="rounded bg-[#18120c] border border-[#e5a93c]/40 px-2.5 py-2 text-[11px] text-[#cbd5e1]">
                Tip: {inspectedTask.guideTip}
              </div>
            )}

            {/* Full Vendor Briefing */}
            {inspectedTask.briefing && (
              <div className="rounded-lg bg-white/[0.025] border border-white/[0.07] px-3 py-2.5 text-[11px] text-[#9fb0c4] leading-relaxed">
                <div className="text-[10px] font-medium text-[#7f8ea1] mb-1">
                  {inspectedTask.vendor} Briefing
                </div>
                {inspectedTask.briefing}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Material Spawn & Upgrade Intel Slide-Over Drawer */}
      {inspectedMaterial && (
        <div className="pointer-events-auto w-[335px] max-w-full max-h-[50vh] lg:max-h-[calc(100vh-240px)] overflow-y-auto rounded-xl bg-[#0d121a]/95 backdrop-blur-xl border border-white/[0.12] p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-3 min-w-0">
              <ItemThumbnail
                src={inspectedMaterial.image}
                alt={inspectedMaterial.name}
                sizeClass="w-10 h-10"
              />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#38bdf8]">
                  Known Material Spawns
                </div>
                <h3 className="font-display text-base font-semibold text-[#f1f5f9] truncate">
                  {inspectedMaterial.name}
                </h3>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close spawn drawer"
              onClick={onCloseInspect}
              className="p-1.5 rounded-lg text-[#8b98a9] hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-3 space-y-3 text-xs">
            <p className="text-[#b8c4d4] leading-relaxed">
              {inspectedMaterial.description}
            </p>

            <label className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-[#121822] border border-[#222c3a] cursor-pointer">
              <span className="font-medium text-[#e6ecf2]">
                Keep Spawn Pins Pinned
              </span>
              <input
                type="checkbox"
                checked={!!tickedMapMaterials[inspectedMaterial.key]}
                onChange={(e) =>
                  onToggleMapMaterial(inspectedMaterial.key, e.target.checked)
                }
                className="accent-[#e5a93c] w-4 h-4 cursor-pointer"
              />
            </label>

            {inspectedMaterial.usedInUpgrades.length > 0 && (
              <div>
                <div className="font-semibold text-[#dce4ee] mb-1">
                  Required for Upgrades ({inspectedMaterial.usedInUpgrades.length})
                </div>
                <div className="space-y-1">
                  {inspectedMaterial.usedInUpgrades.map((u, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-[#b8c4d4] py-1 border-b border-[#1c2430] last:border-none"
                    >
                      <span className="truncate pr-2">
                        {u.module} Lv.{u.level}
                      </span>
                      <span className="font-mono-tabular text-[#e5a93c] shrink-0">
                        ×{u.quantity}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="font-semibold text-[#dce4ee] mb-1">
                API Loot Tables &amp; Containers
              </div>
              {isLookupLoading ? (
                <div className="text-[#8b98a9] py-1">
                  Querying gzw-data.dev loot tables...
                </div>
              ) : inspectedLookup && inspectedLookup.foundIn.length > 0 ? (
                <div className="space-y-1">
                  {inspectedLookup.foundIn.map((src, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#080b0f] border border-[#1f2834]"
                    >
                      <div className="min-w-0">
                        <div className="text-[#dce4ee] truncate">
                          {src.table.replace(/^DA_LootTable_/, "")}
                        </div>
                        <div className="text-[11px] text-[#7f8ea1]">
                          {src.source}
                        </div>
                      </div>
                      {src.chancePerRoll !== undefined && (
                        <span className="font-mono-tabular text-[#38bdf8] shrink-0">
                          {(src.chancePerRoll * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1 text-[#8b98a9]">
                  {inspectedMaterial.spawnNotes.map((note, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <span className="text-[#e5a93c]">·</span>
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="font-semibold text-[#dce4ee] mb-1.5">
                Lamang 0.5 Spawn Coordinates (Click to Fly)
              </div>
              <div className="space-y-1.5">
                {inspectedSpawnPoints.map((pt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() =>
                      mapRef.current?.flyTo(toLatLng(pt.x, pt.y), 16.5, { duration: 0.6 })
                    }
                    className="w-full text-left px-2.5 py-2 rounded bg-[#080b0f] border border-[#1f2834] hover:border-[#38bdf8] transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[#eef3f8] truncate">
                        {pt.title}
                      </div>
                      <div className="text-[11px] text-[#8b98a9] truncate">
                        {pt.source}
                        {pt.tier ? ` · ${pt.tier}` : ""}
                        {pt.lz ? ` · LZ ${pt.lz}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 font-mono-tabular text-[11px] text-[#38bdf8] shrink-0">
                      <MapPin className="w-3 h-3" />
                      {formatGridSquare(pt.x, pt.y)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

          </div>

          <div className="ml-auto flex flex-col items-end gap-2 max-w-full pointer-events-none">
            {/* Glance Mode Monitor-2 Status Pill */}
            {glanceMode && (
              <div className="hidden lg:flex pointer-events-auto items-center gap-2 rounded-lg bg-[#0d121a]/92 backdrop-blur-xl border border-white/[0.1] px-2.5 py-1.5 text-[11px] text-[#cbd5e1] shadow-xl">
                <span className="font-semibold text-[#f8fafc]">{activeOperatorName}</span>
                {activeFactionInfo && (
                  <span
                    className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-semibold"
                    style={{ color: activeFactionInfo.color }}
                  >
                    {activeFactionInfo.short}
                  </span>
                )}
                {livePlayerPos && (
                  <span className="font-mono-tabular text-[#34d399]">
                    · Grid {livePlayerPos.grid}
                  </span>
                )}
              </div>
            )}

      {/* Recorded Dropped Pins Drawer */}
      {pinsDrawerOpen && (
        <div className="pointer-events-auto w-[345px] max-w-full max-h-[52vh] lg:max-h-[calc(100vh-240px)] flex flex-col rounded-xl bg-[#0d121a]/96 backdrop-blur-xl border border-white/[0.12] shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <h3 className="font-display text-sm font-semibold text-[#f8fafc] flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-[#34d399]" />
                <span>Dropped Pins Log</span>
                <span className="font-mono-tabular text-xs text-[#34d399]">
                  ({userDroppedPins.length})
                </span>
              </h3>
              <p className="text-[11px] text-[#9fb0c4] mt-0.5">
                Auto-syncs when you add, edit, or delete map pins.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close saved pins drawer"
              onClick={() => setPinsDrawerOpen(false)}
              className="p-1.5 rounded-lg text-[#94a3b8] hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-3.5 py-2.5 border-b border-white/[0.07] bg-[#090d14] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center rounded-lg bg-[#06090e] border border-white/[0.08] p-0.5">
              <button
                type="button"
                onClick={() => setPinsFilterTab("user")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  pinsFilterTab === "user"
                    ? "bg-[#1a2232] text-[#f8fafc]"
                    : "text-[#8fa1b6] hover:text-white"
                }`}
              >
                My Pins ({userDroppedPins.length})
              </button>
              <button
                type="button"
                onClick={() => setPinsFilterTab("all")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  pinsFilterTab === "all"
                    ? "bg-[#1a2232] text-[#f8fafc]"
                    : "text-[#8fa1b6] hover:text-white"
                }`}
              >
                All ({userDroppedPins.length + seedCustomPins.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setMeasureMode(false);
                setMeasurePoints([]);
                onTogglePinDropMode(!pinDropMode);
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                pinDropMode
                  ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                  : "bg-[#121822] border-white/[0.1] text-[#e2e8f0] hover:border-[#38bdf8]"
              }`}
            >
              <Crosshair className="w-3 h-3" />
              <span>{pinDropMode ? "Placing..." : "+ Drop Pin"}</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {visibleDrawerPins.length === 0 ? (
              <div className="rounded-xl border border-white/[0.08] bg-[#121822] p-5 text-center space-y-2">
                <p className="text-xs text-[#cbd5e1] leading-relaxed">
                  No dropped pins recorded yet.
                </p>
                <p className="text-[11px] text-[#8fa1b6] leading-relaxed">
                  Click <strong className="text-[#7dd3fc]">Drop Pin</strong> and tap any spot on Lamang Island to save &amp; track custom notes or material spawns.
                </p>
              </div>
            ) : (
              visibleDrawerPins.map((pin) => {
                const linkedMat = catalog.find(
                  (m) => m.id === pin.materialId || m.key === pin.materialId
                );
                const layerMeta =
                  pin.layer === "blueCrates"
                    ? { dot: "bg-blue-500", text: "text-blue-300", name: "Blue Crate" }
                    : pin.layer === "pcSpawns"
                      ? { dot: "bg-cyan-400", text: "text-cyan-300", name: "PC / Tech" }
                      : { dot: "bg-emerald-400", text: "text-emerald-300", name: "Recon Pin" };
                const isEditingThis = editingPin?.id === pin.id;

                return (
                  <div
                    key={pin.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      isEditingThis
                        ? "bg-[#152030] border-[#38bdf8]"
                        : "bg-[#121822] border-white/[0.08] hover:border-white/[0.18]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => focusPinOnMap(pin)}
                        className="min-w-0 flex-1 text-left group"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${layerMeta.dot}`} />
                          <span className="text-[13px] font-semibold text-[#f8fafc] group-hover:text-[#7dd3fc] truncate transition-colors">
                            {pin.label}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-[#9fb0c4]">
                          <span className={layerMeta.text}>{layerMeta.name}</span>
                          {linkedMat && (
                            <>
                              <span className="text-[#4a596c]">·</span>
                              <span className="text-[#e5a93c] truncate max-w-[140px]">
                                {linkedMat.name}
                              </span>
                            </>
                          )}
                          <span className="text-[#4a596c]">·</span>
                          <span className="font-mono-tabular text-[#cbd5e1]">
                            Grid {formatGridSquare(pin.x, pin.y)}
                          </span>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          title="Lock compass bearing to this pin"
                          aria-label={`Lock bearing to ${pin.label}`}
                          onClick={() =>
                            lockBearingTo({
                              x: pin.x,
                              y: pin.y,
                              label: pin.label,
                              kind: "pin",
                            })
                          }
                          className="p-1.5 rounded-lg bg-[#090d14] border border-white/[0.08] text-[#9fb0c4] hover:text-[#e5a93c] hover:border-[#e5a93c]/50 transition-colors"
                        >
                          <Compass className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Locate pin on map"
                          aria-label={`Locate ${pin.label}`}
                          onClick={() => focusPinOnMap(pin)}
                          className="p-1.5 rounded-lg bg-[#090d14] border border-white/[0.08] text-[#9fb0c4] hover:text-[#38bdf8] hover:border-[#38bdf8]/50 transition-colors"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Edit pin"
                          aria-label={`Edit ${pin.label}`}
                          onClick={() => startEditingPin(pin)}
                          className="p-1.5 rounded-lg bg-[#090d14] border border-white/[0.08] text-[#9fb0c4] hover:text-[#e5a93c] hover:border-[#e5a93c]/50 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Delete pin"
                          aria-label={`Delete ${pin.label}`}
                          onClick={() => handleDeletePinById(pin.id)}
                          className="p-1.5 rounded-lg bg-[#090d14] border border-white/[0.08] text-[#9fb0c4] hover:text-red-400 hover:border-red-500/50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Pin Drop Create / Edit Modal */}
      {capturedCoords && (
        <div className="pointer-events-auto w-[315px] max-w-full max-h-[54vh] lg:max-h-[calc(100vh-240px)] overflow-y-auto rounded-xl bg-[#0d121a]/98 backdrop-blur-xl border border-[#38bdf8]/60 p-4 shadow-2xl space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-[#e5a93c] font-semibold">
                {editingPin ? "Edit Dropped Pin" : "New Map Pin"}
              </div>
              <span className="text-xs font-semibold text-[#38bdf8]">
                Grid {formatGridSquare(capturedCoords.x, capturedCoords.y)}
              </span>
            </div>
            <button
              type="button"
              aria-label="Close pin modal"
              onClick={closePinModal}
              className="p-1 rounded-lg text-[#8b98a9] hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-[#9fb0c4]">
                Coordinates (X, Y)
              </label>
              {editingPin && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !repositioningPin;
                    setRepositioningPin(next);
                    if (next) {
                      setMeasureMode(false);
                      onNotify("Click anywhere on the map to move this pin");
                    }
                  }}
                  className={`text-[11px] font-medium px-2 py-0.5 rounded border transition-colors ${
                    repositioningPin
                      ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                      : "bg-[#121822] border-white/[0.1] text-[#7dd3fc] hover:border-[#38bdf8]"
                  }`}
                >
                  {repositioningPin ? "Click map now..." : "Move on Map"}
                </button>
              )}
            </div>
            <input
              type="text"
              readOnly
              value={`${capturedCoords.x}, ${capturedCoords.y}`}
              className="w-full bg-[#070a0f] border border-white/[0.09] rounded-lg px-2.5 py-1.5 font-mono-tabular text-xs text-[#38bdf8]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#9fb0c4] mb-1">
              Attach Pin to Material
            </label>
            <select
              aria-label="Attach Pin to Material"
              value={pinMaterialId}
              onChange={(e) => setPinMaterialId(e.target.value)}
              className="w-full bg-[#070a0f] border border-white/[0.09] rounded-lg px-2.5 py-1.5 text-xs text-[#f1f5f9]"
            >
              <option value="">General Recon Pin</option>
              {catalog.map((m) => (
                <option key={m.key} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[#9fb0c4] mb-1">
              Layer Category
            </label>
            <select
              aria-label="Layer Category"
              value={pinLayer}
              onChange={(e) =>
                setPinLayer(
                  e.target.value as "customPins" | "blueCrates" | "pcSpawns"
                )
              }
              className="w-full bg-[#070a0f] border border-white/[0.09] rounded-lg px-2.5 py-1.5 text-xs text-[#f1f5f9]"
            >
              <option value="customPins">Custom Item Pin (Green)</option>
              <option value="blueCrates">Blue-Planked Crate (Blue)</option>
              <option value="pcSpawns">PC Part Spawn (Cyan)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[#9fb0c4] mb-1">
              Location Note
            </label>
            <input
              type="text"
              value={pinNote}
              onChange={(e) => setPinNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePin();
              }}
              placeholder="e.g. Northern Reach Armory shelf"
              className="w-full bg-[#070a0f] border border-white/[0.09] rounded-lg px-2.5 py-1.5 text-xs text-[#f8fafc] placeholder:text-[#66778b]"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSavePin}
              className="flex-1 py-2 px-4 rounded-lg bg-[#e5a93c] hover:bg-[#f0b94d] text-[#0c0f14] font-semibold text-xs transition-colors"
            >
              {editingPin ? "Save Changes" : "Save Map Pin"}
            </button>
            {editingPin && (
              <button
                type="button"
                onClick={() => handleDeletePinById(editingPin.id)}
                className="py-2 px-3 rounded-lg bg-[#261215] border border-red-500/60 text-red-300 hover:bg-red-950/60 font-semibold text-xs transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {/* Hidden video element backing client-side Screen Sync capture */}
      <video ref={videoRef} muted playsInline className="hidden" />

      {/* Screen Sync (Local Browser OCR Position Tracker & Manual Position Calibrator) */}
      {screenSyncPanelOpen && (
        <div className="pointer-events-auto w-[360px] max-w-full max-h-[58vh] lg:max-h-[calc(100vh-240px)] overflow-y-auto rounded-xl bg-[#0d121a]/98 backdrop-blur-xl border border-white/[0.14] p-4 shadow-2xl space-y-3">
          <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-white/[0.08]">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-[#38bdf8] shrink-0" />
                <h3 className="font-display text-sm font-semibold text-[#f8fafc]">
                  Monitor 2 Position Sync
                </h3>
              </div>
              <p className="text-[11px] text-[#9fb0c4] mt-0.5 leading-relaxed">
                100% in-browser video OCR. Nothing leaves your PC; works on GitHub Pages HTTPS.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close screen sync panel"
              onClick={() => setScreenSyncPanelOpen(false)}
              className="p-1 rounded-lg text-[#8b98a9] hover:text-white hover:bg-white/[0.08]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Primary Automated Capture Action */}
          <div className="rounded-lg bg-[#080c12] border border-white/[0.08] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#eef3f8]">
                Auto Screen-Watcher
              </span>
              <span
                className={`font-mono-tabular text-[10px] font-semibold px-2 py-0.5 rounded ${
                  screenSyncActive
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-white/[0.06] text-[#94a3b8]"
                }`}
              >
                {screenSyncActive ? "ACTIVE" : "STANDBY"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {!screenSyncActive ? (
                <button
                  type="button"
                  onClick={startScreenSync}
                  className="flex-1 min-h-[36px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#38bdf8] hover:bg-[#5ccbfd] text-[#061018] font-semibold text-xs transition-colors"
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>Start Screen Sync (Select GZW Monitor)</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={stopScreenSync}
                    className="flex-1 min-h-[36px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/20 border border-red-500/60 hover:bg-red-500/30 text-red-200 font-semibold text-xs transition-colors"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Stop Screen Sync</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void runSingleOcrScan()}
                    className="min-h-[36px] px-3 py-2 rounded-lg bg-[#141d2b] border border-white/[0.12] hover:border-[#38bdf8] text-xs font-medium text-[#e2e8f0]"
                  >
                    Scan Now
                  </button>
                </>
              )}
            </div>

            <div className="text-[11px] text-[#9fb0c4] flex items-center justify-between gap-2">
              <span className="truncate">{ocrStatusText}</span>
              {livePlayerPos && (
                <span className="font-mono-tabular text-[#34d399] font-semibold shrink-0">
                  Grid {livePlayerPos.grid}
                </span>
              )}
            </div>

            {screenSyncError && (
              <div className="rounded-lg bg-red-950/50 border border-red-500/50 px-2.5 py-2 text-[11px] text-red-200">
                {screenSyncError}
              </div>
            )}

            {/* Scan Region Preset */}
            <div>
              <label className="block text-[11px] text-[#9fb0c4] mb-1">
                Coordinate Scan Area
              </label>
              <select
                aria-label="Coordinate Scan Area"
                value={scanPreset}
                onChange={(e) => {
                  const val = e.target.value as ScanRegionPreset;
                  setScanPreset(val);
                  if (val !== "custom") {
                    setCustomCrop(SCAN_PRESETS[val].rect);
                  }
                }}
                className="w-full bg-[#06090d] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-[#f1f5f9]"
              >
                <option value="bottom-right">Map Bottom-Right (M) — Recommended</option>
                <option value="top-center">Top HUD Strip</option>
                <option value="bottom-wide">Lower Corner Wide</option>
                <option value="custom">Custom Crop Region</option>
              </select>
            </div>

            {scanPreset === "custom" && (
              <div className="grid grid-cols-2 gap-2 pt-1 text-[10px] font-mono-tabular text-[#9fb0c4]">
                <label className="space-y-1">
                  <span>Left {customCrop.xPct}%</span>
                  <input
                    type="range"
                    min={0}
                    max={85}
                    value={customCrop.xPct}
                    onChange={(e) =>
                      setCustomCrop((c) => ({ ...c, xPct: Number(e.target.value) }))
                    }
                    className="w-full accent-[#38bdf8]"
                  />
                </label>
                <label className="space-y-1">
                  <span>Top {customCrop.yPct}%</span>
                  <input
                    type="range"
                    min={0}
                    max={85}
                    value={customCrop.yPct}
                    onChange={(e) =>
                      setCustomCrop((c) => ({ ...c, yPct: Number(e.target.value) }))
                    }
                    className="w-full accent-[#38bdf8]"
                  />
                </label>
                <label className="space-y-1">
                  <span>Width {customCrop.wPct}%</span>
                  <input
                    type="range"
                    min={10}
                    max={60}
                    value={customCrop.wPct}
                    onChange={(e) =>
                      setCustomCrop((c) => ({ ...c, wPct: Number(e.target.value) }))
                    }
                    className="w-full accent-[#38bdf8]"
                  />
                </label>
                <label className="space-y-1">
                  <span>Height {customCrop.hPct}%</span>
                  <input
                    type="range"
                    min={8}
                    max={50}
                    value={customCrop.hPct}
                    onChange={(e) =>
                      setCustomCrop((c) => ({ ...c, hPct: Number(e.target.value) }))
                    }
                    className="w-full accent-[#38bdf8]"
                  />
                </label>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 text-[11px] text-[#cbd5e1]">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoFollowLive}
                  onChange={(e) => setAutoFollowLive(e.target.checked)}
                  className="accent-[#10b981] w-3.5 h-3.5"
                />
                <span>Auto-pan map on update</span>
              </label>
              <select
                aria-label="Scan interval"
                value={scanIntervalMs}
                onChange={(e) => setScanIntervalMs(Number(e.target.value))}
                className="bg-[#06090d] border border-white/[0.1] rounded px-1.5 py-0.5 font-mono-tabular text-[10px] text-[#cbd5e1]"
              >
                <option value={900}>0.9s</option>
                <option value={1200}>1.2s</option>
                <option value={2000}>2.0s</option>
              </select>
            </div>

            {screenSyncActive && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono-tabular text-[#8b98a9]">
                  <span>Cropped OCR Feed</span>
                  <span className="truncate max-w-[170px] text-[#7dd3fc]">
                    {lastOcrRawText || "Scanning..."}
                  </span>
                </div>
                <canvas
                  ref={previewCanvasRef}
                  className="w-full rounded border border-white/[0.1] bg-[#05070b]"
                />
              </div>
            )}
          </div>

          {/* Instant Manual Position Anchor ("Mark My Pos" / Type Grid) */}
          <div className="rounded-lg bg-[#080c12] border border-white/[0.08] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#eef3f8]">
                Manual Position Anchor
              </span>
              {livePlayerPos && (
                <button
                  type="button"
                  onClick={() => setLivePlayerPos(null)}
                  className="text-[11px] text-red-300 hover:underline"
                >
                  Clear Pos
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={manualGridInput}
                onChange={(e) => setManualGridInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleApplyManualGridPos(manualGridInput);
                }}
                placeholder="Type grid e.g. 174 142"
                aria-label="Manual position grid square"
                className="flex-1 min-w-0 bg-[#05080d] border border-white/[0.1] focus:border-[#10b981] rounded-lg px-2.5 py-1.5 font-mono-tabular text-xs text-[#eef3f8] placeholder:text-[#66778b] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleApplyManualGridPos(manualGridInput)}
                className="px-3 py-1.5 rounded-lg bg-[#10b981]/20 border border-[#10b981]/60 hover:bg-[#10b981]/30 text-[#a7f3d0] text-xs font-semibold shrink-0"
              >
                Set
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                const next = !manualPosMode;
                setManualPosMode(next);
                if (next) {
                  setMeasureMode(false);
                  onTogglePinDropMode(false);
                  setScreenSyncPanelOpen(false);
                  onNotify("Click anywhere on Lamang Island to place 'You Are Here'");
                }
              }}
              className={`w-full min-h-[34px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                manualPosMode
                  ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
                  : "bg-[#121822] border-white/[0.1] text-[#cbd5e1] hover:border-[#10b981]"
              }`}
            >
              <Crosshair className="w-3.5 h-3.5 text-[#34d399]" />
              <span>
                {manualPosMode ? "Click Map Now..." : "Click Map to Mark My Pos"}
              </span>
            </button>
          </div>
        </div>
      )}

          </div>
        </div>
      </div>

      {/* Live Compass Bearing Lock HUD Banner (Monitor 2 Top-HUD Compass Readout) */}
      {navTarget && activeNavTelemetry && effectiveNavOrigin && (
        <div
          className={`absolute bottom-[78px] md:bottom-2.5 left-2.5 right-2.5 sm:right-auto md:left-1/2 md:-translate-x-1/2 z-[690] pointer-events-auto rounded-xl bg-[#0b1018]/96 backdrop-blur-xl border border-[#e5a93c]/65 shadow-2xl ${
            glanceMode ? "px-4 py-2.5" : "px-3 py-2"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[#e5a93c]/15 border border-[#e5a93c]/40 flex items-center justify-center shrink-0">
                <Compass className="w-4 h-4 text-[#e5a93c]" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`font-mono-tabular font-bold text-[#fde68a] tracking-tight ${
                      glanceMode ? "text-base sm:text-lg" : "text-sm"
                    }`}
                  >
                    HEAD {activeNavTelemetry.bearing}
                  </span>
                  <span className="font-mono-tabular text-xs font-semibold text-[#38bdf8]">
                    {activeNavTelemetry.dist} m
                  </span>
                  <span className="font-mono-tabular text-[11px] text-[#94a3b8]">
                    {activeNavTelemetry.etaLabel}
                  </span>
                </div>
                <div className="text-[11px] text-[#cbd5e1] truncate max-w-[260px] sm:max-w-[360px]">
                  <span className="text-[#7dd3fc]">{effectiveNavOrigin.label}</span>{" "}
                  ({effectiveNavOrigin.grid}) →{" "}
                  <strong className="text-white">{navTarget.label}</strong> ({navTarget.grid})
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 relative shrink-0">
              <button
                type="button"
                onClick={() => setOriginPickerOpen((v) => !v)}
                className="px-2 py-1 rounded-lg bg-[#141c28] border border-white/[0.1] hover:border-[#38bdf8] text-[11px] font-medium text-[#cbd5e1]"
              >
                Origin
              </button>
              <button
                type="button"
                onClick={handleLockExfilNearestLz}
                title="Lock bearing to nearest Exfil LZ"
                className="px-2 py-1 rounded-lg bg-[#141c28] border border-white/[0.1] hover:border-[#e5a93c] text-[11px] font-medium text-[#fde047]"
              >
                Exfil LZ
              </button>
              <button
                type="button"
                aria-label="Clear bearing lock"
                onClick={() => {
                  setNavTarget(null);
                  setNavOrigin(null);
                  setOriginPickerOpen(false);
                }}
                className="p-1 rounded-lg text-[#8b98a9] hover:text-white hover:bg-white/[0.08]"
              >
                <X className="w-3.5 h-3.5" />
              </button>

              {originPickerOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-60 rounded-xl bg-[#0d121a]/98 backdrop-blur-xl border border-white/[0.14] p-1.5 shadow-2xl z-[760] space-y-1">
                  <div className="px-2 py-1 text-[10px] font-mono-tabular uppercase text-[#8b98a9]">
                    Switch Bearing Origin
                  </div>
                  {livePlayerPos && (
                    <button
                      type="button"
                      onClick={() => {
                        setOriginLockedManually(false);
                        setNavOrigin({
                          x: livePlayerPos.x,
                          y: livePlayerPos.y,
                          label: "You Are Here",
                          grid: livePlayerPos.grid,
                          kind: "live",
                        });
                        setOriginPickerOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg bg-[#0d241c] hover:bg-[#123328] text-xs text-[#6ee7b7] flex items-center justify-between"
                    >
                      <span>You Are Here (Live)</span>
                      <span className="font-mono-tabular text-[10px]">{livePlayerPos.grid}</span>
                    </button>
                  )}
                  {activeFactionInfo && (
                    <button
                      type="button"
                      onClick={() => {
                        setOriginLockedManually(true);
                        setNavOrigin({
                          x: activeFactionInfo.x,
                          y: activeFactionInfo.y,
                          label: `${activeFactionInfo.short} FOB`,
                          grid: formatGridSquare(activeFactionInfo.x, activeFactionInfo.y),
                          kind: "fob",
                        });
                        setOriginPickerOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] text-xs text-[#eef3f8] flex items-center justify-between"
                    >
                      <span>{activeFactionInfo.short} Main FOB</span>
                      <span className="font-mono-tabular text-[10px] text-[#38bdf8]">
                        {formatGridSquare(activeFactionInfo.x, activeFactionInfo.y)}
                      </span>
                    </button>
                  )}
                  {LAMANG_POIS.filter((p) => p.kind === "lz")
                    .map((lz) => ({
                      lz,
                      dist: Math.round(
                        Math.hypot(lz.x - navTarget.x, lz.y - navTarget.y)
                      ),
                    }))
                    .sort((a, b) => a.dist - b.dist)
                    .slice(0, 4)
                    .map(({ lz, dist }) => (
                      <button
                        key={lz.id}
                        type="button"
                        onClick={() => {
                          setOriginLockedManually(true);
                          setNavOrigin({
                            x: lz.x,
                            y: lz.y,
                            label: `LZ ${lz.lz}`,
                            grid: formatGridSquare(lz.x, lz.y),
                            kind: "lz",
                          });
                          setOriginPickerOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] text-xs text-[#fde047] flex items-center justify-between"
                      >
                        <span className="truncate">LZ {lz.lz}</span>
                        <span className="font-mono-tabular text-[10px] text-[#94a3b8] shrink-0">
                          {dist} m
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Leaflet Canvas (keep ref element className static so Leaflet classes are never overwritten by React) */}
      <div
        className={`w-full h-full ${
          pinDropMode || measureMode || repositioningPin || manualPosMode
            ? "pin-drop-active"
            : ""
        } ${isResizing ? "pointer-events-none" : ""}`}
      >
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>

      {/* Minimal Bottom-Right Coordinate & Measure Telemetry */}
      <div className="absolute bottom-2.5 right-2.5 z-[650] pointer-events-auto bg-[#0d121a]/90 backdrop-blur-xl border border-white/[0.1] rounded-lg px-2.5 py-1.5 font-mono-tabular text-[11px] text-[#94a3b8] flex items-center gap-2 shadow-xl">
        {livePlayerPos && (
          <>
            <button
              type="button"
              onClick={() =>
                mapRef.current?.flyTo(
                  toLatLng(livePlayerPos.x, livePlayerPos.y),
                  16,
                  { duration: 0.45 }
                )
              }
              title="Center map on your current live position"
              className="text-[#34d399] hover:text-[#6ee7b7] font-semibold"
            >
              You {livePlayerPos.grid}
            </button>
            <span className="text-[#3a4657]">·</span>
          </>
        )}
        {measurePoints.length > 0 && (
          <>
            <span className="text-[#38bdf8] font-semibold">
              {measurePoints.length === 1
                ? `A: ${measurePoints[0].grid} (Click B)`
                : `${Math.round(
                    Math.hypot(
                      measurePoints[1].x - measurePoints[0].x,
                      measurePoints[1].y - measurePoints[0].y
                    )
                  )} m · ${formatBearing(
                    measurePoints[1].x - measurePoints[0].x,
                    measurePoints[1].y - measurePoints[0].y
                  )}`}
            </span>
            <button
              type="button"
              onClick={() => setMeasurePoints([])}
              className="text-[10px] text-[#e5a93c] hover:underline"
            >
              Clear
            </button>
            <span className="text-[#3a4657]">·</span>
          </>
        )}
        <span>
          Grid{" "}
          <strong className="text-[#e5a93c]">
            {formatGridSquare(cursorCoords.x, cursorCoords.y)}
          </strong>
        </span>
        <span className="hidden sm:inline text-[#3a4657]">·</span>
        <span className="hidden sm:inline">
          {cursorCoords.x}, {cursorCoords.y}
        </span>
        <span className="text-[#3a4657]">·</span>
        <span>Z{zoomLevel.toFixed(1)}</span>
      </div>

      {/* Map Reference Image Lightbox */}
      {mapLightbox && (
        <div
          className="fixed inset-0 z-[2100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setMapLightbox(null)}
        >
          <div
            className="max-w-2xl w-full rounded-md bg-[#0c1016] border border-[#2c3849] overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2.5 border-b border-[#212a36] flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[#eef3f8] truncate">
                {mapLightbox.title}
              </span>
              <button
                type="button"
                onClick={() => setMapLightbox(null)}
                className="p-1 rounded text-[#8b98a9] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 bg-[#070a0e] flex justify-center">
              <img
                src={mapLightbox.src}
                alt={mapLightbox.title}
                referrerPolicy="no-referrer"
                className="max-h-[75vh] w-auto object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
