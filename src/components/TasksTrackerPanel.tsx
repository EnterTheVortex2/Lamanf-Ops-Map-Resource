import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  GitBranch,
  Image as ImageIcon,
  KeyRound,
  MapPin,
  Search,
  User,
  X,
} from "lucide-react";
import type {
  GzwTaskDef,
  TaskCategory,
  VendorProfile,
} from "../utils/taskBuilder";
import { ItemThumbnail } from "./ItemThumbnail";

interface TasksTrackerPanelProps {
  vendors: VendorProfile[];
  tasks: GzwTaskDef[];
  completedTasks: Record<string, boolean>;
  onToggleTaskComplete: (taskId: string) => void;
  selectedTaskId: string | null;
  onLocateTaskOnMap: (task: GzwTaskDef) => void;
  isExpanded: boolean;
  isLoadingApi: boolean;
}

const CATEGORY_OPTIONS: { id: "ALL" | TaskCategory; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "Main Task", label: "Main" },
  { id: "Side Task", label: "Side" },
  { id: "Contract", label: "Contract" },
  { id: "Hidden Task", label: "Hidden" },
  { id: "Squad Strike", label: "Strike" },
];

export function TasksTrackerPanel({
  vendors,
  tasks,
  completedTasks,
  onToggleTaskComplete,
  selectedTaskId,
  onLocateTaskOnMap,
  isExpanded,
  isLoadingApi,
}: TasksTrackerPanelProps) {
  const [selectedVendor, setSelectedVendor] = useState<string>("ALL");
  const [selectedArea, setSelectedArea] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | TaskCategory>(
    "ALL"
  );
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "done">(
    "all"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTaskIds, setExpandedTaskIds] = useState<
    Record<string, boolean>
  >({});
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    title: string;
  } | null>(null);

  const vendorStats = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const v of vendors) {
      map.set(v.name.toLowerCase(), { total: 0, done: 0 });
    }
    for (const t of tasks) {
      const k = t.vendor.toLowerCase();
      const entry = map.get(k) || { total: 0, done: 0 };
      entry.total += 1;
      if (completedTasks[t.id]) entry.done += 1;
      map.set(k, entry);
    }
    return map;
  }, [vendors, tasks, completedTasks]);

  const activeVendorProfile = useMemo(
    () =>
      selectedVendor === "ALL"
        ? null
        : vendors.find(
            (v) => v.name.toLowerCase() === selectedVendor.toLowerCase()
          ) || null,
    [selectedVendor, vendors]
  );

  const vendorScopedTasks = useMemo(() => {
    if (selectedVendor === "ALL") return tasks;
    return tasks.filter(
      (t) => t.vendor.toLowerCase() === selectedVendor.toLowerCase()
    );
  }, [tasks, selectedVendor]);

  const areaOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of vendorScopedTasks) {
      for (const area of t.areas) {
        counts.set(area, (counts.get(area) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => a.area.localeCompare(b.area));
  }, [vendorScopedTasks]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vendorScopedTasks.filter((t) => {
      if (selectedArea !== "ALL" && !t.areas.includes(selectedArea)) {
        return false;
      }
      if (categoryFilter !== "ALL" && t.category !== categoryFilter) {
        return false;
      }
      const isDone = !!completedTasks[t.id];
      if (statusFilter === "active" && isDone) return false;
      if (statusFilter === "done" && !isDone) return false;

      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.vendor.toLowerCase().includes(q) ||
        t.locationRaw.toLowerCase().includes(q) ||
        t.briefing.toLowerCase().includes(q) ||
        t.objectivesText.toLowerCase().includes(q) ||
        t.walkthroughSteps.some((s) => s.toLowerCase().includes(q)) ||
        t.relatedItems.some((r) => r.name.toLowerCase().includes(q))
      );
    });
  }, [
    vendorScopedTasks,
    selectedArea,
    categoryFilter,
    statusFilter,
    completedTasks,
    searchQuery,
  ]);

  const totalDone = useMemo(
    () => tasks.filter((t) => completedTasks[t.id]).length,
    [tasks, completedTasks]
  );

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Compact In-Game Vendor & Area Filter Controls */}
      <div className="px-4 py-3 border-b border-[#212a36] bg-[#0b0f14] space-y-2.5 shrink-0">
        {/* Horizontal scrollable Vendor Roster Strip (In-Game Style) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => {
              setSelectedVendor("ALL");
              setSelectedArea("ALL");
            }}
            className={`min-h-[40px] px-2.5 py-1.5 rounded border text-left transition-colors shrink-0 flex items-center gap-2 ${
              selectedVendor === "ALL"
                ? "bg-[#1a222d] border-[#e5a93c] text-[#eef3f8]"
                : "bg-[#10151c] border-[#1f2834] text-[#8d9bad] hover:text-white hover:border-[#344254]"
            }`}
          >
            <div className="w-6 h-6 rounded bg-[#080b0f] border border-[#253040] flex items-center justify-center text-[10px] font-mono-tabular font-bold text-[#e5a93c]">
              ALL
            </div>
            <div>
              <div className="text-[11px] font-semibold leading-tight">
                All Vendors
              </div>
              <div className="font-mono-tabular text-[10px] text-[#7f8ea1]">
                {totalDone}/{tasks.length}
              </div>
            </div>
          </button>

          {vendors.map((vendor) => {
            const active =
              selectedVendor.toLowerCase() === vendor.name.toLowerCase();
            const stats = vendorStats.get(vendor.name.toLowerCase()) || {
              total: 0,
              done: 0,
            };
            return (
              <button
                key={vendor.id}
                type="button"
                onClick={() => {
                  setSelectedVendor(vendor.name);
                  setSelectedArea("ALL");
                }}
                className={`min-h-[40px] px-2.5 py-1.5 rounded border text-left transition-colors shrink-0 flex items-center gap-2 ${
                  active
                    ? "bg-[#1a222d] border-[#e5a93c] text-[#eef3f8]"
                    : "bg-[#10151c] border-[#1f2834] text-[#8d9bad] hover:text-white hover:border-[#344254]"
                }`}
              >
                {vendor.image ? (
                  <img
                    src={vendor.image}
                    alt={vendor.name}
                    referrerPolicy="no-referrer"
                    className="w-6 h-6 rounded object-cover border border-[#2a3646] bg-[#080b0f] shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-6 h-6 rounded bg-[#080b0f] border border-[#253040] flex items-center justify-center shrink-0">
                    <User className="w-3.5 h-3.5 text-[#7f8ea1]" />
                  </div>
                )}
                <div>
                  <div className="text-[11px] font-semibold leading-tight whitespace-nowrap">
                    {vendor.name}
                  </div>
                  <div className="font-mono-tabular text-[10px] text-[#7f8ea1]">
                    {stats.done}/{stats.total}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Direct Vendor & Area Dropdowns */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[#6f7e91] mb-1">
              Vendor
            </label>
            <select
              aria-label="Filter tasks by vendor"
              value={selectedVendor}
              onChange={(e) => {
                setSelectedVendor(e.target.value);
                setSelectedArea("ALL");
              }}
              className="w-full min-h-[38px] bg-[#11161e] border border-[#253040] rounded px-2.5 py-1.5 text-xs text-[#eef3f8] focus:outline-none focus:border-[#e5a93c]"
            >
              <option value="ALL">All Vendors ({tasks.length})</option>
              {vendors.map((v) => {
                const st = vendorStats.get(v.name.toLowerCase());
                return (
                  <option key={v.id} value={v.name}>
                    {v.name} ({st?.total ?? 0})
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="block font-mono-tabular text-[10px] uppercase tracking-wider text-[#6f7e91] mb-1">
              Area / Region
            </label>
            <select
              aria-label="Filter tasks by area"
              value={selectedArea}
              onChange={(e) => setSelectedArea(e.target.value)}
              className="w-full min-h-[38px] bg-[#11161e] border border-[#253040] rounded px-2.5 py-1.5 text-xs text-[#eef3f8] focus:outline-none focus:border-[#e5a93c]"
            >
              <option value="ALL">
                All Areas ({vendorScopedTasks.length})
              </option>
              {areaOptions.map((opt) => (
                <option key={opt.area} value={opt.area}>
                  {opt.area} ({opt.count})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Search + Type + Status Row */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#6b7a8d] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeVendorProfile
                  ? `Search ${activeVendorProfile.name} tasks, walkthroughs, or keys...`
                  : "Search task, area, walkthrough, or required key..."
              }
              className="w-full min-h-[36px] bg-[#070a0e] border border-[#222b38] rounded pl-8 pr-3 py-1.5 text-xs text-[#eef3f8] placeholder:text-[#5d6b7c] focus:outline-none focus:border-[#e5a93c]"
            />
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center rounded bg-[#080b0f] border border-[#222b38] p-0.5 overflow-x-auto max-w-full">
              {CATEGORY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setCategoryFilter(opt.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    categoryFilter === opt.id
                      ? "bg-[#1d2633] text-[#e5a93c]"
                      : "text-[#808fa2] hover:text-[#dce4ee]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center rounded bg-[#080b0f] border border-[#222b38] p-0.5 shrink-0">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "active", label: "Active" },
                  { id: "done", label: "Done" },
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
        </div>
      </div>

      {/* Scrollable In-Game Tasks Feed */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
        {activeVendorProfile && (
          <div className="rounded-md bg-[#10161e] border border-[#232d3b] p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {activeVendorProfile.image ? (
                <img
                  src={activeVendorProfile.image}
                  alt={activeVendorProfile.name}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded object-cover border border-[#324054] shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded bg-[#080b0f] border border-[#253040] flex items-center justify-center shrink-0">
                  <User className="w-5 h-5 text-[#e5a93c]" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#eef3f8] truncate">
                  {activeVendorProfile.name}{" "}
                  {activeVendorProfile.fullName !== "Unknown" && (
                    <span className="text-[#8b98a9] font-normal">
                      · {activeVendorProfile.fullName}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[#7f8ea1] truncate">
                  {activeVendorProfile.specialty}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono-tabular text-xs font-bold text-[#e5a93c]">
                {vendorStats.get(activeVendorProfile.name.toLowerCase())?.done ??
                  0}{" "}
                /{" "}
                {vendorStats.get(activeVendorProfile.name.toLowerCase())
                  ?.total ?? 0}
              </div>
              <div className="font-mono-tabular text-[9px] uppercase text-[#7f8ea1]">
                COMPLETED
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#7f8ea1] px-0.5">
          <span>
            Showing {filteredTasks.length} of {vendorScopedTasks.length} tasks ·
            Click any task for walkthrough
          </span>
          {selectedArea !== "ALL" && (
            <button
              type="button"
              onClick={() => setSelectedArea("ALL")}
              className="text-[#38bdf8] hover:underline shrink-0"
            >
              Clear area
            </button>
          )}
        </div>

        {tasks.length === 0 ? (
          <div className="rounded-md border border-[#212a36] bg-[#10151c] p-6 text-center text-xs text-[#8b98a9]">
            {isLoadingApi
              ? "Syncing live vendor tasks & walkthroughs from gzw-data.dev..."
              : "No vendor tasks cached yet. Click Refresh API to sync."}
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="rounded-md border border-[#212a36] bg-[#10151c] p-6 text-center text-xs text-[#8b98a9]">
            No tasks match{" "}
            {selectedVendor !== "ALL" ? selectedVendor : "your filters"}
            {selectedArea !== "ALL" ? ` in ${selectedArea}` : ""}.
          </div>
        ) : (
          <div
            className={`grid gap-2.5 ${
              isExpanded ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
            }`}
          >
            {filteredTasks.map((task) => {
              const isDone = !!completedTasks[task.id];
              const isSelected = selectedTaskId === task.id;
              const isOpen = !!expandedTaskIds[task.id];
              const hasMapCoords =
                task.exactCoords.length > 0 || task.matchedPois.length > 0;
              const previewImg = task.guideImage || task.image;

              return (
                <article
                  key={task.id}
                  onClick={() => toggleTaskExpanded(task.id)}
                  className={`rounded-md border p-3 transition-colors flex flex-col justify-between cursor-pointer ${
                    isSelected
                      ? "bg-[#121923] border-[#38bdf8]"
                      : isOpen
                        ? "bg-[#111720] border-[#3b4a5e]"
                        : isDone
                          ? "bg-[#0d1413] border-[#1f3b32]"
                          : "bg-[#10151c] border-[#212a36] hover:border-[#344254]"
                  }`}
                >
                  <div>
                    {/* Zero-pill typographic metadata line */}
                    <div className="flex items-center justify-between gap-2 font-mono-tabular text-[10px] uppercase tracking-wider text-[#8b98a9]">
                      <span className="truncate">
                        <span className="text-[#e5a93c] font-semibold">
                          {task.vendor}
                        </span>
                        <span className="mx-1.5 text-[#3a4657]">·</span>
                        <span className="text-[#cbd5e1]">
                          {task.areas.join(", ")}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 shrink-0">
                        {task.guideImage && (
                          <ImageIcon
                            className="w-3 h-3 text-[#38bdf8]"
                            aria-label="Includes location image"
                          />
                        )}
                        <span
                          className={
                            task.category === "Main Task"
                              ? "text-[#38bdf8]"
                              : task.category === "Hidden Task"
                                ? "text-purple-400"
                                : task.category === "Contract"
                                  ? "text-[#e5a93c]"
                                  : "text-[#7f8ea1]"
                          }
                        >
                          {task.category}
                        </span>
                      </span>
                    </div>

                    {/* Task Title + Expand Chevron */}
                    <div className="mt-1 flex items-start justify-between gap-2">
                      <h3
                        className={`font-display text-sm font-semibold leading-snug ${
                          isDone ? "text-[#94a3b8] line-through" : "text-[#eef3f8]"
                        }`}
                      >
                        {task.name}
                      </h3>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {task.vendorRankRequired && (
                          <span className="font-mono-tabular text-[10px] text-[#e5a93c]">
                            Rk {task.vendorRankRequired}
                          </span>
                        )}
                        {isOpen ? (
                          <ChevronUp className="w-4 h-4 text-[#38bdf8]" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-[#7f8ea1]" />
                        )}
                      </div>
                    </div>

                    {/* Concise Objectives Summary */}
                    {task.objectivesText && (
                      <div className="mt-2 rounded bg-[#0a0e13] border border-[#1d2531] px-2.5 py-2 text-xs text-[#dce4ee] leading-relaxed">
                        <div className="flex items-start gap-1.5">
                          <Crosshair className="w-3.5 h-3.5 text-[#e5a93c] shrink-0 mt-0.5" />
                          <span>{task.objectivesText}</span>
                        </div>
                        {task.objectivesList.length > 0 && (
                          <ul className="mt-1.5 pl-5 space-y-0.5 text-[11px] text-[#9fb0c4] list-disc">
                            {task.objectivesList.map((step, idx) => (
                              <li key={idx}>{step}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* Quick Collapsed Hints: Coords / LZs / Gear */}
                    {!isOpen &&
                      (task.exactCoords.length > 0 ||
                        task.relatedItems.length > 0 ||
                        task.nearestLzs.length > 0) && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-tabular text-[10px] text-[#8b98a9]">
                          {task.exactCoords.length > 0 && (
                            <span className="text-[#38bdf8]">
                              Grid{" "}
                              {task.exactCoords.map((c) => c.grid).join(" / ")}
                            </span>
                          )}
                          {task.nearestLzs.length > 0 && (
                            <span>LZ: {task.nearestLzs.slice(0, 2).join(", ")}</span>
                          )}
                          {task.relatedItems.length > 0 && (
                            <span className="text-[#e5a93c]">
                              {task.relatedItems.length} item/key note
                              {task.relatedItems.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      )}

                    {/* Alternate / Hidden notes */}
                    {task.alternate && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#f59e0b]">
                        <GitBranch className="w-3 h-3 shrink-0" />
                        <span className="truncate">
                          Alternate choice: {task.alternate}
                        </span>
                      </div>
                    )}

                    {task.hiddenNote && (
                      <div className="mt-1 text-[11px] text-purple-300">
                        Unlock: {task.hiddenNote}
                      </div>
                    )}

                    {/* ======================================================
                        EXPANDED TASK WALKTHROUGH, IMAGES, ITEMS & INTEL
                       ====================================================== */}
                    {isOpen && (
                      <div
                        className="mt-3 pt-3 border-t border-[#1e2734] space-y-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Guide / Location Image */}
                        {previewImg && (
                          <div className="rounded bg-[#080b0f] border border-[#222c3a] overflow-hidden">
                            <button
                              type="button"
                              onClick={() =>
                                setLightboxImage({
                                  src: previewImg,
                                  title: `${task.name} — ${
                                    task.guideImage
                                      ? "Location Guide"
                                      : `${task.vendor} Task Intel`
                                  }`,
                                })
                              }
                              className="w-full text-left group relative block"
                            >
                              <img
                                src={previewImg}
                                alt={`${task.name} visual reference`}
                                referrerPolicy="no-referrer"
                                className={`w-full object-cover ${
                                  task.guideImage ? "max-h-44" : "max-h-24 opacity-85"
                                } group-hover:opacity-100 transition-opacity`}
                              />
                              <div className="px-2.5 py-1.5 flex items-center justify-between text-[10px] font-mono-tabular text-[#8b98a9] bg-[#0a0e13]/90 border-t border-[#1c2430]">
                                <span>
                                  {task.guideImage
                                    ? "API Location Screenshot"
                                    : `${task.vendor} Mission Banner`}
                                </span>
                                <span className="text-[#38bdf8]">
                                  Click to enlarge
                                </span>
                              </div>
                            </button>
                          </div>
                        )}

                        {/* Step-by-Step Walkthrough */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="inline-flex items-center gap-1.5 font-mono-tabular text-[10px] uppercase tracking-wider text-[#38bdf8] font-semibold">
                              <BookOpen className="w-3 h-3" />
                              Task Walkthrough
                            </span>
                            <span className="font-mono-tabular text-[9px] uppercase text-[#6f7e91]">
                              {task.walkthroughSource === "api-guide"
                                ? "API Field Guide"
                                : task.walkthroughSource === "curated"
                                  ? "0.5 Tactical Guide"
                                  : "Mission Intel"}
                            </span>
                          </div>
                          <ol className="space-y-1.5">
                            {task.walkthroughSteps.map((step, i) => (
                              <li
                                key={i}
                                className="flex items-start gap-2 text-xs text-[#dce4ee] leading-relaxed bg-[#0a0e13] border border-[#1a222d] rounded px-2.5 py-2"
                              >
                                <span className="font-mono-tabular text-[10px] font-bold text-[#e5a93c] shrink-0 mt-0.5">
                                  {String(i + 1).padStart(2, "0")}
                                </span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ol>
                        </div>

                        {/* Exact Coords & Nearest LZs */}
                        {(task.exactCoords.length > 0 ||
                          task.nearestLzs.length > 0) && (
                          <div className="rounded bg-[#0a0e13] border border-[#1d2531] px-2.5 py-2 space-y-1.5 text-xs">
                            <div className="flex items-center gap-1.5 font-mono-tabular text-[10px] uppercase tracking-wider text-[#e5a93c]">
                              <Compass className="w-3 h-3" />
                              Infil &amp; Target Grids
                            </div>
                            {task.exactCoords.map((coord) => (
                              <div
                                key={coord.grid}
                                className="flex items-center justify-between gap-2 text-[11px]"
                              >
                                <span className="text-[#cbd5e1] truncate">
                                  {coord.label}
                                </span>
                                <span className="font-mono-tabular text-[#38bdf8] shrink-0">
                                  Grid {coord.grid}
                                </span>
                              </div>
                            ))}
                            {task.nearestLzs.length > 0 && (
                              <div className="text-[11px] text-[#9fb0c4]">
                                Nearest LZs:{" "}
                                <span className="text-[#fde047] font-mono-tabular">
                                  {task.nearestLzs.join(" · ")}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Required Gear, Keys & Task Items */}
                        {task.relatedItems.length > 0 && (
                          <div>
                            <div className="inline-flex items-center gap-1.5 font-mono-tabular text-[10px] uppercase tracking-wider text-[#e5a93c] mb-1.5">
                              <KeyRound className="w-3 h-3" />
                              Required Gear, Keys &amp; Items
                            </div>
                            <div className="space-y-1.5">
                              {task.relatedItems.map((item, idx) => (
                                <div
                                  key={`${item.name}-${idx}`}
                                  className="flex items-center gap-2.5 rounded bg-[#0a0e13] border border-[#1d2531] px-2.5 py-1.5"
                                >
                                  <ItemThumbnail
                                    src={item.image}
                                    alt={item.name}
                                    sizeClass="w-7 h-7"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-medium text-[#eef3f8] truncate">
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

                        {/* Boss / Tactical Tip */}
                        {(task.bossWarning || task.guideTip) && (
                          <div className="rounded bg-[#18120c] border border-[#e5a93c]/40 px-2.5 py-2 space-y-1 text-[11px] text-[#f3d49b]">
                            {task.bossWarning && (
                              <div className="flex items-start gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-[#f59e0b] shrink-0 mt-0.5" />
                                <span>{task.bossWarning}</span>
                              </div>
                            )}
                            {task.guideTip && (
                              <div className="text-[#cbd5e1]">
                                Tip: {task.guideTip}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Full Vendor Briefing */}
                        {task.briefing && (
                          <div className="text-xs text-[#9fb0c4] leading-relaxed border-l-2 border-[#2a3646] pl-2.5">
                            <div className="font-mono-tabular text-[9px] uppercase tracking-wider text-[#6f7e91] mb-0.5">
                              {task.vendor} Briefing
                            </div>
                            {task.briefing}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Card Footer: Locate on Map (always opens Map + Walkthrough!) + Complete Toggle */}
                  <div
                    className="mt-3 pt-2 border-t border-[#1c2430] flex items-center justify-between gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onLocateTaskOnMap(task)}
                      className={`min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-colors ${
                        isSelected
                          ? "bg-[#142536] border-[#38bdf8] text-[#7dd3fc]"
                          : "bg-[#0c1118] border-[#253040] text-[#38bdf8] hover:border-[#38bdf8]"
                      }`}
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>
                        {hasMapCoords ? "Locate on Map" : "Map Walkthrough"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleTaskComplete(task.id)}
                      className={`min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors whitespace-nowrap ${
                        isDone
                          ? "bg-[#112720] border-[#2b6b53] text-[#34d399] hover:border-[#34d399]"
                          : "bg-[#141a23] border-[#2b3748] text-[#dce4ee] hover:border-[#e5a93c] hover:text-[#e5a93c]"
                      }`}
                    >
                      {isDone && <Check className="w-3 h-3 stroke-[2.5]" />}
                      {isDone ? "Completed" : "Mark Done"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Image Preview Lightbox */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[2100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="max-w-2xl w-full rounded-md bg-[#0c1016] border border-[#2c3849] overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2.5 border-b border-[#212a36] flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[#eef3f8] truncate">
                {lightboxImage.title}
              </span>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="p-1 rounded text-[#8b98a9] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 bg-[#070a0e] flex justify-center">
              <img
                src={lightboxImage.src}
                alt={lightboxImage.title}
                referrerPolicy="no-referrer"
                className="max-h-[75vh] w-auto object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
