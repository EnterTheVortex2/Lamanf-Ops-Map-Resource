import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckSquare,
  GripVertical,
  Hammer,
  KeyRound,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
} from "lucide-react";
import {
  DEFAULT_SEED_PINS,
  doesTaskBelongToFaction,
  FACTIONS,
  type CustomMapPin,
  type FactionId,
} from "./config/mapConfig";
import type { HideoutUpgradeDef } from "./data/hideoutData";
import {
  HideoutTrackerPanel,
  type PlannerViewId,
} from "./components/HideoutTrackerPanel";
import { KeysDoorsPanel } from "./components/KeysDoorsPanel";
import { TasksTrackerPanel } from "./components/TasksTrackerPanel";
import { TacticalMapPanel } from "./components/TacticalMapPanel";
import { VendorShopPanel } from "./components/VendorShopPanel";
import {
  discoverAndFetchAllDatasets,
  loadCachedApiData,
  lookupMaterialSpawnIntel,
  safeStorageGet,
  safeStorageSet,
  type ApiCachePayload,
  type ItemSpawnLookupResult,
  type NormalizedApiRecord,
} from "./services/gzwApi";
import {
  buildAllHideoutUpgrades,
  buildDisassemblyRecipes,
  buildMaterialsCatalog,
  type CatalogMaterial,
} from "./utils/catalogBuilder";
import { buildKeysAndDoorsCatalog, type GzwKeyDoorDef } from "./utils/keyBuilder";
import {
  buildAllTasks,
  buildVendorProfiles,
  type GzwTaskDef,
} from "./utils/taskBuilder";
import { buildVendorShopCatalog } from "./utils/vendorBuilder";

const BUILT_KEY = "lamang_ops_built_upgrades_v1";
const PLANNED_KEY = "lamang_ops_planned_upgrades_v1";
const STASH_KEY = "lamang_ops_stash_counts_v1";
const COMPLETED_TASKS_KEY = "lamang_ops_completed_tasks_v1";
const OWNED_KEYS_KEY = "lamang_ops_owned_keys_v1";
const MAP_TICKED_KEY = "lamang_ops_ticked_materials_v5";
const CUSTOM_PINS_KEY = "lamang_ops_custom_pins_v5";
const PANEL_WIDTH_KEY = "lamang_ops_panel_width_v1";
const FACTION_KEY = "lamang_ops_faction_v1";

const DEFAULT_COMPACT_WIDTH = 468;
const MIN_PANEL_WIDTH = 360;

type ApiStatusMode = "loading" | "live" | "cached" | "error";
type WorkspaceMode = "hideout" | "tasks" | "vendors" | "keys";
type MobileTab = "hideout" | "tasks" | "vendors" | "keys" | "map";

function clampPanelWidth(rawWidth: number): number {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const maxAllowed = Math.max(460, Math.min(960, Math.round(vw * 0.72)));
  return Math.max(MIN_PANEL_WIDTH, Math.min(maxAllowed, Math.round(rawWidth)));
}

export default function App() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("hideout");
  const [mobileTab, setMobileTab] = useState<MobileTab>("hideout");
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true
  );
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = safeStorageGet<number>(PANEL_WIDTH_KEY, DEFAULT_COMPACT_WIDTH);
    return clampPanelWidth(typeof saved === "number" ? saved : DEFAULT_COMPACT_WIDTH);
  });
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;

  const isWidePanel = panelWidth >= 660;

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      setIsDesktop(mq.matches);
      setPanelWidth((prev) => clampPanelWidth(prev));
    };
    update();
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const toggleExpandPreset = useCallback(() => {
    setPanelWidth((prev) => {
      const target =
        prev >= 620
          ? DEFAULT_COMPACT_WIDTH
          : clampPanelWidth(Math.round(window.innerWidth * 0.56));
      safeStorageSet(PANEL_WIDTH_KEY, target);
      return target;
    });
  }, []);

  const handleSplitterPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panelWidthRef.current;
      setIsDraggingSplitter(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      let rafId = 0;
      const onPointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = clampPanelWidth(startWidth + delta);
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          setPanelWidth(nextWidth);
        });
      };

      const onPointerUp = () => {
        if (rafId) cancelAnimationFrame(rafId);
        setIsDraggingSplitter(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        safeStorageSet(PANEL_WIDTH_KEY, panelWidthRef.current);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    []
  );

  const [activeView, setActiveView] = useState<PlannerViewId>("planner");
  const [apiCache, setApiCache] = useState<ApiCachePayload | null>(() =>
    loadCachedApiData()
  );
  const [apiStatus, setApiStatus] = useState<{
    mode: ApiStatusMode;
    label: string;
  }>(() => {
    const cached = loadCachedApiData();
    if (cached) {
      const count = Object.values(cached.datasets).reduce(
        (acc, list) => acc + list.length,
        0
      );
      return { mode: "cached", label: `Cached (${count.toLocaleString()})` };
    }
    return { mode: "loading", label: "Syncing data..." };
  });

  const [builtUpgrades, setBuiltUpgrades] = useState<Record<string, boolean>>(() =>
    safeStorageGet<Record<string, boolean>>(BUILT_KEY, {})
  );
  const [plannedUpgrades, setPlannedUpgrades] = useState<Record<string, boolean>>(
    () => safeStorageGet<Record<string, boolean>>(PLANNED_KEY, {})
  );
  const [stashCounts, setStashCounts] = useState<Record<string, number>>(() =>
    safeStorageGet<Record<string, number>>(STASH_KEY, {})
  );
  const [completedTasks, setCompletedTasks] = useState<Record<string, boolean>>(
    () => safeStorageGet<Record<string, boolean>>(COMPLETED_TASKS_KEY, {})
  );
  const [ownedKeys, setOwnedKeys] = useState<Record<string, boolean>>(() =>
    safeStorageGet<Record<string, boolean>>(OWNED_KEYS_KEY, {})
  );
  const [tickedMapMaterials, setTickedMapMaterials] = useState<
    Record<string, boolean>
  >(() => safeStorageGet<Record<string, boolean>>(MAP_TICKED_KEY, {}));
  const [customPins, setCustomPins] = useState<CustomMapPin[]>(() =>
    safeStorageGet<CustomMapPin[]>(CUSTOM_PINS_KEY, DEFAULT_SEED_PINS)
  );
  const [selectedFaction, setSelectedFaction] = useState<FactionId>(() => {
    const saved = safeStorageGet<string>(FACTION_KEY, "ALL");
    return saved === "LRI" || saved === "MSS" || saved === "CSI" ? saved : "ALL";
  });

  const [selectedUpgrade, setSelectedUpgrade] =
    useState<HideoutUpgradeDef | null>(null);
  const [inspectedMaterial, setInspectedMaterial] =
    useState<CatalogMaterial | null>(null);
  const [inspectedLookup, setInspectedLookup] =
    useState<ItemSpawnLookupResult | null>(null);
  const [isLookupLoading, setIsLookupLoading] = useState(false);
  const [inspectedTask, setInspectedTask] = useState<GzwTaskDef | null>(null);
  const [inspectedKey, setInspectedKey] = useState<GzwKeyDoorDef | null>(null);

  const [pinDropMode, setPinDropMode] = useState(false);
  const [preselectedPinMatId, setPreselectedPinMatId] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const handleRefreshApi = useCallback(
    async (isManual = false) => {
      setApiStatus({ mode: "loading", label: "Syncing data..." });
      try {
        const fresh = await discoverAndFetchAllDatasets(isManual);
        setApiCache(fresh);
        const total = Object.values(fresh.datasets).reduce(
          (acc, list) => acc + list.length,
          0
        );
        setApiStatus({ mode: "live", label: `${total.toLocaleString()} items live` });
        if (isManual) {
          showToast(
            `Updated ${total.toLocaleString()} items across ${fresh.discoveredDatasets.length} datasets`
          );
        }
      } catch {
        const existing = loadCachedApiData();
        if (existing) {
          const total = Object.values(existing.datasets).reduce(
            (acc, list) => acc + list.length,
            0
          );
          setApiStatus({ mode: "cached", label: `Cached (${total.toLocaleString()})` });
          if (isManual) showToast("Server busy — using cached game data");
        } else {
          setApiStatus({ mode: "error", label: "Offline 0.5 data" });
          if (isManual) showToast("Using built-in Update 0.5 dataset");
        }
      }
    },
    [showToast]
  );

  useEffect(() => {
    handleRefreshApi(false);
  }, [handleRefreshApi]);

  const allUpgrades = useMemo(
    () => buildAllHideoutUpgrades(apiCache),
    [apiCache]
  );
  const catalog = useMemo(
    () => buildMaterialsCatalog(apiCache, allUpgrades),
    [apiCache, allUpgrades]
  );
  const disassemblyRecipes = useMemo(
    () => buildDisassemblyRecipes(apiCache),
    [apiCache]
  );
  const vendors = useMemo(() => buildVendorProfiles(apiCache), [apiCache]);
  const vendorShopItems = useMemo(
    () => buildVendorShopCatalog(apiCache),
    [apiCache]
  );
  const allTasks = useMemo(() => buildAllTasks(apiCache), [apiCache]);
  const keysCatalog = useMemo(
    () => buildKeysAndDoorsCatalog(apiCache, allTasks),
    [apiCache, allTasks]
  );

  const builtCount = useMemo(
    () => allUpgrades.filter((u) => builtUpgrades[u.id]).length,
    [allUpgrades, builtUpgrades]
  );

  const factionTasks = useMemo(
    () =>
      selectedFaction === "ALL"
        ? allTasks
        : allTasks.filter((t) =>
            doesTaskBelongToFaction(t.faction, t.areas, selectedFaction)
          ),
    [allTasks, selectedFaction]
  );

  const completedTasksCount = useMemo(
    () => factionTasks.filter((t) => completedTasks[t.id]).length,
    [factionTasks, completedTasks]
  );

  const ownedKeysCount = useMemo(
    () => keysCatalog.filter((k) => ownedKeys[k.id]).length,
    [keysCatalog, ownedKeys]
  );

  const allApiRecords = useMemo(() => {
    const list: NormalizedApiRecord[] = [];
    if (!apiCache?.datasets) return list;
    Object.values(apiCache.datasets).forEach((arr) => {
      if (Array.isArray(arr)) list.push(...arr);
    });
    return list;
  }, [apiCache]);

  const handleToggleBuilt = useCallback((upgradeId: string) => {
    setBuiltUpgrades((prev) => {
      const next = { ...prev, [upgradeId]: !prev[upgradeId] };
      safeStorageSet(BUILT_KEY, next);
      return next;
    });
  }, []);

  const handleTogglePlanned = useCallback((upgradeId: string) => {
    setPlannedUpgrades((prev) => {
      const next = { ...prev, [upgradeId]: !prev[upgradeId] };
      safeStorageSet(PLANNED_KEY, next);
      return next;
    });
  }, []);

  const handleSetStashCount = useCallback((key: string, value: number) => {
    setStashCounts((prev) => {
      const next = { ...prev, [key]: Math.max(0, value) };
      safeStorageSet(STASH_KEY, next);
      return next;
    });
  }, []);

  const handleToggleTaskComplete = useCallback((taskId: string) => {
    setCompletedTasks((prev) => {
      const next = { ...prev, [taskId]: !prev[taskId] };
      safeStorageSet(COMPLETED_TASKS_KEY, next);
      return next;
    });
  }, []);

  const handleToggleOwnedKey = useCallback((keyId: string) => {
    setOwnedKeys((prev) => {
      const next = { ...prev, [keyId]: !prev[keyId] };
      safeStorageSet(OWNED_KEYS_KEY, next);
      return next;
    });
  }, []);

  const handleToggleMapMaterial = useCallback(
    (matKey: string, visible: boolean) => {
      setTickedMapMaterials((prev) => {
        const next = { ...prev, [matKey]: visible };
        safeStorageSet(MAP_TICKED_KEY, next);
        return next;
      });
      if (visible) showToast("Material spawn zones pinned to map");
    },
    [showToast]
  );

  const handleInspectMaterial = useCallback(async (mat: CatalogMaterial) => {
    setInspectedTask(null);
    setInspectedKey(null);
    setInspectedMaterial(mat);
    setInspectedLookup(null);
    setIsLookupLoading(true);
    if (window.innerWidth < 1024) {
      setMobileTab("map");
    }
    try {
      const lookup = await lookupMaterialSpawnIntel(mat.name);
      setInspectedLookup(lookup);
    } finally {
      setIsLookupLoading(false);
    }
  }, []);

  const handleLocateTaskOnMap = useCallback((task: GzwTaskDef) => {
    setInspectedMaterial(null);
    setInspectedKey(null);
    setInspectedTask(task);
    if (window.innerWidth < 1024) {
      setMobileTab("map");
    }
  }, []);

  const handleLocateKeyOnMap = useCallback((keyDef: GzwKeyDoorDef) => {
    setInspectedMaterial(null);
    setInspectedTask(null);
    setInspectedKey(keyDef);
    if (window.innerWidth < 1024) {
      setMobileTab("map");
    }
  }, []);

  const handleInspectApiRecord = useCallback(
    (rec: NormalizedApiRecord) => {
      const existing = catalog.find(
        (m) => m.name.toLowerCase() === rec.name.toLowerCase()
      );
      if (existing) {
        handleInspectMaterial(existing);
        return;
      }
      handleInspectMaterial({
        key: rec.uid,
        id: rec.id,
        name: rec.name,
        room: "all",
        dataset: rec.dataset,
        required: 1,
        tiersUsed: [],
        layerHint: "apiLoot",
        image: rec.image,
        description: rec.description || `Record from ${rec.dataset}`,
        weight: rec.weight,
        gridSize: rec.gridSize,
        sellPrice: rec.sellPrice,
        spawnNotes: rec.spawnNotes.length
          ? rec.spawnNotes
          : [`${rec.dataset.replace(/_/g, " ")} spawn`],
        usedInUpgrades: [],
        apiCoords: rec.coords ? [{ ...rec.coords, label: rec.name }] : [],
      });
    },
    [catalog, handleInspectMaterial]
  );

  const handleAddPin = useCallback((pin: CustomMapPin) => {
    setCustomPins((prev) => {
      const next = [...prev, pin];
      safeStorageSet(CUSTOM_PINS_KEY, next);
      return next;
    });
  }, []);

  const handleUpdatePin = useCallback(
    (updated: CustomMapPin) => {
      setCustomPins((prev) => {
        const next = prev.map((p) => (p.id === updated.id ? updated : p));
        safeStorageSet(CUSTOM_PINS_KEY, next);
        return next;
      });
      showToast("Map pin updated");
    },
    [showToast]
  );

  const handleRemovePin = useCallback(
    (pinId: string) => {
      setCustomPins((prev) => {
        const next = prev.filter((p) => p.id !== pinId);
        safeStorageSet(CUSTOM_PINS_KEY, next);
        return next;
      });
      showToast("Map pin removed");
    },
    [showToast]
  );

  const handleResetProgress = () => {
    if (workspaceMode === "tasks") {
      setCompletedTasks({});
      safeStorageSet(COMPLETED_TASKS_KEY, {});
      showToast("Vendor task progress cleared");
    } else if (workspaceMode === "keys") {
      setOwnedKeys({});
      safeStorageSet(OWNED_KEYS_KEY, {});
      showToast("Keyholder owned list cleared");
    } else if (workspaceMode === "vendors") {
      showToast("Vendor shop is synced live from gzw-data.dev");
    } else {
      setBuiltUpgrades({});
      setPlannedUpgrades({});
      setStashCounts({});
      safeStorageSet(BUILT_KEY, {});
      safeStorageSet(PLANNED_KEY, {});
      safeStorageSet(STASH_KEY, {});
      showToast("Hideout planner progress cleared");
    }
  };

  const handleArmPinDrop = (matId: string) => {
    setPreselectedPinMatId(matId);
    setPinDropMode(true);
    if (window.innerWidth < 1024) {
      setMobileTab("map");
    }
    showToast("Click anywhere on Lamang Island to copy X / Y and attach pin");
  };

  const handleSelectFaction = useCallback(
    (nextFaction: FactionId) => {
      setSelectedFaction(nextFaction);
      safeStorageSet(FACTION_KEY, nextFaction);
      if (nextFaction === "ALL") {
        showToast("Showing all factions");
      } else {
        const info = FACTIONS[nextFaction];
        showToast(
          `Faction set to ${info.short} · Starter Town: ${info.starterTown}`
        );
      }
    },
    [showToast]
  );

  const activeModeProgress =
    workspaceMode === "tasks"
      ? { done: completedTasksCount, total: factionTasks.length }
      : workspaceMode === "keys"
        ? { done: ownedKeysCount, total: keysCatalog.length }
        : workspaceMode === "vendors"
          ? { done: vendorShopItems.length, total: vendorShopItems.length }
          : { done: builtCount, total: allUpgrades.length };
  const progressPct =
    activeModeProgress.total > 0
      ? Math.round((activeModeProgress.done / activeModeProgress.total) * 100)
      : 0;

  const isSidebarVisibleOnMobile = mobileTab !== "map";

  return (
    <div className="h-[100dvh] w-screen flex flex-col bg-[#090c11] text-[#e8eef5] overflow-hidden">
      {/* Sleek Single-Line Top Bar */}
      <header className="h-13 shrink-0 px-3 sm:px-5 border-b border-white/[0.08] bg-[#0b0f16]/95 backdrop-blur-md flex items-center justify-between gap-4 z-30">
        {/* Brand Wordmark + Compact Faction Selector */}
        <div className="flex items-center gap-3 whitespace-nowrap shrink-0 min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-base sm:text-lg font-semibold tracking-tight text-[#f8fafc]">
              Lamang Operations
            </span>
            <span className="hidden md:inline text-white/[0.2]" aria-hidden="true">
              ·
            </span>
            <span className="hidden md:inline text-xs font-medium text-[#8b98a9]">
              Update 0.5
            </span>
          </div>

          {/* Desktop/Tablet Segmented Faction Switcher */}
          <div
            role="group"
            aria-label="Select faction"
            className="hidden sm:flex items-center rounded-lg bg-[#070a0f] border border-white/[0.08] p-0.5"
          >
            {(["ALL", "LRI", "MSS", "CSI"] as FactionId[]).map((fId) => {
              const isSelected = selectedFaction === fId;
              const info = fId === "ALL" ? null : FACTIONS[fId];
              return (
                <button
                  key={fId}
                  type="button"
                  title={
                    info
                      ? `${info.name} · Starter Town: ${info.starterTown}`
                      : "Show all factions"
                  }
                  onClick={() => handleSelectFaction(fId)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                    isSelected
                      ? "bg-[#1a2232] text-[#f8fafc] shadow-sm"
                      : "text-[#8b98a9] hover:text-[#e2e8f0]"
                  }`}
                >
                  {info && (
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: info.color }}
                    />
                  )}
                  <span>{fId === "ALL" ? "All" : fId}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Data Sync + Mobile Faction Select + Counter + Reset */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <select
            aria-label="Select faction mobile"
            value={selectedFaction}
            onChange={(e) => handleSelectFaction(e.target.value as FactionId)}
            className="sm:hidden min-h-[34px] rounded-lg bg-[#070a0f] border border-white/[0.1] px-2 text-xs font-semibold text-[#f1f5f9] focus:outline-none focus:border-[#e5a93c]"
          >
            <option value="ALL">All Factions</option>
            <option value="LRI">LRI</option>
            <option value="MSS">MSS</option>
            <option value="CSI">CSI</option>
          </select>
          <div className="hidden md:flex items-center gap-2 text-xs text-[#94a3b8] whitespace-nowrap">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                apiStatus.mode === "live"
                  ? "bg-emerald-400"
                  : apiStatus.mode === "cached"
                    ? "bg-[#e5a93c]"
                    : apiStatus.mode === "loading"
                      ? "bg-[#38bdf8] animate-pulse"
                      : "bg-red-500"
              }`}
            />
            <span>{apiStatus.label}</span>
          </div>

          <button
            type="button"
            disabled={apiStatus.mode === "loading"}
            onClick={() => handleRefreshApi(true)}
            aria-label="Sync Game Data"
            className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#e2e8f0] hover:text-white border border-white/[0.1] hover:border-white/[0.2] bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                apiStatus.mode === "loading" ? "animate-spin" : ""
              }`}
            />
            <span className="hidden sm:inline">Sync Data</span>
          </button>

          <div className="text-right hidden xs:block sm:block pl-1">
            <div className="font-mono-tabular text-xs sm:text-sm font-semibold text-[#f1f5f9]">
              {activeModeProgress.done}{" "}
              <span className="text-[11px] font-normal text-[#7f8ea1]">
                / {activeModeProgress.total}
              </span>
            </div>
            <div className="w-16 sm:w-24 h-1 bg-white/[0.08] rounded-full overflow-hidden mt-0.5">
              <div
                className="h-full bg-[#e5a93c] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleResetProgress}
            title="Reset saved progress"
            className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#94a3b8] hover:text-white border border-white/[0.08] hover:border-white/[0.18] bg-white/[0.03] hover:bg-white/[0.07] transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </header>

      {/* Responsive Workspace: Fluid Draggable Split Sidebar + Dominant Map on Desktop, Full-Screen Tabbed Views on Mobile */}
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Operations Panel (Hideout + Tasks + Vendors + Keys) */}
        <aside
          style={
            isDesktop && workspaceMode !== "vendors"
              ? { width: `${panelWidth}px` }
              : undefined
          }
          className={`${
            isSidebarVisibleOnMobile ? "flex" : "hidden lg:flex"
          } flex-col flex-1 ${
            workspaceMode === "vendors"
              ? "lg:flex-1 lg:w-full"
              : "lg:flex-none lg:shrink-0 lg:border-r border-white/[0.08]"
          } min-h-0 bg-[#0b0f16] ${
            isDraggingSplitter ? "" : "transition-[width] duration-150"
          }`}
        >
          {/* Desktop Workspace Mode Bar + Expand/Compact Width Preset Toggle */}
          <div className="hidden lg:flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/[0.07] bg-[#0a0e14] shrink-0">
            <div className="flex items-center gap-0.5 rounded-xl bg-[#070a0f] border border-white/[0.07] p-1 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceMode("hideout");
                  setMobileTab("hideout");
                }}
                className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  workspaceMode === "hideout"
                    ? "bg-[#1a2230] text-[#f8fafc] shadow-sm"
                    : "text-[#8896a8] hover:text-[#e2e8f0]"
                }`}
              >
                <Hammer className="w-3.5 h-3.5 text-[#e5a93c]" />
                <span>Hideout</span>
                <span className="font-mono-tabular text-[10px] text-[#7f8ea1]">
                  {builtCount}/{allUpgrades.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setWorkspaceMode("tasks");
                  setMobileTab("tasks");
                }}
                className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  workspaceMode === "tasks"
                    ? "bg-[#1a2230] text-[#f8fafc] shadow-sm"
                    : "text-[#8896a8] hover:text-[#e2e8f0]"
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5 text-[#38bdf8]" />
                <span>Tasks</span>
                <span className="font-mono-tabular text-[10px] text-[#7f8ea1]">
                  {completedTasksCount}/{factionTasks.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setWorkspaceMode("vendors");
                  setMobileTab("vendors");
                }}
                className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  workspaceMode === "vendors"
                    ? "bg-[#1a2230] text-[#f8fafc] shadow-sm"
                    : "text-[#8896a8] hover:text-[#e2e8f0]"
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5 text-[#34d399]" />
                <span>Vendors</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setWorkspaceMode("keys");
                  setMobileTab("keys");
                }}
                className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  workspaceMode === "keys"
                    ? "bg-[#1a2230] text-[#f8fafc] shadow-sm"
                    : "text-[#8896a8] hover:text-[#e2e8f0]"
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 text-[#e5a93c]" />
                <span>Keys</span>
                <span className="font-mono-tabular text-[10px] text-[#7f8ea1]">
                  {ownedKeysCount}/{keysCatalog.length}
                </span>
              </button>
            </div>

            {workspaceMode === "vendors" ? (
              <button
                type="button"
                onClick={() => {
                  setWorkspaceMode("hideout");
                  setMobileTab("map");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#e2e8f0] hover:text-white border border-white/[0.1] hover:border-white/[0.2] bg-white/[0.04] hover:bg-white/[0.08] transition-colors shrink-0"
              >
                <MapIcon className="w-3.5 h-3.5 text-[#38bdf8]" />
                <span>Return to Map</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleExpandPreset}
                title={
                  isWidePanel
                    ? "Snap to compact sidebar (or drag divider)"
                    : "Expand panel width (or drag divider)"
                }
                aria-label={isWidePanel ? "Compact panel" : "Expand panel"}
                className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-[#94a3b8] hover:text-white border border-white/[0.08] hover:border-white/[0.18] bg-white/[0.03] hover:bg-white/[0.07] transition-colors shrink-0"
              >
                {isWidePanel ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5 text-[#e5a93c]" />
                    <span className="hidden 2xl:inline">Compact</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5 text-[#38bdf8]" />
                    <span className="hidden 2xl:inline">Expand</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Active Left Panel Content */}
          {workspaceMode === "hideout" ? (
            <HideoutTrackerPanel
              activeView={activeView}
              onViewChange={setActiveView}
              allUpgrades={allUpgrades}
              selectedUpgradeId={selectedUpgrade?.id || null}
              onSelectUpgrade={setSelectedUpgrade}
              builtUpgrades={builtUpgrades}
              onToggleBuilt={handleToggleBuilt}
              plannedUpgrades={plannedUpgrades}
              onTogglePlanned={handleTogglePlanned}
              stashCounts={stashCounts}
              onSetStashCount={handleSetStashCount}
              tickedMapMaterials={tickedMapMaterials}
              onToggleMapMaterial={handleToggleMapMaterial}
              selectedMaterialKey={inspectedMaterial?.key || null}
              onInspectMaterial={handleInspectMaterial}
              onInspectApiRecord={handleInspectApiRecord}
              onArmPinDrop={handleArmPinDrop}
              catalog={catalog}
              disassemblyRecipes={disassemblyRecipes}
              apiCache={apiCache}
              isExpanded={isWidePanel}
            />
          ) : workspaceMode === "tasks" ? (
            <TasksTrackerPanel
              vendors={vendors}
              tasks={allTasks}
              selectedFaction={selectedFaction}
              completedTasks={completedTasks}
              onToggleTaskComplete={handleToggleTaskComplete}
              selectedTaskId={inspectedTask?.id || null}
              onLocateTaskOnMap={handleLocateTaskOnMap}
              isExpanded={isWidePanel}
              isLoadingApi={apiStatus.mode === "loading"}
            />
          ) : workspaceMode === "vendors" ? (
            <VendorShopPanel
              vendors={vendors}
              shopItems={vendorShopItems}
              isExpanded={isWidePanel}
              isLoadingApi={apiStatus.mode === "loading"}
            />
          ) : (
            <KeysDoorsPanel
              keysList={keysCatalog}
              selectedFaction={selectedFaction}
              ownedKeys={ownedKeys}
              onToggleOwnedKey={handleToggleOwnedKey}
              selectedKeyId={inspectedKey?.id || null}
              onLocateKeyOnMap={handleLocateKeyOnMap}
              isExpanded={isWidePanel}
              isLoadingApi={apiStatus.mode === "loading"}
            />
          )}
        </aside>

        {/* Fluid Draggable Split Divider (Desktop lg+, hidden when Vendors full-screen shop is active) */}
        {workspaceMode !== "vendors" && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize left panel width"
            tabIndex={0}
            title="Drag left or right to resize panel · Double-click to toggle width"
            onPointerDown={handleSplitterPointerDown}
            onDoubleClick={toggleExpandPreset}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                setPanelWidth((w) => {
                  const next = clampPanelWidth(w - 32);
                  safeStorageSet(PANEL_WIDTH_KEY, next);
                  return next;
                });
              } else if (e.key === "ArrowRight") {
                setPanelWidth((w) => {
                  const next = clampPanelWidth(w + 32);
                  safeStorageSet(PANEL_WIDTH_KEY, next);
                  return next;
                });
              }
            }}
            className={`hidden lg:flex w-2 -ml-1 z-20 shrink-0 cursor-col-resize items-center justify-center group select-none focus:outline-none ${
              isDraggingSplitter ? "bg-[#e5a93c]/25" : "hover:bg-[#38bdf8]/15"
            }`}
          >
            <div
              className={`w-1 h-12 rounded-full flex items-center justify-center transition-colors ${
                isDraggingSplitter
                  ? "bg-[#e5a93c] text-[#090d12]"
                  : "bg-[#253040] text-[#7f8ea1] group-hover:bg-[#38bdf8] group-hover:text-[#090d12]"
              }`}
            >
              <GripVertical className="w-3 h-3" />
            </div>
          </div>
        )}

        {/* Right Tactical Map Panel (Stays mounted for Leaflet pan/zoom persistence; hidden in full-screen Vendors shop) */}
        <div
          className={`${
            workspaceMode === "vendors"
              ? mobileTab === "map"
                ? "flex flex-1 min-h-0 lg:hidden"
                : "hidden"
              : mobileTab === "map"
                ? "flex flex-1 min-h-0"
                : "hidden lg:flex lg:flex-1 lg:min-h-0 lg:min-w-[280px]"
          }`}
        >
          <TacticalMapPanel
            catalog={catalog}
            customPins={customPins}
            onAddPin={handleAddPin}
            onUpdatePin={handleUpdatePin}
            onRemovePin={handleRemovePin}
            tickedMapMaterials={tickedMapMaterials}
            onToggleMapMaterial={handleToggleMapMaterial}
            inspectedMaterial={inspectedMaterial}
            inspectedLookup={inspectedLookup}
            isLookupLoading={isLookupLoading}
            onCloseInspect={() => setInspectedMaterial(null)}
            inspectedTask={inspectedTask}
            onCloseInspectTask={() => setInspectedTask(null)}
            onSelectTask={handleLocateTaskOnMap}
            allTasks={factionTasks}
            selectedFaction={selectedFaction}
            keysList={keysCatalog}
            ownedKeys={ownedKeys}
            onToggleOwnedKey={handleToggleOwnedKey}
            inspectedKey={inspectedKey}
            onSelectKey={handleLocateKeyOnMap}
            onCloseInspectKey={() => setInspectedKey(null)}
            onSelectMaterial={handleInspectMaterial}
            completedTasks={completedTasks}
            onToggleTaskComplete={handleToggleTaskComplete}
            apiRecords={allApiRecords}
            pinDropMode={pinDropMode}
            onTogglePinDropMode={(force) =>
              setPinDropMode((prev) => (force !== undefined ? force : !prev))
            }
            preselectedPinMaterialId={preselectedPinMatId}
            onNotify={showToast}
            layoutTrigger={`${panelWidth}-${mobileTab}-${workspaceMode}`}
            isResizing={isDraggingSplitter}
          />
        </div>
      </main>

      {/* Mobile Bottom Navigation Bar (< lg only, thumb-reachable 56px height, >= 44px hit targets) */}
      <nav
        aria-label="Mobile sections"
        className="lg:hidden h-14 shrink-0 border-t border-white/[0.08] bg-[#0a0e14]/95 backdrop-blur-lg grid grid-cols-5 z-30"
      >
        <button
          type="button"
          onClick={() => {
            setMobileTab("hideout");
            setWorkspaceMode("hideout");
          }}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[10px] font-medium transition-colors ${
            mobileTab === "hideout"
              ? "text-[#e5a93c] bg-[#111720]"
              : "text-[#8b98a9] hover:text-white"
          }`}
        >
          <Hammer className="w-4 h-4" />
          <span>Hideout</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMobileTab("tasks");
            setWorkspaceMode("tasks");
          }}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[10px] font-medium transition-colors ${
            mobileTab === "tasks"
              ? "text-[#38bdf8] bg-[#111720]"
              : "text-[#8b98a9] hover:text-white"
          }`}
        >
          <CheckSquare className="w-4 h-4" />
          <span>Tasks</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMobileTab("vendors");
            setWorkspaceMode("vendors");
          }}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[10px] font-medium transition-colors ${
            mobileTab === "vendors"
              ? "text-[#34d399] bg-[#111720]"
              : "text-[#8b98a9] hover:text-white"
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          <span>Vendors</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMobileTab("keys");
            setWorkspaceMode("keys");
          }}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[10px] font-medium transition-colors ${
            mobileTab === "keys"
              ? "text-[#e5a93c] bg-[#111720]"
              : "text-[#8b98a9] hover:text-white"
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Keys</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTab("map")}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[10px] font-medium transition-colors ${
            mobileTab === "map"
              ? "text-[#38bdf8] bg-[#111720]"
              : "text-[#8b98a9] hover:text-white"
          }`}
        >
          <MapIcon className="w-4 h-4" />
          <span>Map</span>
        </button>
      </nav>

      {/* Subtle Action Toast */}
      {toast && (
        <div className="fixed bottom-16 lg:bottom-5 left-1/2 -translate-x-1/2 z-[2000] px-4 py-2.5 rounded-xl bg-[#0d121a]/95 backdrop-blur-xl border border-[#e5a93c]/50 text-xs font-medium text-[#f1f5f9] shadow-2xl max-w-[calc(100vw-24px)] text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
