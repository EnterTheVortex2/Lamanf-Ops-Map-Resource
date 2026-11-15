import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { DEFAULT_SEED_PINS, type CustomMapPin } from "./config/mapConfig";
import type { HideoutUpgradeDef } from "./data/hideoutData";
import {
  HideoutTrackerPanel,
  type PlannerViewId,
} from "./components/HideoutTrackerPanel";
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

const BUILT_KEY = "lamang_ops_built_upgrades_v1";
const PLANNED_KEY = "lamang_ops_planned_upgrades_v1";
const STASH_KEY = "lamang_ops_stash_counts_v1";
const MAP_TICKED_KEY = "lamang_ops_ticked_materials_v5";
const CUSTOM_PINS_KEY = "lamang_ops_custom_pins_v5";

type ApiStatusMode = "loading" | "live" | "cached" | "error";

export default function App() {
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

  const builtCount = useMemo(
    () => allUpgrades.filter((u) => builtUpgrades[u.id]).length,
    [allUpgrades, builtUpgrades]
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
    setInspectedMaterial(mat);
    setInspectedLookup(null);
    setIsLookupLoading(true);
    try {
      const lookup = await lookupMaterialSpawnIntel(mat.name);
      setInspectedLookup(lookup);
    } finally {
      setIsLookupLoading(false);
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
    setBuiltUpgrades({});
    setPlannedUpgrades({});
    setStashCounts({});
    safeStorageSet(BUILT_KEY, {});
    safeStorageSet(PLANNED_KEY, {});
    safeStorageSet(STASH_KEY, {});
    showToast("Hideout planner progress cleared");
  };

  const handleArmPinDrop = (matId: string) => {
    setPreselectedPinMatId(matId);
    setPinDropMode(true);
    showToast("Click anywhere on Lamang Island to copy X / Y and attach pin");
  };

  const builtPct =
    allUpgrades.length > 0
      ? Math.round((builtCount / allUpgrades.length) * 100)
      : 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0b0e12] text-[#e6ecf2] overflow-hidden">
      {/* 3-Zone Top Navigation Header */}
      <header className="h-14 shrink-0 px-5 border-b border-[#212a36] bg-[#0a0d11] flex items-center justify-between gap-6 z-30">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
          <span className="font-display text-base font-bold tracking-tight text-[#eef3f8]">
            LAMANG OPERATIONS
          </span>
          <span className="text-[#3a4657]" aria-hidden="true">
            ·
          </span>
          <span className="font-mono-tabular text-[11px] uppercase tracking-wider text-[#8b98a9]">
            0.5 Rogue Ops
          </span>
        </div>

        {/* Zone 2: Live API Status + Refresh */}
        <div className="hidden md:flex items-center gap-3 text-xs text-[#8b98a9] font-mono-tabular whitespace-nowrap">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
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
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-sans font-medium text-[#dce4ee] hover:text-white border border-[#253040] hover:border-[#3c4b61] bg-[#11161e] disabled:opacity-60 transition-colors"
          >
            <RefreshCw
              className={`w-3 h-3 ${
                apiStatus.mode === "loading" ? "animate-spin" : ""
              }`}
            />
            Refresh API Data
          </button>
        </div>

        {/* Zone 3: Upgrades Built Counter + Reset */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="font-mono-tabular text-sm font-bold text-[#eef3f8]">
              {builtCount}{" "}
              <span className="text-xs font-normal text-[#7f8ea1]">
                / {allUpgrades.length}
              </span>
            </div>
            <div className="w-24 h-1 bg-[#18202a] rounded-full overflow-hidden mt-1">
              <div
                className="h-full bg-[#e5a93c] transition-all duration-300"
                style={{ width: `${builtPct}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleResetProgress}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#98a6b8] hover:text-white border border-[#253040] hover:border-[#3c4b61] bg-[#11161e] transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>
      </header>

      {/* Split-Screen Workspace */}
      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(480px,50%)_1fr]">
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
        />

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
          apiRecords={allApiRecords}
          pinDropMode={pinDropMode}
          onTogglePinDropMode={(force) =>
            setPinDropMode((prev) => (force !== undefined ? force : !prev))
          }
          preselectedPinMaterialId={preselectedPinMatId}
          onNotify={showToast}
        />
      </main>

      {/* Subtle Action Toast */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[2000] px-4 py-2 rounded bg-[#10161f] border border-[#e5a93c]/60 text-xs font-medium text-[#eef3f8] shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
