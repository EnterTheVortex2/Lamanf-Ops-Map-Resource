import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckSquare,
  GripVertical,
  Hammer,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { DEFAULT_SEED_PINS, type CustomMapPin } from "./config/mapConfig";
import type { HideoutUpgradeDef } from "./data/hideoutData";
import {
  HideoutTrackerPanel,
  type PlannerViewId,
} from "./components/HideoutTrackerPanel";
import { TasksTrackerPanel } from "./components/TasksTrackerPanel";
import { TacticalMapPanel } from "./components/TacticalMapPanel";
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
import {
  buildAllTasks,
  buildVendorProfiles,
  type GzwTaskDef,
} from "./utils/taskBuilder";

const BUILT_KEY = "lamang_ops_built_upgrades_v1";
const PLANNED_KEY = "lamang_ops_planned_upgrades_v1";
const STASH_KEY = "lamang_ops_stash_counts_v1";
const COMPLETED_TASKS_KEY = "lamang_ops_completed_tasks_v1";
const MAP_TICKED_KEY = "lamang_ops_ticked_materials_v5";
const CUSTOM_PINS_KEY = "lamang_ops_custom_pins_v5";
const PANEL_WIDTH_KEY = "lamang_ops_panel_width_v1";

const DEFAULT_COMPACT_WIDTH = 440;
const MIN_PANEL_WIDTH = 340;

type ApiStatusMode = "loading" | "live" | "cached" | "error";
type WorkspaceMode = "hideout" | "tasks";
type MobileTab = "hideout" | "tasks" | "map";

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
      return { mode: "cached", label: `Cached · ${count} records` };
    }
    return { mode: "loading", label: "Syncing gzw-data.dev" };
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
  const [tickedMapMaterials, setTickedMapMaterials] = useState<
    Record<string, boolean>
  >(() => safeStorageGet<Record<string, boolean>>(MAP_TICKED_KEY, {}));
  const [customPins, setCustomPins] = useState<CustomMapPin[]>(() =>
    safeStorageGet<CustomMapPin[]>(CUSTOM_PINS_KEY, DEFAULT_SEED_PINS)
  );

  const [selectedUpgrade, setSelectedUpgrade] =
    useState<HideoutUpgradeDef | null>(null);
  const [inspectedMaterial, setInspectedMaterial] =
    useState<CatalogMaterial | null>(null);
  const [inspectedLookup, setInspectedLookup] =
    useState<ItemSpawnLookupResult | null>(null);
  const [isLookupLoading, setIsLookupLoading] = useState(false);
  const [inspectedTask, setInspectedTask] = useState<GzwTaskDef | null>(null);

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
      setApiStatus({ mode: "loading", label: "Syncing gzw-data.dev" });
      try {
        const fresh = await discoverAndFetchAllDatasets(isManual);
        setApiCache(fresh);
        const total = Object.values(fresh.datasets).reduce(
          (acc, list) => acc + list.length,
          0
        );
        setApiStatus({ mode: "live", label: `Live · ${total} records` });
        if (isManual) {
          showToast(
            `Synced ${total} records across ${fresh.discoveredDatasets.length} datasets`
          );
        }
      } catch {
        const existing = loadCachedApiData();
        if (existing) {
          const total = Object.values(existing.datasets).reduce(
            (acc, list) => acc + list.length,
            0
          );
          setApiStatus({ mode: "cached", label: `Cached · ${total} records` });
          if (isManual) showToast("Upstream busy — using cached API data");
        } else {
          setApiStatus({ mode: "error", label: "Built-in 0.5 data" });
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
  const allTasks = useMemo(() => buildAllTasks(apiCache), [apiCache]);

  const builtCount = useMemo(
    () => allUpgrades.filter((u) => builtUpgrades[u.id]).length,
    [allUpgrades, builtUpgrades]
  );

  const completedTasksCount = useMemo(
    () => allTasks.filter((t) => completedTasks[t.id]).length,
    [allTasks, completedTasks]
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
    setInspectedTask(task);
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

  const activeModeProgress =
    workspaceMode === "tasks"
      ? { done: completedTasksCount, total: allTasks.length }
      : { done: builtCount, total: allUpgrades.length };
  const progressPct =
    activeModeProgress.total > 0
      ? Math.round((activeModeProgress.done / activeModeProgress.total) * 100)
      : 0;

  const isSidebarVisibleOnMobile = mobileTab !== "map";

  return (
    <div className="h-[100dvh] w-screen flex flex-col bg-[#0b0e12] text-[#e6ecf2] overflow-hidden">
      {/* Compact Single-Line Top Bar (<= 48px on mobile, 52px on desktop) */}
      <header className="h-12 lg:h-13 shrink-0 px-3 sm:px-5 border-b border-[#212a36] bg-[#0a0d11] flex items-center justify-between gap-3 z-30">
        {/* Brand Wordmark */}
        <div className="flex items-center gap-2 whitespace-nowrap shrink-0 min-w-0">
          <span className="font-display text-sm sm:text-base font-bold tracking-tight text-[#eef3f8]">
            LAMANG OPERATIONS
          </span>
          <span className="hidden sm:inline text-[#3a4657]" aria-hidden="true">
            ·
          </span>
          <span className="hidden sm:inline font-mono-tabular text-[11px] uppercase tracking-wider text-[#8b98a9]">
            0.5 Rogue Ops
          </span>
        </div>

        {/* Live API Status + Refresh */}
        <div className="flex items-center gap-2 text-xs text-[#8b98a9] font-mono-tabular whitespace-nowrap shrink-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                apiStatus.mode === "live"
                  ? "bg-emerald-400"
                  : apiStatus.mode === "cached"
                    ? "bg-[#e5a93c]"
                    : apiStatus.mode === "loading"
                      ? "bg-[#38bdf8] animate-pulse"
                      : "bg-red-500"
              }`}
            />
            <span className="hidden md:inline">{apiStatus.label}</span>
          </div>

          <button
            type="button"
            disabled={apiStatus.mode === "loading"}
            onClick={() => handleRefreshApi(true)}
            aria-label="Refresh API Data"
            className="min-h-[34px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-sans font-medium text-[#dce4ee] hover:text-white border border-[#253040] hover:border-[#3c4b61] bg-[#11161e] disabled:opacity-60 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                apiStatus.mode === "loading" ? "animate-spin" : ""
              }`}
            />
            <span className="hidden sm:inline">Refresh API</span>
          </button>
        </div>

        {/* Active Counter + Reset */}
        <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
          <div className="text-right hidden xs:block sm:block">
            <div className="font-mono-tabular text-xs sm:text-sm font-bold text-[#eef3f8]">
              {activeModeProgress.done}{" "}
              <span className="text-[11px] font-normal text-[#7f8ea1]">
                / {activeModeProgress.total}
              </span>
            </div>
            <div className="w-16 sm:w-24 h-1 bg-[#18202a] rounded-full overflow-hidden mt-0.5">
              <div
                className="h-full bg-[#e5a93c] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleResetProgress}
            title="Reset progress"
            className="min-h-[34px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-[#98a6b8] hover:text-white border border-[#253040] hover:border-[#3c4b61] bg-[#11161e] transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </header>

      {/* Responsive Workspace: Fluid Draggable Split Sidebar + Dominant Map on Desktop, Full-Screen Tabbed Views on Mobile */}
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Operations Panel (Hideout + Vendor Tasks) */}
        <aside
          style={isDesktop ? { width: `${panelWidth}px` } : undefined}
          className={`${
            isSidebarVisibleOnMobile ? "flex" : "hidden lg:flex"
          } flex-col flex-1 lg:flex-none lg:shrink-0 min-h-0 bg-[#0d1117] lg:border-r border-[#212a36] ${
            isDraggingSplitter ? "" : "transition-[width] duration-150"
          }`}
        >
          {/* Desktop Workspace Mode Bar + Expand/Compact Width Preset Toggle */}
          <div className="hidden lg:flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[#212a36] bg-[#0a0e13] shrink-0">
            <div className="flex items-center gap-1 rounded bg-[#070a0e] border border-[#1f2834] p-0.5">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceMode("hideout");
                  setMobileTab("hideout");
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  workspaceMode === "hideout"
                    ? "bg-[#1a222d] text-[#eef3f8]"
                    : "text-[#808fa2] hover:text-[#dce4ee]"
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
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  workspaceMode === "tasks"
                    ? "bg-[#1a222d] text-[#eef3f8]"
                    : "text-[#808fa2] hover:text-[#dce4ee]"
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5 text-[#38bdf8]" />
                <span>Tasks</span>
                <span className="font-mono-tabular text-[10px] text-[#7f8ea1]">
                  {completedTasksCount}/{allTasks.length}
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={toggleExpandPreset}
              title={
                isWidePanel
                  ? "Snap to compact sidebar (or drag divider)"
                  : "Expand panel width (or drag divider)"
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#98a6b8] hover:text-white border border-[#222c3a] hover:border-[#3c4b61] bg-[#10151c] transition-colors shrink-0"
            >
              {isWidePanel ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-[#e5a93c]" />
                  <span>Compact</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-[#38bdf8]" />
                  <span>Expand</span>
                </>
              )}
            </button>
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
          ) : (
            <TasksTrackerPanel
              vendors={vendors}
              tasks={allTasks}
              completedTasks={completedTasks}
              onToggleTaskComplete={handleToggleTaskComplete}
              selectedTaskId={inspectedTask?.id || null}
              onLocateTaskOnMap={handleLocateTaskOnMap}
              isExpanded={isWidePanel}
              isLoadingApi={apiStatus.mode === "loading"}
            />
          )}
        </aside>

        {/* Fluid Draggable Split Divider (Desktop lg+) */}
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

        {/* Right Tactical Map Panel (Stays mounted for Leaflet pan/zoom persistence) */}
        <div
          className={`${
            mobileTab === "map" ? "flex flex-1 min-h-0" : "hidden lg:flex lg:flex-1 lg:min-h-0 lg:min-w-[280px]"
          }`}
        >
          <TacticalMapPanel
            catalog={catalog}
            customPins={customPins}
            onAddPin={handleAddPin}
            onRemovePin={handleRemovePin}
            tickedMapMaterials={tickedMapMaterials}
            onToggleMapMaterial={handleToggleMapMaterial}
            inspectedMaterial={inspectedMaterial}
            inspectedLookup={inspectedLookup}
            isLookupLoading={isLookupLoading}
            onCloseInspect={() => setInspectedMaterial(null)}
            inspectedTask={inspectedTask}
            onCloseInspectTask={() => setInspectedTask(null)}
            completedTasks={completedTasks}
            onToggleTaskComplete={handleToggleTaskComplete}
            apiRecords={allApiRecords}
            pinDropMode={pinDropMode}
            onTogglePinDropMode={(force) =>
              setPinDropMode((prev) => (force !== undefined ? force : !prev))
            }
            preselectedPinMaterialId={preselectedPinMatId}
            onNotify={showToast}
            layoutTrigger={`${panelWidth}-${mobileTab}`}
            isResizing={isDraggingSplitter}
          />
        </div>
      </main>

      {/* Mobile Bottom Navigation Bar (< lg only, thumb-reachable 56px height, >= 44px hit targets) */}
      <nav
        aria-label="Mobile sections"
        className="lg:hidden h-14 shrink-0 border-t border-[#212a36] bg-[#0a0d11] grid grid-cols-3 z-30"
      >
        <button
          type="button"
          onClick={() => {
            setMobileTab("hideout");
            setWorkspaceMode("hideout");
          }}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-medium transition-colors ${
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
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-medium transition-colors ${
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
          onClick={() => setMobileTab("map")}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-medium transition-colors ${
            mobileTab === "map"
              ? "text-[#34d399] bg-[#111720]"
              : "text-[#8b98a9] hover:text-white"
          }`}
        >
          <MapIcon className="w-4 h-4" />
          <span>Map</span>
        </button>
      </nav>

      {/* Subtle Action Toast */}
      {toast && (
        <div className="fixed bottom-16 lg:bottom-5 left-1/2 -translate-x-1/2 z-[2000] px-4 py-2 rounded bg-[#10161f] border border-[#e5a93c]/60 text-xs font-medium text-[#eef3f8] shadow-2xl max-w-[calc(100vw-24px)] text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
