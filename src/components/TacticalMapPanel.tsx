import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Compass,
  Crosshair,
  KeyRound,
  Layers,
  LocateFixed,
  MapPin,
  Navigation,
  X,
} from "lucide-react";
import {
  BLUE_CRATES_05,
  CHEMICAL_AREAS_05,
  DISASSEMBLY_SPAWNS_05,
  formatGridSquare,
  LAMANG_POIS,
  LAMANG_TILE_URL,
  MAP_EXTENT,
  type CustomMapPin,
  type MapLayerKey,
} from "../config/mapConfig";
import type { ItemSpawnLookupResult, NormalizedApiRecord } from "../services/gzwApi";
import {
  resolveSpawnPointsForMaterial,
  type CatalogMaterial,
} from "../utils/catalogBuilder";
import type { GzwTaskDef } from "../utils/taskBuilder";
import { ItemThumbnail } from "./ItemThumbnail";

interface TacticalMapPanelProps {
  catalog: CatalogMaterial[];
  customPins: CustomMapPin[];
  onAddPin: (pin: CustomMapPin) => void;
  onRemovePin: (pinId: string) => void;
  tickedMapMaterials: Record<string, boolean>;
  onToggleMapMaterial: (matKey: string, visible: boolean) => void;
  inspectedMaterial: CatalogMaterial | null;
  inspectedLookup: ItemSpawnLookupResult | null;
  isLookupLoading: boolean;
  onCloseInspect: () => void;
  inspectedTask: GzwTaskDef | null;
  onCloseInspectTask: () => void;
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

export function TacticalMapPanel({
  catalog,
  customPins,
  onAddPin,
  onRemovePin,
  tickedMapMaterials,
  onToggleMapMaterial,
  inspectedMaterial,
  inspectedLookup,
  isLookupLoading,
  onCloseInspect,
  inspectedTask,
  onCloseInspectTask,
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
  const layersRef = useRef<Record<MapLayerKey, L.LayerGroup>>({
    blueCrates: L.layerGroup(),
    pcSpawns: L.layerGroup(),
    chemicalAreas: L.layerGroup(),
    disassemblySpawns: L.layerGroup(),
    tickedSpawns: L.layerGroup(),
    apiLoot: L.layerGroup(),
    customPins: L.layerGroup(),
    poiLabels: L.layerGroup(),
    subLocations: L.layerGroup(),
    copsAndLzs: L.layerGroup(),
  });

  const [layerVisibility, setLayerVisibility] = useState<Record<MapLayerKey, boolean>>({
    blueCrates: true,
    pcSpawns: true,
    chemicalAreas: false,
    disassemblySpawns: false,
    tickedSpawns: true,
    apiLoot: false,
    customPins: true,
    poiLabels: true,
    subLocations: true,
    copsAndLzs: true,
  });

  const [layersOpen, setLayersOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [cursorCoords, setCursorCoords] = useState({ x: 7000, y: 4200 });
  const [zoomLevel, setZoomLevel] = useState(14);
  const [capturedCoords, setCapturedCoords] = useState<{ x: number; y: number } | null>(null);
  const [pinMaterialId, setPinMaterialId] = useState("");
  const [pinLayer, setPinLayer] = useState<"customPins" | "blueCrates" | "pcSpawns">("customPins");
  const [pinNote, setPinNote] = useState("");
  const [mapLightbox, setMapLightbox] = useState<{ src: string; title: string } | null>(null);

  useEffect(() => {
    if (preselectedPinMaterialId) {
      setPinMaterialId(preselectedPinMaterialId);
    }
  }, [preselectedPinMaterialId]);

  const pinDropModeRef = useRef(pinDropMode);
  pinDropModeRef.current = pinDropMode;

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

    L.tileLayer(LAMANG_TILE_URL, {
      minZoom: 13.5,
      maxZoom: 19,
      minNativeZoom: 14,
      maxNativeZoom: 19,
      tileSize: 256,
      bounds: L.latLngBounds(toLatLng(0, 0), toLatLng(14000, 8000)),
      keepBuffer: 4,
    }).addTo(map);

    map.fitBounds(L.latLngBounds(toLatLng(2800, 850), toLatLng(11200, 7300)));
    setZoomLevel(map.getZoom());

    (Object.keys(layersRef.current) as MapLayerKey[]).forEach((key) => {
      layersRef.current[key].addTo(map);
    });
    taskPinsLayerRef.current.addTo(map);

    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      setCursorCoords(fromLatLng(e.latlng));
    });

    map.on("zoomend", () => {
      setZoomLevel(map.getZoom());
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      setLayersOpen(false);
      setJumpOpen(false);
      if (!pinDropModeRef.current) return;
      const { x, y } = fromLatLng(e.latlng);
      const grid = formatGridSquare(x, y);
      setCapturedCoords({ x, y });
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(`${x}, ${y}`).catch(() => {});
      }
      onNotify(`Captured Grid ${grid} (${x}, ${y})`);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onNotify]);

  // Keep Leaflet sizing accurate when switching mobile views or dragging split divider
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      mapRef.current?.invalidateSize({ animate: false });
    });
    const t = setTimeout(() => {
      mapRef.current?.invalidateSize({ animate: false });
    }, 120);
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
        const first = inspectedTask.matchedPois[0];
        mapRef.current.flyTo(toLatLng(first.x, first.y), 16, { duration: 0.65 });
      } else {
        fitIslandView();
      }
    }
  }, [inspectedTask]);

  // Render clean, borderless, zoom-gated Update 0.5 markers
  useEffect(() => {
    const groups = layersRef.current;
    (Object.keys(groups) as MapLayerKey[]).forEach((k) => groups[k].clearLayers());

    const hasFocusedMaterial =
      !!inspectedMaterial || Object.values(tickedMapMaterials).some(Boolean);

    // 1. Primary POIs, Tier 4 Regions, Bases, Sub-Locations, COPs, LZs
    LAMANG_POIS.forEach((poi) => {
      if (zoomLevel < poi.minZoom) return;
      const ll = toLatLng(poi.x, poi.y);
      const grid = formatGridSquare(poi.x, poi.y);

      if (poi.kind === "base" || poi.kind === "tier4" || poi.kind === "major") {
        // Softly fade major region headers when deeply zoomed into building-level detail
        const fadeAtCloseZoom = zoomLevel >= 17.5 ? 0.45 : 1;
        const isTier4 = poi.kind === "tier4";
        const isBase = poi.kind === "base";
        const isExclusionCenter = poi.id === "poi-ground-zero";
        const mainColor = isTier4 ? "#fca5a5" : isBase ? "#93c5fd" : "#f1f5f9";
        const subColor = isTier4 ? "#ef4444" : isBase ? "#60a5fa" : "#e5a93c";

        const marker = L.marker(ll, {
          icon: L.divIcon({
            className: "gzw-map-label",
            html: `<div class="gzw-text-shadow" style="
              transform: translate(-50%, -50%);
              text-align: center;
              white-space: nowrap;
              opacity: ${fadeAtCloseZoom};
              pointer-events: auto;
              cursor: pointer;
            ">
              <div style="
                font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
                font-size: ${
                  isExclusionCenter
                    ? "10px"
                    : zoomLevel < 14.5
                      ? isTier4
                        ? "10.5px"
                        : "9.5px"
                      : isTier4
                        ? "11.5px"
                        : isBase
                          ? "10px"
                          : "10.5px"
                };
                font-weight: 700;
                letter-spacing: ${zoomLevel < 14.5 ? "0.06em" : "0.09em"};
                text-transform: uppercase;
                color: ${mainColor};
                line-height: 1.15;
              ">${escapeHtml(poi.name)}</div>
              <div style="
                font-family: 'JetBrains Mono', monospace;
                font-size: 9px;
                font-weight: 600;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                color: ${subColor};
                margin-top: 1px;
              ">${escapeHtml(poi.tier)}</div>
            </div>`,
            iconSize: [0, 0],
          }),
        });

        marker.bindPopup(
          `<div style="min-width:210px;">
            <div style="font-size:10px;font-family:monospace;color:${subColor};font-weight:700;text-transform:uppercase;">${escapeHtml(poi.tier)} · ${escapeHtml(poi.faction)}</div>
            <div style="font-size:14px;font-weight:700;margin-top:2px;color:#f8fafc;">${escapeHtml(poi.name)}</div>
            <div style="font-size:11px;color:#cbd5e1;margin-top:4px;">Nearest LZs: ${escapeHtml(poi.lz)}</div>
            <div style="font-family:monospace;font-size:10px;color:#38bdf8;margin-top:4px;">Grid ${grid} · ${poi.x}, ${poi.y}</div>
          </div>`
        );
        marker.addTo(groups.poiLabels);
      } else if (poi.kind === "sublocation") {
        // Dim compounds when user is inspecting a specific material so spawn pins stand out
        const opacity = hasFocusedMaterial && zoomLevel < 17 ? 0.55 : 0.92;
        const isT4Sub = poi.tier === "Tier 4";
        const dotColor = isT4Sub ? "#f87171" : "#94a3b8";
        const textColor = isT4Sub ? "#fee2e2" : "#e2e8f0";

        const marker = L.marker(ll, {
          icon: L.divIcon({
            className: "gzw-map-label",
            html: `<div class="gzw-text-shadow" style="
              display: inline-flex;
              align-items: center;
              gap: 4px;
              transform: translate(-4px, -50%);
              white-space: nowrap;
              opacity: ${opacity};
              cursor: pointer;
            ">
              <span style="width:4px;height:4px;border-radius:9999px;background:${dotColor};flex-shrink:0;"></span>
              <span style="
                font-family: 'Public Sans', system-ui, sans-serif;
                font-size: 10px;
                font-weight: 600;
                letter-spacing: 0.02em;
                color: ${textColor};
              ">${escapeHtml(poi.name)}</span>
            </div>`,
            iconSize: [0, 0],
          }),
        });
        marker.bindPopup(
          `<div style="min-width:190px;">
            <div style="font-size:10px;font-family:monospace;color:#38bdf8;font-weight:700;">${escapeHtml(poi.parentRegion || poi.tier)}</div>
            <div style="font-size:13px;font-weight:700;margin-top:2px;">${escapeHtml(poi.name)}</div>
            <div style="font-size:11px;color:#cbd5e1;margin-top:3px;">Nearest LZ: ${escapeHtml(poi.lz)}</div>
            <div style="font-family:monospace;font-size:10px;color:#94a3b8;margin-top:3px;">Grid ${grid} · ${poi.x}, ${poi.y}</div>
          </div>`
        );
        marker.addTo(groups.subLocations);
      } else if (poi.kind === "cop") {
        const shortName = poi.name.replace(/^Outpost\s+/i, "");
        const marker = L.marker(ll, {
          icon: L.divIcon({
            className: "gzw-map-label",
            html: `<div class="gzw-text-shadow" style="
              display: inline-flex;
              align-items: center;
              gap: 4px;
              transform: translate(-6px, -50%);
              white-space: nowrap;
              cursor: pointer;
            ">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M6 1.5L11 10.5H1L6 1.5Z" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5"/>
              </svg>
              <span style="
                font-family: 'JetBrains Mono', monospace;
                font-size: 9.5px;
                font-weight: 600;
                color: #bae6fd;
              ">${escapeHtml(shortName)}</span>
            </div>`,
            iconSize: [0, 0],
          }),
        });
        marker.bindPopup(
          `<div style="min-width:170px;">
            <div style="font-size:10px;font-family:monospace;color:#38bdf8;font-weight:700;">COMBAT OUTPOST</div>
            <div style="font-size:13px;font-weight:700;margin-top:2px;">${escapeHtml(poi.name)}</div>
            <div style="font-size:11px;color:#cbd5e1;margin-top:2px;">Region: ${escapeHtml(poi.parentRegion || "Lamang")}</div>
            <div style="font-family:monospace;font-size:10px;color:#94a3b8;margin-top:3px;">Grid ${grid}</div>
          </div>`
        );
        marker.addTo(groups.copsAndLzs);
      } else if (poi.kind === "lz") {
        const marker = L.marker(ll, {
          icon: L.divIcon({
            className: "gzw-map-label",
            html: `<div class="gzw-text-shadow" style="
              display: inline-flex;
              align-items: center;
              gap: 4px;
              transform: translate(-5px, -50%);
              white-space: nowrap;
              cursor: pointer;
            ">
              <span style="
                width: 8px;
                height: 8px;
                transform: rotate(45deg);
                background: #eab308;
                border: 1px solid #090d12;
                flex-shrink: 0;
              "></span>
              <span style="
                font-family: 'JetBrains Mono', monospace;
                font-size: 9.5px;
                font-weight: 700;
                color: #fde047;
              ">${escapeHtml(poi.lz)}</span>
            </div>`,
            iconSize: [0, 0],
          }),
        });
        marker.bindPopup(
          `<div style="min-width:165px;">
            <div style="font-size:10px;font-family:monospace;color:#eab308;font-weight:700;">LANDING ZONE</div>
            <div style="font-size:13px;font-weight:700;margin-top:2px;">${escapeHtml(poi.name)}</div>
            <div style="font-size:11px;color:#cbd5e1;margin-top:2px;">Region: ${escapeHtml(poi.faction)}</div>
            <div style="font-family:monospace;font-size:10px;color:#94a3b8;margin-top:3px;">Grid ${grid}</div>
          </div>`
        );
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
      popupEl.style.minWidth = "190px";
      popupEl.innerHTML = `
        <div style="font-size:10px;font-family:monospace;color:${style.color};font-weight:700;">${style.title}</div>
        <div style="font-weight:600;font-size:13px;margin:3px 0;">${escapeHtml(pin.label)}</div>
        ${linkedMat ? `<div style="font-size:11px;color:#cbd5e1;">Material: ${escapeHtml(linkedMat.name)}</div>` : ""}
        <div style="font-family:monospace;font-size:10px;color:#94a3b8;margin-top:4px;">Grid ${formatGridSquare(pin.x, pin.y)} · ${pin.x}, ${pin.y}</div>
      `;

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "Remove Pin";
      removeBtn.style.cssText =
        "margin-top:8px;background:#261215;border:1px solid #ef4444;color:#fca5a5;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;";
      removeBtn.onclick = () => onRemovePin(pin.id);
      popupEl.appendChild(removeBtn);

      const marker = L.marker(toLatLng(pin.x, pin.y), {
        icon: createTargetPinIcon(style.color, style.glyph),
      }).bindPopup(popupEl);

      marker.addTo(groups[pin.layer] || groups.customPins);
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

    // 7. API records with coordinates
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
  }, [catalog, customPins, tickedMapMaterials, inspectedMaterial, apiRecords, onRemovePin, zoomLevel]);

  const quickJumpPois = useMemo(() => {
    const list = LAMANG_POIS.filter(
      (p) => (p.kind === "tier4" || p.kind === "major") && p.id !== "poi-ground-zero"
    );
    const tierOrder = (t: string) =>
      t === "Tier 4" ? 0 : t === "Tier 3" ? 1 : t === "Tier 2" ? 2 : 3;
    return list.sort((a, b) => tierOrder(a.tier) - tierOrder(b.tier) || a.name.localeCompare(b.name));
  }, []);

  const activeLayerCount = useMemo(
    () => Object.values(layerVisibility).filter(Boolean).length,
    [layerVisibility]
  );

  const handleSavePin = () => {
    if (!capturedCoords) return;
    const linked = catalog.find(
      (m) => m.id === pinMaterialId || m.key === pinMaterialId
    );
    onAddPin({
      id: `pin_${Date.now()}`,
      x: capturedCoords.x,
      y: capturedCoords.y,
      layer: pinLayer,
      materialId: pinMaterialId,
      label: pinNote.trim() || linked?.name || "Recon Pin",
    });
    setPinNote("");
    setCapturedCoords(null);
    onNotify(`Saved pin at Grid ${formatGridSquare(capturedCoords.x, capturedCoords.y)}`);
  };

  return (
    <section className="relative flex-1 h-full min-h-0 bg-[#06090d] overflow-hidden">
      {/* Compact Floating Map Controls */}
      <div className="absolute top-2.5 left-2.5 right-2.5 z-[650] flex items-start justify-between gap-1.5 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1.5 relative">
          {/* Region Quick-Jump Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setJumpOpen((v) => !v);
                setLayersOpen(false);
              }}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#0c1016]/92 backdrop-blur-md border border-[#242e3c] hover:border-[#3c4b61] text-xs font-medium text-[#dce4ee] shadow-xl transition-colors"
            >
              <Navigation className="w-3.5 h-3.5 text-[#e5a93c]" />
              <span className="hidden sm:inline">Locate Region</span>
              <span className="sm:hidden">Regions</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#7f8ea1]" />
            </button>

            {jumpOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-60 max-h-72 overflow-y-auto rounded-md bg-[#0c1016]/96 backdrop-blur-xl border border-[#242e3c] p-1.5 shadow-2xl z-[800]">
                {quickJumpPois.map((poi) => (
                  <button
                    key={poi.id}
                    type="button"
                    onClick={() => {
                      mapRef.current?.flyTo(toLatLng(poi.x, poi.y), 16, { duration: 0.65 });
                      setJumpOpen(false);
                    }}
                    className="w-full min-h-[36px] text-left px-2.5 py-1.5 rounded hover:bg-[#151d28] flex items-center justify-between gap-2 text-xs transition-colors"
                  >
                    <span className="text-[#eef3f8] font-medium truncate">{poi.name}</span>
                    <span
                      className={`font-mono-tabular text-[10px] shrink-0 ${
                        poi.kind === "tier4"
                          ? "text-red-400"
                          : poi.tier === "Tier 3"
                            ? "text-[#e5a93c]"
                            : "text-[#8b98a9]"
                      }`}
                    >
                      {poi.tier}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Compact Layers Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setLayersOpen((v) => !v);
                setJumpOpen(false);
              }}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#0c1016]/92 backdrop-blur-md border border-[#242e3c] hover:border-[#3c4b61] text-xs font-medium text-[#dce4ee] shadow-xl transition-colors"
            >
              <Layers className="w-3.5 h-3.5 text-[#38bdf8]" />
              <span>Layers</span>
              <span className="font-mono-tabular text-[10px] text-[#8b98a9]">
                ({activeLayerCount})
              </span>
            </button>

            {layersOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-60 rounded-md bg-[#0c1016]/96 backdrop-blur-xl border border-[#242e3c] p-2.5 shadow-2xl z-[800] space-y-1.5">
                {(
                  [
                    { key: "poiLabels", label: "Regions & Tier 4", dot: "bg-red-400" },
                    { key: "subLocations", label: "Compounds (Zoomed)", dot: "bg-slate-300" },
                    { key: "copsAndLzs", label: "COPs & LZs (Zoomed)", dot: "bg-yellow-400" },
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
                    className="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-[#141b25] text-xs text-[#cbd5e1] cursor-pointer select-none"
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

        {/* Top-Right Compact Controls */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onTogglePinDropMode()}
            className={`min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium backdrop-blur-md shadow-xl transition-colors whitespace-nowrap shrink-0 ${
              pinDropMode
                ? "bg-cyan-500/20 border border-cyan-400 text-cyan-200"
                : "bg-[#0c1016]/92 border border-[#242e3c] text-[#dce4ee] hover:border-[#3c4b61]"
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{pinDropMode ? "Pin Drop: On" : "Pin Drop"}</span>
            <span className="sm:hidden">{pinDropMode ? "Pin: On" : "Pin"}</span>
          </button>

          <button
            type="button"
            onClick={fitIslandView}
            title="Reset Island View"
            className="min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-[#0c1016]/92 backdrop-blur-md border border-[#242e3c] text-[#dce4ee] hover:border-[#3c4b61] shadow-xl transition-colors whitespace-nowrap shrink-0"
          >
            <LocateFixed className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset View</span>
          </button>
        </div>
      </div>

      {/* Task AO & Full Walkthrough Slide-Over Drawer */}
      {inspectedTask && !inspectedMaterial && (
        <div className="absolute top-14 left-2.5 z-[710] w-[385px] max-w-[calc(100%-20px)] max-h-[58vh] lg:max-h-[calc(100%-84px)] overflow-y-auto rounded-md bg-[#0c1016]/96 backdrop-blur-xl border border-[#38bdf8]/60 p-3.5 shadow-2xl">
          <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#212a36]">
            <div className="min-w-0">
              <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[#38bdf8]">
                {inspectedTask.vendor} · {inspectedTask.areas.join(", ")} · {inspectedTask.category}
              </div>
              <h3 className="font-display text-sm font-semibold text-[#eef3f8] leading-snug mt-0.5">
                {inspectedTask.name}
              </h3>
            </div>
            <div className="flex items-center gap-1 shrink-0">
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
                    <button
                      key={`coord-${coord.grid}`}
                      type="button"
                      onClick={() =>
                        mapRef.current?.flyTo(toLatLng(coord.x, coord.y), 17, {
                          duration: 0.55,
                        })
                      }
                      className="w-full text-left px-2.5 py-2 rounded bg-[#14120c] border border-[#e5a93c]/40 hover:border-[#e5a93c] transition-colors flex items-center justify-between gap-2"
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
                  ))}

                  {inspectedTask.matchedPois.map((poi) => (
                    <button
                      key={poi.id}
                      type="button"
                      onClick={() =>
                        mapRef.current?.flyTo(toLatLng(poi.x, poi.y), 16.5, {
                          duration: 0.6,
                        })
                      }
                      className="w-full text-left px-2.5 py-2 rounded bg-[#080b0f] border border-[#1f2834] hover:border-[#38bdf8] transition-colors flex items-center justify-between gap-2"
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

            {/* Boss Warning & Tactical Tip */}
            {(inspectedTask.bossWarning || inspectedTask.guideTip) && (
              <div className="rounded bg-[#18120c] border border-[#e5a93c]/40 px-2.5 py-2 space-y-1 text-[11px] text-[#f3d49b]">
                {inspectedTask.bossWarning && (
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#f59e0b] shrink-0 mt-0.5" />
                    <span>{inspectedTask.bossWarning}</span>
                  </div>
                )}
                {inspectedTask.guideTip && (
                  <div className="text-[#cbd5e1]">
                    Tip: {inspectedTask.guideTip}
                  </div>
                )}
              </div>
            )}

            {/* Full Vendor Briefing */}
            {inspectedTask.briefing && (
              <div className="text-[11px] text-[#9fb0c4] leading-relaxed border-l-2 border-[#2a3646] pl-2.5">
                <div className="font-mono-tabular text-[9px] uppercase tracking-wider text-[#6f7e91] mb-0.5">
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
        <div className="absolute top-14 left-2.5 z-[710] w-[335px] max-w-[calc(100%-20px)] max-h-[50vh] lg:max-h-[calc(100%-96px)] overflow-y-auto rounded-md bg-[#0c1016]/95 backdrop-blur-xl border border-[#38bdf8]/50 p-3.5 shadow-2xl">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#212a36]">
            <div className="flex items-center gap-3 min-w-0">
              <ItemThumbnail
                src={inspectedMaterial.image}
                alt={inspectedMaterial.name}
                sizeClass="w-10 h-10"
              />
              <div className="min-w-0">
                <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-[#38bdf8]">
                  Reported Spawn Locations
                </div>
                <h3 className="font-display text-sm font-semibold text-[#eef3f8] truncate">
                  {inspectedMaterial.name}
                </h3>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close spawn drawer"
              onClick={onCloseInspect}
              className="p-1 rounded text-[#8b98a9] hover:text-white hover:bg-[#1a222d]"
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

      {/* Pin Drop Quick-Attach Modal */}
      {capturedCoords && (
        <div className="absolute top-14 right-3 z-[720] w-[290px] rounded-md bg-[#0c1016]/96 backdrop-blur-xl border border-[#38bdf8]/60 p-4 shadow-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#38bdf8]">
              Grid {formatGridSquare(capturedCoords.x, capturedCoords.y)} Captured
            </span>
            <button
              type="button"
              onClick={() => setCapturedCoords(null)}
              className="p-1 rounded text-[#8b98a9] hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div>
            <label className="block text-[11px] text-[#8b98a9] mb-1">
              Captured Coordinates
            </label>
            <input
              type="text"
              readOnly
              value={`${capturedCoords.x}, ${capturedCoords.y}`}
              className="w-full bg-[#070a0e] border border-[#222b38] rounded px-2.5 py-1.5 font-mono-tabular text-xs text-[#38bdf8]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#8b98a9] mb-1">
              Attach Pin to Material
            </label>
            <select
              value={pinMaterialId}
              onChange={(e) => setPinMaterialId(e.target.value)}
              className="w-full bg-[#070a0e] border border-[#222b38] rounded px-2.5 py-1.5 text-xs text-[#dce4ee]"
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
            <label className="block text-[11px] text-[#8b98a9] mb-1">
              Layer Category
            </label>
            <select
              value={pinLayer}
              onChange={(e) =>
                setPinLayer(
                  e.target.value as "customPins" | "blueCrates" | "pcSpawns"
                )
              }
              className="w-full bg-[#070a0e] border border-[#222b38] rounded px-2.5 py-1.5 text-xs text-[#dce4ee]"
            >
              <option value="customPins">Custom Item Pin (Green)</option>
              <option value="blueCrates">Blue-Planked Crate (Blue)</option>
              <option value="pcSpawns">PC Part Spawn (Cyan)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[#8b98a9] mb-1">
              Location Note
            </label>
            <input
              type="text"
              value={pinNote}
              onChange={(e) => setPinNote(e.target.value)}
              placeholder="e.g. Northern Reach Armory shelf"
              className="w-full bg-[#070a0e] border border-[#222b38] rounded px-2.5 py-1.5 text-xs text-[#eef3f8] placeholder:text-[#5d6b7c]"
            />
          </div>

          <button
            type="button"
            onClick={handleSavePin}
            className="w-full py-2 px-4 rounded bg-[#e5a93c] hover:bg-[#f0b94d] text-[#0c0f14] font-semibold text-xs transition-colors"
          >
            Save Map Pin
          </button>
        </div>
      )}

      {/* Leaflet Canvas (keep ref element className static so Leaflet classes are never overwritten by React) */}
      <div
        className={`w-full h-full ${pinDropMode ? "pin-drop-active" : ""} ${
          isResizing ? "pointer-events-none" : ""
        }`}
      >
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>

      {/* Minimal Bottom-Right Coordinate Telemetry */}
      <div className="absolute bottom-2.5 right-2.5 z-[650] pointer-events-auto bg-[#0c1016]/88 backdrop-blur-md border border-[#242e3c] rounded px-2 py-1 font-mono-tabular text-[11px] text-[#8b98a9] flex items-center gap-2 shadow-lg">
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
