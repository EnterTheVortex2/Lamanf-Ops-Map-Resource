import { useMemo, useState } from "react";
import {
  Check,
  ClipboardList,
  Crosshair,
  MapPin,
  Minus,
  Plus,
  Search,
  Wrench,
} from "lucide-react";
import {
  HIDEOUT_ROOMS,
  type DisassemblyRecipeDef,
  type HideoutUpgradeDef,
  type RoomId,
} from "../data/hideoutData";
import {
  searchLiveApi,
  type ApiCachePayload,
  type NormalizedApiRecord,
} from "../services/gzwApi";
import type { CatalogMaterial } from "../utils/catalogBuilder";
import { ItemThumbnail } from "./ItemThumbnail";

export type PlannerViewId = "planner" | "manifest" | "disassembly" | "api-search";

interface HideoutTrackerPanelProps {
  activeView: PlannerViewId;
  onViewChange: (view: PlannerViewId) => void;
  allUpgrades: HideoutUpgradeDef[];
  selectedUpgradeId: string | null;
  onSelectUpgrade: (upg: HideoutUpgradeDef | null) => void;
  builtUpgrades: Record<string, boolean>;
  onToggleBuilt: (upgradeId: string) => void;
  plannedUpgrades: Record<string, boolean>;
  onTogglePlanned: (upgradeId: string) => void;
  stashCounts: Record<string, number>;
  onSetStashCount: (key: string, value: number) => void;
  tickedMapMaterials: Record<string, boolean>;
  onToggleMapMaterial: (matKey: string, visible: boolean) => void;
  selectedMaterialKey: string | null;
  onInspectMaterial: (mat: CatalogMaterial) => void;
  onInspectApiRecord: (rec: NormalizedApiRecord) => void;
  onArmPinDrop: (matId: string) => void;
  catalog: CatalogMaterial[];
  disassemblyRecipes: DisassemblyRecipeDef[];
  apiCache: ApiCachePayload | null;
  isExpanded: boolean;
}

function normMatKey(name: string): string {
  return name.trim().toLowerCase();
}

export function HideoutTrackerPanel({
  activeView,
  onViewChange,
  allUpgrades,
  selectedUpgradeId,
  onSelectUpgrade,
  builtUpgrades,
  onToggleBuilt,
  plannedUpgrades,
  onTogglePlanned,
  stashCounts,
  onSetStashCount,
  tickedMapMaterials,
  onToggleMapMaterial,
  selectedMaterialKey,
  onInspectMaterial,
  onInspectApiRecord,
  onArmPinDrop,
  catalog,
  disassemblyRecipes,
  apiCache,
  isExpanded,
}: HideoutTrackerPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState<"all" | RoomId>("all");
  const [tierFilter, setTierFilter] = useState<0 | 1 | 2 | 3>(0);
  const [statusFilter, setStatusFilter] = useState<"all" | "planned" | "unbuilt" | "built">("all");
  const [manifestScope, setManifestScope] = useState<"planned" | "unbuilt">("planned");

  const [apiQuery, setApiQuery] = useState("");
  const [apiDatasetFilter, setApiDatasetFilter] = useState("ALL");
  const [liveSearchResults, setLiveSearchResults] = useState<
    Record<string, Record<string, unknown>[]> | null
  >(null);
  const [isLiveSearching, setIsLiveSearching] = useState(false);

  const catalogByNorm = useMemo(() => {
    const map = new Map<string, CatalogMaterial>();
    for (const mat of catalog) {
      map.set(normMatKey(mat.name), mat);
    }
    return map;
  }, [catalog]);

  const builtCount = useMemo(
    () => allUpgrades.filter((u) => builtUpgrades[u.id]).length,
    [allUpgrades, builtUpgrades]
  );

  const plannedCount = useMemo(
    () => allUpgrades.filter((u) => plannedUpgrades[u.id] && !builtUpgrades[u.id]).length,
    [allUpgrades, plannedUpgrades, builtUpgrades]
  );

  // Filtered upgrade cards
  const filteredUpgrades = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allUpgrades.filter((u) => {
      if (roomFilter !== "all" && u.room !== roomFilter) return false;
      if (tierFilter !== 0 && u.level !== tierFilter) return false;
      const isBuilt = !!builtUpgrades[u.id];
      const isPlanned = !!plannedUpgrades[u.id];
      if (statusFilter === "built" && !isBuilt) return false;
      if (statusFilter === "unbuilt" && isBuilt) return false;
      if (statusFilter === "planned" && (!isPlanned || isBuilt)) return false;

      if (!q) return true;
      return (
        u.module.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.benefit.toLowerCase().includes(q) ||
        HIDEOUT_ROOMS[u.room].name.toLowerCase().includes(q) ||
        u.requirements.some((r) => r.name.toLowerCase().includes(q))
      );
    });
  }, [allUpgrades, roomFilter, tierFilter, statusFilter, builtUpgrades, plannedUpgrades, searchQuery]);

  const selectedUpgrade = useMemo(
    () => allUpgrades.find((u) => u.id === selectedUpgradeId) || null,
    [allUpgrades, selectedUpgradeId]
  );

  // Supply Manifest aggregation across Planned (or All Unbuilt) upgrades
  const supplyManifest = useMemo(() => {
    const targetUpgrades = allUpgrades.filter((u) => {
      if (builtUpgrades[u.id]) return false;
      return manifestScope === "planned" ? !!plannedUpgrades[u.id] : true;
    });

    const totals = new Map<string, { name: string; total: number; mat: CatalogMaterial | null }>();
    for (const upg of targetUpgrades) {
      for (const req of upg.requirements) {
        const key = normMatKey(req.name);
        const existing = totals.get(key);
        if (existing) {
          existing.total += req.quantity;
        } else {
          totals.set(key, {
            name: req.name,
            total: req.quantity,
            mat: catalogByNorm.get(key) || null,
          });
        }
      }
    }

    const rows = Array.from(totals.entries()).map(([key, item]) => {
      const stash = Math.max(0, stashCounts[key] || 0);
      const toFind = Math.max(0, item.total - stash);
      return {
        key,
        name: item.name,
        total: item.total,
        stash,
        toFind,
        mat: item.mat,
      };
    });

    // Dollars first if present, then by shortfall descending, then name
    rows.sort((a, b) => {
      if (a.key === "dollars") return -1;
      if (b.key === "dollars") return 1;
      if (b.toFind !== a.toFind) return b.toFind - a.toFind;
      return a.name.localeCompare(b.name);
    });

    return { targetUpgrades, rows };
  }, [allUpgrades, builtUpgrades, plannedUpgrades, manifestScope, stashCounts, catalogByNorm]);

  // All API Records for API Search tab
  const allApiRecords = useMemo(() => {
    const list: NormalizedApiRecord[] = [];
    if (!apiCache?.datasets) return list;
    Object.values(apiCache.datasets).forEach((arr) => {
      if (Array.isArray(arr)) list.push(...arr);
    });
    return list;
  }, [apiCache]);

  const apiDatasets = useMemo(
    () => Object.keys(apiCache?.datasets || {}),
    [apiCache]
  );

  const filteredApiRecords = useMemo(() => {
    const q = apiQuery.trim().toLowerCase();
    return allApiRecords.filter((rec) => {
      if (apiDatasetFilter !== "ALL" && rec.dataset !== apiDatasetFilter) {
        return false;
      }
      if (!q) return true;
      return (
        rec.name.toLowerCase().includes(q) ||
        rec.description.toLowerCase().includes(q) ||
        rec.category.toLowerCase().includes(q) ||
        rec.dataset.toLowerCase().includes(q)
      );
    });
  }, [allApiRecords, apiDatasetFilter, apiQuery]);

  const handleRunLiveApiSearch = async () => {
    if (!apiQuery.trim()) return;
    setIsLiveSearching(true);
    try {
      const res = await searchLiveApi(apiQuery.trim());
      setLiveSearchResults(res);
    } finally {
      setIsLiveSearching(false);
    }
  };

  const handleMaterialClick = (name: string) => {
    const mat = catalogByNorm.get(normMatKey(name));
    if (mat) {
      onInspectMaterial(mat);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Compact Hideout Sub-Controls */}
      <div className="px-4 py-3 border-b border-[#212a36] bg-[#0b0f14] space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[#7f8ea1]">
              {builtCount} / {allUpgrades.length} upgrades built
            </div>
            <p className="text-[11px] text-[#8b98a9] truncate">
              Click any upgrade or material to inspect spawns.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onViewChange("manifest")}
            className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#e5a93c] hover:bg-[#f0b94d] text-[#0c0f14] text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            Checklist ({supplyManifest.rows.filter((r) => r.toFind > 0).length})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#6b7a8d] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search upgrade or material..."
            className="w-full min-h-[36px] bg-[#070a0e] border border-[#222b38] rounded pl-8 pr-3 py-1.5 text-xs text-[#eef3f8] placeholder:text-[#5d6b7c] focus:outline-none focus:border-[#e5a93c]"
          />
        </div>

        {/* Sub-view Switcher Tabs */}
        <div className="grid grid-cols-4 gap-1">
          {(
            [
              { id: "planner", label: "Upgrades", count: allUpgrades.length },
              { id: "manifest", label: "Manifest", count: plannedCount },
              { id: "disassembly", label: "Disasm", count: disassemblyRecipes.length },
              { id: "api-search", label: "Database", count: allApiRecords.length },
            ] as { id: PlannerViewId; label: string; count: number }[]
          ).map((tab) => {
            const active = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onViewChange(tab.id)}
                className={`min-h-[34px] px-1.5 py-1 rounded text-[11px] font-medium border transition-colors whitespace-nowrap truncate text-center ${
                  active
                    ? "bg-[#1a222d] border-[#425064] text-[#eef3f8]"
                    : "bg-[#10151c] border-[#1f2834] text-[#8d9bad] hover:text-[#dce4ee] hover:border-[#313e50]"
                }`}
              >
                {tab.label}{" "}
                <span className="font-mono-tabular text-[10px] text-[#7f8ea1]">
                  ({tab.count})
                </span>
              </button>
            );
          })}
        </div>

        {/* Filters for Upgrade Planner */}
        {activeView === "planner" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <select
              aria-label="Filter hideout by room"
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value as "all" | RoomId)}
              className="min-h-[32px] bg-[#11161e] border border-[#253040] rounded px-2 py-1 text-xs text-[#dce4ee] focus:outline-none focus:border-[#e5a93c]"
            >
              <option value="all">All rooms ({allUpgrades.length})</option>
              <option value="utility">
                Utility ({allUpgrades.filter((u) => u.room === "utility").length})
              </option>
              <option value="electronics">
                Electronics ({allUpgrades.filter((u) => u.room === "electronics").length})
              </option>
              <option value="laboratory">
                Laboratory ({allUpgrades.filter((u) => u.room === "laboratory").length})
              </option>
            </select>

            <div className="flex items-center rounded bg-[#080b0f] border border-[#222b38] p-0.5">
              {([0, 1, 2, 3] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setTierFilter(lvl)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    tierFilter === lvl
                      ? "bg-[#1d2633] text-[#e5a93c]"
                      : "text-[#808fa2] hover:text-[#dce4ee]"
                  }`}
                >
                  {lvl === 0 ? "All" : `Lv${lvl}`}
                </button>
              ))}
            </div>

            <div className="flex items-center rounded bg-[#080b0f] border border-[#222b38] p-0.5">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "planned", label: "Plan" },
                  { id: "unbuilt", label: "Todo" },
                  { id: "built", label: "Built" },
                ] as const
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStatusFilter(st.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    statusFilter === st.id
                      ? "bg-[#1d2633] text-[#38bdf8]"
                      : "text-[#808fa2] hover:text-[#dce4ee]"
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* ================================================================
            VIEW 1: UPGRADE PLANNER (ALL 36 UPGRADES, TIERS 1-3)
           ================================================================ */}
        {activeView === "planner" && (
          <>
            {/* Selected Upgrade Material Spotlight */}
            {selectedUpgrade && (
              <div className="rounded-md bg-[#111822] border border-[#38bdf8]/50 p-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[#38bdf8]">
                      {HIDEOUT_ROOMS[selectedUpgrade.room].name} · Level {selectedUpgrade.level}
                    </div>
                    <h2 className="font-display text-sm font-semibold text-[#eef3f8]">
                      {selectedUpgrade.module} — Required Materials
                    </h2>
                    <p className="text-xs text-[#8b98a9] mt-0.5">
                      {selectedUpgrade.benefit} · Click any material below to locate reported spawns on the map.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectUpgrade(null)}
                    className="text-xs text-[#8b98a9] hover:text-white px-2 py-0.5 rounded border border-[#253040]"
                  >
                    Clear
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {selectedUpgrade.requirements.map((req) => {
                    const key = normMatKey(req.name);
                    const mat = catalogByNorm.get(key) || null;
                    const stash = stashCounts[key] || 0;
                    const short = Math.max(0, req.quantity - stash);
                    const isPinned = mat ? !!tickedMapMaterials[mat.key] : false;

                    return (
                      <div
                        key={`${selectedUpgrade.id}-${req.name}`}
                        className="flex items-center justify-between gap-2 rounded bg-[#0a0e13] border border-[#222c3a] px-2.5 py-2"
                      >
                        <button
                          type="button"
                          disabled={!mat}
                          onClick={() => handleMaterialClick(req.name)}
                          className={`flex items-center gap-2 min-w-0 text-left ${
                            mat ? "cursor-pointer hover:text-[#38bdf8]" : "cursor-default"
                          }`}
                        >
                          {mat && (
                            <ItemThumbnail
                              src={mat.image}
                              alt={mat.name}
                              sizeClass="w-7 h-7"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-[#e6ecf2] truncate">
                              {req.name}
                            </div>
                            <div className="font-mono-tabular text-[10px] text-[#8b98a9]">
                              Need {req.quantity.toLocaleString()} · Stash {stash.toLocaleString()}
                              {short > 0 ? (
                                <span className="text-[#e5a93c] ml-1.5">
                                  ({short.toLocaleString()} short)
                                </span>
                              ) : (
                                <span className="text-[#34d399] ml-1.5">(Ready)</span>
                              )}
                            </div>
                          </div>
                        </button>

                        {mat && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleMaterialClick(req.name)}
                              title="Locate spawns on map"
                              className="p-1 rounded bg-[#131b26] border border-[#283446] text-[#38bdf8] hover:border-[#38bdf8]"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleMapMaterial(mat.key, !isPinned)}
                              title="Toggle spawn pins on map"
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                isPinned
                                  ? "bg-purple-500/20 border-purple-400 text-purple-200"
                                  : "bg-[#131b26] border-[#283446] text-[#98a6b8]"
                              }`}
                            >
                              {isPinned ? "Pinned" : "Pin"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 36 Upgrade Cards Grid */}
            <div
              className={`grid gap-2.5 ${
                isExpanded ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
              }`}
            >
              {filteredUpgrades.map((upg) => {
                const isBuilt = !!builtUpgrades[upg.id];
                const isPlanned = !!plannedUpgrades[upg.id];
                const isSelected = selectedUpgradeId === upg.id;

                return (
                  <div
                    key={upg.id}
                    onClick={() => onSelectUpgrade(isSelected ? null : upg)}
                    className={`rounded-md border p-3.5 flex flex-col justify-between transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-[#121923] border-[#38bdf8]"
                        : isBuilt
                          ? "bg-[#0d1413] border-[#1f3b32] hover:border-[#2c5749]"
                          : isPlanned
                            ? "bg-[#12161e] border-[#3b3322] hover:border-[#5b4d31]"
                            : "bg-[#10151c] border-[#212a36] hover:border-[#344254]"
                    }`}
                  >
                    <div>
                      {/* Card Header: ROOM | LEVEL X */}
                      <div className="flex items-center justify-between gap-2 text-[10px] font-mono-tabular uppercase tracking-wider text-[#7f8ea1]">
                        <span>{HIDEOUT_ROOMS[upg.room].name}</span>
                        <span>LEVEL {upg.level}</span>
                      </div>

                      {/* Module Title & Benefit */}
                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        <h3 className="font-display text-base font-semibold text-[#eef3f8]">
                          {upg.module}
                        </h3>
                        {isBuilt && (
                          <span className="text-[11px] font-medium text-[#34d399]">
                            Built
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#8b98a9] mt-0.5">{upg.benefit}</p>

                      {/* Clickable Material Chips */}
                      <div
                        className="mt-3 flex flex-wrap gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {upg.requirements.map((req) => {
                          const key = normMatKey(req.name);
                          const mat = catalogByNorm.get(key) || null;
                          const isDollars = key === "dollars";
                          const stash = stashCounts[key] || 0;
                          const short = Math.max(0, req.quantity - stash);
                          const isMatSelected =
                            mat && selectedMaterialKey === mat.key;

                          return (
                            <button
                              key={`${upg.id}-${req.name}`}
                              type="button"
                              disabled={isDollars || !mat}
                              onClick={() => !isDollars && handleMaterialClick(req.name)}
                              title={
                                isDollars
                                  ? `${req.quantity.toLocaleString()} Dollars`
                                  : "Click to show spawn locations on map"
                              }
                              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] transition-colors ${
                                isMatSelected
                                  ? "bg-[#142536] border-[#38bdf8] text-[#e0f2fe]"
                                  : isDollars
                                    ? "bg-[#0a0d12] border-[#1f2733] text-[#98a6b8] cursor-default"
                                    : "bg-[#0b0f15] border-[#253040] text-[#dce4ee] hover:border-[#38bdf8] hover:text-[#7dd3fc] cursor-pointer"
                              }`}
                            >
                              <span>{req.name}</span>
                              <span className="font-mono-tabular text-[#98a6b8]">
                                ×{req.quantity.toLocaleString()}
                              </span>
                              {!isBuilt && !isDollars && (
                                <span
                                  className={`font-mono-tabular text-[10px] ${
                                    short > 0 ? "text-[#e5a93c]" : "text-[#34d399]"
                                  }`}
                                >
                                  {short > 0 ? `${short} short` : "✓"}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Card Footer: Plan upgrade + Mark built */}
                    <div
                      className="mt-3.5 pt-2.5 border-t border-[#1c2430] flex items-center justify-between gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className="inline-flex items-center gap-1.5 text-xs text-[#b8c4d4] hover:text-white cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isPlanned}
                          onChange={() => onTogglePlanned(upg.id)}
                          className="accent-[#e5a93c] w-3.5 h-3.5 rounded cursor-pointer"
                        />
                        <span>Plan upgrade</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => onToggleBuilt(upg.id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors whitespace-nowrap ${
                          isBuilt
                            ? "bg-[#112720] border-[#2b6b53] text-[#34d399] hover:border-[#34d399]"
                            : "bg-[#141a23] border-[#2b3748] text-[#dce4ee] hover:border-[#e5a93c] hover:text-[#e5a93c]"
                        }`}
                      >
                        {isBuilt && <Check className="w-3 h-3 stroke-[2.5]" />}
                        {isBuilt ? "Built" : "Mark built"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredUpgrades.length === 0 && (
              <div className="rounded-md border border-[#212a36] bg-[#10151c] p-8 text-center text-xs text-[#8b98a9]">
                No Hideout upgrades matched your current filter.
              </div>
            )}
          </>
        )}

        {/* ================================================================
            VIEW 2: SUPPLY MANIFEST (YOUR NEXT SUPPLY RUN)
           ================================================================ */}
        {activeView === "manifest" && (
          <div className="space-y-4">
            <div className="rounded-md bg-[#10151c] border border-[#212a36] p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[#e5a93c]">
                    SUPPLY MANIFEST
                  </div>
                  <h2 className="font-display text-base font-semibold text-[#eef3f8] mt-0.5">
                    Your next supply run
                  </h2>
                  <p className="text-xs text-[#8b98a9] mt-0.5">
                    Strictly Hideout upgrade materials needed for your{" "}
                    {manifestScope === "planned"
                      ? `${supplyManifest.targetUpgrades.length} planned upgrades`
                      : `${supplyManifest.targetUpgrades.length} remaining unbuilt upgrades`}
                    . Click any material to pinpoint spawns on the map.
                  </p>
                </div>

                <div className="flex items-center rounded bg-[#080b0f] border border-[#222b38] p-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setManifestScope("planned")}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      manifestScope === "planned"
                        ? "bg-[#e5a93c] text-[#0c0f14]"
                        : "text-[#8b98a9] hover:text-white"
                    }`}
                  >
                    Planned ({plannedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setManifestScope("unbuilt")}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      manifestScope === "unbuilt"
                        ? "bg-[#e5a93c] text-[#0c0f14]"
                        : "text-[#8b98a9] hover:text-white"
                    }`}
                  >
                    All unbuilt ({allUpgrades.length - builtCount})
                  </button>
                </div>
              </div>
            </div>

            {supplyManifest.rows.length === 0 ? (
              <div className="rounded-md border border-[#212a36] bg-[#10151c] p-8 text-center text-xs text-[#8b98a9]">
                {manifestScope === "planned"
                  ? "No planned upgrades selected yet. Tick 'Plan upgrade' on any card in the Upgrade planner, or switch to 'All unbuilt'."
                  : "All 36 Hideout upgrades are marked Built!"}
              </div>
            ) : (
              <div className="space-y-2">
                {supplyManifest.rows.map((row) => {
                  const isDollars = row.key === "dollars";
                  const isMapTicked = row.mat ? !!tickedMapMaterials[row.mat.key] : false;
                  const isSelected = row.mat && selectedMaterialKey === row.mat.key;
                  const done = row.toFind === 0;

                  return (
                    <div
                      key={row.key}
                      onClick={() => row.mat && onInspectMaterial(row.mat)}
                      className={`rounded-md border p-3 transition-colors ${
                        row.mat ? "cursor-pointer" : ""
                      } ${
                        isSelected
                          ? "bg-[#131d29] border-[#38bdf8]"
                          : done
                            ? "bg-[#0d1514] border-[#1f3b32]"
                            : "bg-[#10151c] border-[#212a36] hover:border-[#344254]"
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {row.mat ? (
                            <ItemThumbnail src={row.mat.image} alt={row.name} />
                          ) : (
                            <div className="w-10 h-10 rounded bg-[#080b0f] border border-[#222b38] flex items-center justify-center font-mono-tabular text-xs font-bold text-[#e5a93c] shrink-0">
                              $
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[#eef3f8] truncate">
                              {row.name}
                            </div>
                            <div className="text-[11px] text-[#8b98a9] truncate">
                              {row.mat
                                ? row.mat.spawnNotes[0] || "Lamang Loot Container"
                                : "Vendor / Raid Currency"}
                            </div>
                          </div>
                        </div>

                        {/* Stash Input + To Find */}
                        <div
                          className="flex items-center justify-between sm:justify-end gap-3 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1 bg-[#070a0e] border border-[#232d3b] rounded px-1.5 py-1">
                            <span className="text-[10px] text-[#7f8ea1] mr-1">Stash</span>
                            {!isDollars && (
                              <button
                                type="button"
                                onClick={() =>
                                  onSetStashCount(row.key, Math.max(0, row.stash - 1))
                                }
                                className="w-6 h-6 flex items-center justify-center rounded text-[#8b98a9] hover:text-[#e5a93c]"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                            )}
                            <input
                              type="number"
                              min={0}
                              step={isDollars ? 1000 : 1}
                              value={row.stash}
                              onChange={(e) =>
                                onSetStashCount(
                                  row.key,
                                  Math.max(0, Number(e.target.value) || 0)
                                )
                              }
                              className={`${
                                isDollars ? "w-20" : "w-11"
                              } bg-transparent text-center font-mono-tabular text-xs text-[#eef3f8] focus:outline-none`}
                            />
                            {!isDollars && (
                              <button
                                type="button"
                                onClick={() => onSetStashCount(row.key, row.stash + 1)}
                                className="w-6 h-6 flex items-center justify-center rounded text-[#8b98a9] hover:text-[#e5a93c]"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          <div className="text-right min-w-[76px]">
                            <div
                              className={`font-mono-tabular text-sm font-semibold ${
                                done ? "text-[#34d399]" : "text-[#eef3f8]"
                              }`}
                            >
                              {row.toFind.toLocaleString()}
                            </div>
                            <div className="font-mono-tabular text-[9px] uppercase text-[#7f8ea1]">
                              TO FIND / {row.total.toLocaleString()}
                            </div>
                          </div>
                        </div>
                      </div>

                      {row.mat && (
                        <div
                          className="mt-2 pt-2 border-t border-[#1a222d] flex items-center justify-between gap-2 text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#a8b5c6] hover:text-[#38bdf8]">
                            <input
                              type="checkbox"
                              checked={isMapTicked}
                              onChange={(e) =>
                                onToggleMapMaterial(row.mat!.key, e.target.checked)
                              }
                              className="accent-[#38bdf8] w-3.5 h-3.5 cursor-pointer"
                            />
                            <span>Show on Map</span>
                          </label>

                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => onInspectMaterial(row.mat!)}
                              className="inline-flex items-center gap-1 text-[#38bdf8] hover:text-[#7dd3fc] font-medium"
                            >
                              <MapPin className="w-3 h-3" />
                              Locate Spawns
                            </button>
                            <button
                              type="button"
                              onClick={() => onArmPinDrop(row.mat!.id)}
                              className="inline-flex items-center gap-1 text-[#8b98a9] hover:text-[#e5a93c]"
                            >
                              <Crosshair className="w-3 h-3" />
                              Pin
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            VIEW 3: DISASSEMBLY RECIPES
           ================================================================ */}
        {activeView === "disassembly" && (
          <div className="space-y-3">
            <div className="rounded-md bg-[#10151c] border border-[#212a36] p-4">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-[#e5a93c]" />
                <h2 className="font-display text-base font-semibold text-[#eef3f8]">
                  Hideout Disassembly Recipes
                </h2>
              </div>
              <p className="text-xs text-[#8b98a9] mt-1">
                High-value tactical devices &amp; containers processed in the Electronics Workshop &amp; Laboratory.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {disassemblyRecipes
                .filter((r) => {
                  const q = searchQuery.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    r.name.toLowerCase().includes(q) ||
                    r.outcomes.some((o) => o.toLowerCase().includes(q))
                  );
                })
                .map((rec) => (
                  <div
                    key={rec.id}
                    className="rounded-md bg-[#10151c] border border-[#212a36] p-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-display text-sm font-semibold text-[#eef3f8]">
                          {rec.name}
                        </h3>
                        <div className="font-mono-tabular text-[11px] text-[#8b98a9] mt-0.5">
                          Duration: {rec.duration}
                          {rec.sellPrice && (
                            <span className="text-[#e5a93c] ml-2">· {rec.sellPrice}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {rec.outcomes.map((out, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-[#0a0e13] border border-[#253040] text-[11px] text-[#7dd3fc]"
                        >
                          Yields: {out}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ================================================================
            VIEW 4: LIVE API SEARCH (TOOLS, KEYS, CONTAINERS, TASKS)
           ================================================================ */}
        {activeView === "api-search" && (
          <div className="space-y-3">
            <div className="rounded-md bg-[#10151c] border border-[#212a36] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-[#eef3f8]">
                  Live API Item &amp; Intel Search
                </h2>
                <span className="font-mono-tabular text-xs text-[#34d399]">
                  {allApiRecords.length} cached
                </span>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-[#6b7a8d] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={apiQuery}
                    onChange={(e) => setApiQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRunLiveApiSearch()}
                    placeholder="Search tools, keys, loot containers, tasks, modules..."
                    className="w-full bg-[#070a0e] border border-[#222b38] rounded pl-8 pr-3 py-1.5 text-xs text-[#eef3f8] placeholder:text-[#5d6b7c] focus:outline-none focus:border-[#38bdf8]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleRunLiveApiSearch}
                  disabled={isLiveSearching || !apiQuery.trim()}
                  className="px-3 py-1.5 rounded bg-[#38bdf8] hover:bg-[#5cc9fa] disabled:opacity-50 text-[#090d12] text-xs font-semibold whitespace-nowrap"
                >
                  {isLiveSearching ? "Querying..." : "Query Live"}
                </button>
              </div>
            </div>

            {liveSearchResults && Object.keys(liveSearchResults).length > 0 && (
              <div className="rounded-md bg-[#0f1722] border border-[#38bdf8]/40 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#38bdf8]">
                    Live gzw-data.dev search results
                  </span>
                  <button
                    type="button"
                    onClick={() => setLiveSearchResults(null)}
                    className="text-[11px] text-[#8b98a9] hover:text-white"
                  >
                    Dismiss
                  </button>
                </div>
                {Object.entries(liveSearchResults).map(([ds, list]) =>
                  Array.isArray(list) && list.length > 0 ? (
                    <div key={ds} className="text-xs">
                      <div className="font-mono-tabular text-[10px] uppercase text-[#e5a93c] mb-1">
                        {ds} ({list.length})
                      </div>
                      <div className="space-y-1">
                        {list.slice(0, 6).map((item, idx) => (
                          <div
                            key={idx}
                            className="px-2 py-1 rounded bg-[#090d12] border border-[#1f2937] text-[#dce4ee] truncate"
                          >
                            {String(item.name || item.title || item.id || "Record")}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setApiDatasetFilter("ALL")}
                className={`px-2 py-1 rounded text-[11px] font-medium border ${
                  apiDatasetFilter === "ALL"
                    ? "bg-[#1a222d] border-[#38bdf8] text-[#7dd3fc]"
                    : "bg-[#10151c] border-[#212a36] text-[#8b98a9]"
                }`}
              >
                All ({allApiRecords.length})
              </button>
              {apiDatasets.map((ds) => (
                <button
                  key={ds}
                  type="button"
                  onClick={() => setApiDatasetFilter(ds)}
                  className={`px-2 py-1 rounded text-[11px] font-medium border ${
                    apiDatasetFilter === ds
                      ? "bg-[#1a222d] border-[#38bdf8] text-[#7dd3fc]"
                      : "bg-[#10151c] border-[#212a36] text-[#8b98a9]"
                  }`}
                >
                  {ds.replace(/_/g, " ")} ({apiCache?.datasets[ds]?.length || 0})
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {filteredApiRecords.slice(0, 80).map((rec) => (
                <div
                  key={rec.uid}
                  onClick={() => onInspectApiRecord(rec)}
                  className="rounded-md bg-[#10151c] border border-[#212a36] hover:border-[#38bdf8]/60 p-3 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ItemThumbnail src={rec.image} alt={rec.name} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#eef3f8] truncate">
                          {rec.name}
                        </div>
                        <div className="text-xs text-[#8b98a9] mt-0.5 truncate">
                          <span>{rec.dataset.replace(/_/g, " ")}</span>
                          {rec.category && rec.category !== rec.dataset && (
                            <>
                              <span className="mx-1.5 text-[#495769]">·</span>
                              <span>{rec.category}</span>
                            </>
                          )}
                          {rec.sellPrice && (
                            <>
                              <span className="mx-1.5 text-[#495769]">·</span>
                              <span className="font-mono-tabular text-[#e5a93c]">
                                {rec.sellPrice}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <MapPin className="w-4 h-4 text-[#6b7a8d] shrink-0 mt-1" />
                  </div>
                  {rec.description && (
                    <p className="text-xs text-[#8b98a9] mt-2 line-clamp-2 leading-relaxed">
                      {rec.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
