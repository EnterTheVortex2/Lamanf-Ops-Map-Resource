import {
  BLUE_CRATES_05,
  CHEMICAL_AREAS_05,
  DISASSEMBLY_SPAWNS_05,
  LAMANG_POIS,
  type CustomMapPin,
  type MapLayerKey,
} from "../config/mapConfig";
import {
  CANONICAL_HIDEOUT_UPGRADES,
  FALLBACK_DISASSEMBLY_RECIPES,
  MATERIAL_INTEL_HINTS,
  type DisassemblyRecipeDef,
  type HideoutUpgradeDef,
  type RoomId,
} from "../data/hideoutData";
import type { ApiCachePayload, NormalizedApiRecord } from "../services/gzwApi";

export interface CatalogMaterial {
  key: string;
  id: string;
  name: string;
  room: RoomId | "all";
  dataset: string;
  required: number;
  tiersUsed: number[];
  layerHint: Exclude<MapLayerKey, "tickedSpawns" | "poiLabels" | "subLocations" | "copsAndLzs">;
  image: string | null;
  description: string;
  weight?: string;
  gridSize?: string;
  sellPrice?: string;
  spawnNotes: string[];
  usedInUpgrades: {
    id: string;
    name: string;
    module: string;
    room: RoomId;
    level: number;
    quantity: number;
  }[];
  apiCoords: { x: number; y: number; label: string }[];
}

export interface SpawnPoint {
  x: number;
  y: number;
  title: string;
  source: string;
  tier?: string;
  lz?: string;
  kind?: string;
}

function mapApiRoomToRoomId(roomStr?: string, slotOrName?: string): RoomId {
  const combined = `${roomStr || ""} ${slotOrName || ""}`.toLowerCase();
  if (combined.includes("utility") || combined.includes("generator")) {
    return "utility";
  }
  if (
    combined.includes("electron") ||
    combined.includes("hardware") ||
    combined.includes("machine tools") ||
    combined.includes("rf") ||
    combined.includes("software")
  ) {
    return "electronics";
  }
  if (
    combined.includes("lab") ||
    combined.includes("analysis") ||
    combined.includes("extraction") ||
    combined.includes("filtration") ||
    combined.includes("glass") ||
    combined.includes("heat source") ||
    combined.includes("reaction") ||
    combined.includes("safety")
  ) {
    return "laboratory";
  }
  return "utility";
}

function guessLayerHint(
  name: string,
  desc: string
): Exclude<MapLayerKey, "tickedSpawns" | "poiLabels" | "subLocations" | "copsAndLzs"> {
  const hint = MATERIAL_INTEL_HINTS[name.toLowerCase()];
  if (hint) return hint.layerHint;

  const text = `${name} ${desc}`.toLowerCase();
  if (
    text.includes("pc ") ||
    text.includes("circuit") ||
    text.includes("cpu") ||
    text.includes("ram") ||
    text.includes("power supply") ||
    text.includes("oscilloscope") ||
    text.includes("multimeter") ||
    text.includes("soldering") ||
    text.includes("electrical") ||
    text.includes("sensor") ||
    text.includes("signal") ||
    text.includes("motherboard") ||
    text.includes("graphics") ||
    text.includes("software") ||
    text.includes("laser")
  ) {
    return "pcSpawns";
  }
  if (
    text.includes("plastic") ||
    text.includes("steel") ||
    text.includes("wood") ||
    text.includes("plumbing") ||
    text.includes("construction") ||
    text.includes("mechanical") ||
    text.includes("copper") ||
    text.includes("burner") ||
    text.includes("pump") ||
    text.includes("mesh") ||
    text.includes("sealant") ||
    text.includes("indicator") ||
    text.includes("sheet") ||
    text.includes("dynamo") ||
    text.includes("motor oil") ||
    text.includes("tool")
  ) {
    return "blueCrates";
  }
  return "apiLoot";
}

/**
 * Builds the complete 36 Hideout Upgrades list across Utility Room, Electronics Workshop,
 * and Laboratory (Levels 1, 2, 3), preferring live API `hideout_modules` when loaded
 * and merging with canonical 0.5 module definitions so all 36 are always present.
 */
export function buildAllHideoutUpgrades(
  apiCache: ApiCachePayload | null
): HideoutUpgradeDef[] {
  const byKey = new Map<string, HideoutUpgradeDef>();

  // 1. Seed canonical 36 modules first
  for (const upg of CANONICAL_HIDEOUT_UPGRADES) {
    const key = `${upg.room}::${upg.module.toLowerCase()}::${upg.level}`;
    byKey.set(key, upg);
  }

  // 2. Overlay/enrich from live `hideout_modules` API dataset
  const apiModules = apiCache?.datasets?.hideout_modules || [];
  for (const mod of apiModules) {
    const roomId = mapApiRoomToRoomId(mod.room, mod.name);
    const modName = mod.module || mod.category || "Module";
    const level = mod.level || 1;
    const key = `${roomId}::${modName.toLowerCase()}::${level}`;
    const existing = byKey.get(key);

    const apiBenefit = mod.benefit && !mod.benefit.includes("+ x ")
      ? mod.benefit
      : existing?.benefit || mod.benefit || mod.description || "Hideout upgrade";

    byKey.set(key, {
      id: existing?.id || mod.id,
      room: roomId,
      module: modName,
      level,
      name: mod.name || existing?.name || `${modName} Level ${level}`,
      benefit: apiBenefit,
      requirements:
        mod.requirements && mod.requirements.length > 0
          ? mod.requirements
          : existing?.requirements || [],
    });
  }

  return Array.from(byKey.values()).sort(
    (a, b) =>
      a.module.localeCompare(b.module) ||
      a.level - b.level ||
      a.room.localeCompare(b.room)
  );
}

/**
 * Strictly returns ONLY materials required for the 36 Hideout Upgrades (Tier 1, 2, and 3)
 * — never unrelated loot — enriched with metadata & icons from gzw-data.dev.
 */
export function buildMaterialsCatalog(
  apiCache: ApiCachePayload | null,
  allUpgrades: HideoutUpgradeDef[]
): CatalogMaterial[] {
  const byNormName = new Map<string, CatalogMaterial>();

  for (const upg of allUpgrades) {
    for (const req of upg.requirements) {
      if (req.name.toLowerCase() === "dollars") continue;
      const norm = req.name.trim().toLowerCase();
      const slug = norm.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const hint = MATERIAL_INTEL_HINTS[norm];

      let entry = byNormName.get(norm);
      if (!entry) {
        entry = {
          key: slug,
          id: slug,
          name: req.name,
          room: upg.room,
          dataset: "Hideout Upgrade Material",
          required: 0,
          tiersUsed: [],
          layerHint: hint?.layerHint || guessLayerHint(req.name, ""),
          image: null,
          description: hint?.description || `Required for ${upg.module} upgrades.`,
          spawnNotes: hint ? [...hint.spawnNotes] : ["Lamang Loot Containers & Crates"],
          usedInUpgrades: [],
          apiCoords: [],
        };
        byNormName.set(norm, entry);
      }

      entry.required += req.quantity;
      if (!entry.tiersUsed.includes(upg.level)) {
        entry.tiersUsed.push(upg.level);
        entry.tiersUsed.sort((a, b) => a - b);
      }

      entry.usedInUpgrades.push({
        id: upg.id,
        name: upg.name,
        module: upg.module,
        room: upg.room,
        level: upg.level,
        quantity: req.quantity,
      });
    }
  }

  // Enrich ONLY those Hideout Upgrade Materials with images, weight, price, and spawn metadata from API
  const enrichmentDatasets = [
    "gamedata_hideout_materials",
    "building_material",
    "workshop_supplies",
    "laboratory_supplies",
    "electronics",
    "tools",
  ];

  for (const ds of enrichmentDatasets) {
    const rows: NormalizedApiRecord[] = apiCache?.datasets?.[ds] || [];
    for (const rec of rows) {
      const norm = rec.name.trim().toLowerCase();
      const existing = byNormName.get(norm);
      if (!existing) continue;

      if (!existing.image && rec.image) existing.image = rec.image;
      if (rec.description && rec.description.length > existing.description.length) {
        existing.description = rec.description;
      }
      if (rec.weight && !existing.weight) existing.weight = rec.weight;
      if (rec.gridSize && !existing.gridSize) existing.gridSize = rec.gridSize;
      if (rec.sellPrice && !existing.sellPrice) existing.sellPrice = rec.sellPrice;
      if (ds !== "gamedata_hideout_materials") {
        existing.dataset = ds.replace(/_/g, " ");
      }
      for (const sn of rec.spawnNotes) {
        if (!existing.spawnNotes.includes(sn)) existing.spawnNotes.push(sn);
      }
      if (rec.coords) {
        existing.apiCoords.push({ ...rec.coords, label: rec.name });
      }
    }
  }

  return Array.from(byNormName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export function buildDisassemblyRecipes(
  apiCache: ApiCachePayload | null
): DisassemblyRecipeDef[] {
  const apiRows = apiCache?.datasets?.disassembly_recipes || [];
  if (apiRows.length === 0) return FALLBACK_DISASSEMBLY_RECIPES;

  return apiRows.map((rec) => {
    const raw = rec.raw || {};
    const outcomes = Array.isArray(raw.outcome)
      ? raw.outcome.map((o) => String(o))
      : typeof raw.outcome_text === "string"
        ? raw.outcome_text.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    return {
      id: rec.id,
      name: rec.name,
      duration: typeof raw.duration === "string" ? raw.duration : "4–8 hours",
      outcomes,
      sellPrice:
        typeof raw.sell_price === "string" ? raw.sell_price : rec.sellPrice,
    };
  });
}

export function resolveSpawnPointsForMaterial(
  mat: CatalogMaterial,
  customPins: CustomMapPin[],
  extraLootNotes: string[] = []
): SpawnPoint[] {
  const points: SpawnPoint[] = [];

  for (const pin of customPins) {
    if (pin.materialId === mat.id || pin.materialId === mat.key) {
      points.push({
        x: pin.x,
        y: pin.y,
        title: pin.label,
        source: "Pinned Spawn",
        kind: "pin",
      });
    }
  }

  for (const c of mat.apiCoords) {
    points.push({
      x: c.x,
      y: c.y,
      title: c.label,
      source: "API Coordinates",
      kind: "api",
    });
  }

  const textBlob = [
    mat.name,
    mat.description,
    ...mat.spawnNotes,
    ...extraLootNotes,
  ]
    .join(" ")
    .toLowerCase();

  // Direct Disassembly Item matches (e.g., UNLRA Field Terminal, IMSI Catcher, Chemical Containment Container)
  for (const dis of DISASSEMBLY_SPAWNS_05) {
    if (textBlob.includes(dis.name.toLowerCase())) {
      points.push({
        x: dis.x,
        y: dis.y,
        title: `${dis.name} — ${dis.poi}`,
        source: "Disassembly Spawn",
        kind: "disassembly",
      });
    }
  }

  // Direct Chemicals Supplies Areas when inspecting Chemicals
  if (mat.name.toLowerCase() === "chemicals" || textBlob.includes("chemical supplies")) {
    for (const chem of CHEMICAL_AREAS_05.slice(0, 12)) {
      points.push({
        x: chem.x,
        y: chem.y,
        title: `Chemicals Supplies — ${chem.poi}`,
        source: "Chemicals Supplies Area",
        kind: "chemicals",
      });
    }
  }

  // Exact Update 0.5 POIs & Sub-Locations matching material tags/notes
  const matchedPois: SpawnPoint[] = [];
  for (const poi of LAMANG_POIS) {
    if (poi.kind === "base" || poi.kind === "cop" || poi.kind === "lz") continue;
    const nameMatch = textBlob.includes(poi.name.toLowerCase());
    const tagMatch = poi.tags.some((tag) => tag.length >= 3 && textBlob.includes(tag));
    if (nameMatch || tagMatch) {
      matchedPois.push({
        x: poi.x,
        y: poi.y,
        title:
          poi.kind === "sublocation" && poi.parentRegion
            ? `${poi.parentRegion} — ${poi.name}`
            : poi.name,
        tier: poi.tier,
        lz: poi.lz,
        kind: poi.kind,
        source: nameMatch
          ? "Reported Spawn Location"
          : poi.kind === "sublocation"
            ? `${poi.parentRegion || "Compound"} Spawn`
            : "Loot Region",
      });
    }
  }

  // Prioritize Tier 4 / Major POIs + top matching sub-compounds (cap to avoid crowding)
  matchedPois.sort((a, b) => {
    const score = (k?: string) => (k === "tier4" ? 0 : k === "major" ? 1 : 2);
    return score(a.kind) - score(b.kind);
  });
  points.push(...matchedPois.slice(0, 14));

  // Include representative Blue-Planked Building Material Crates for building materials
  if (mat.layerHint === "blueCrates") {
    const seenRegions = new Set<string>();
    for (const crate of BLUE_CRATES_05) {
      if (seenRegions.has(crate.poi)) continue;
      const matchesRegion =
        textBlob.includes(crate.poi.toLowerCase()) || seenRegions.size < 6;
      if (matchesRegion) {
        seenRegions.add(crate.poi);
        points.push({
          x: crate.x,
          y: crate.y,
          title: `Building Material Crate — ${crate.poi}`,
          source: "Blue-Planked Material Crate",
          kind: "crate",
        });
      }
      if (seenRegions.size >= 10) break;
    }
  }

  if (points.length === 0) {
    const fallbackTag = mat.layerHint === "pcSpawns" ? "pc" : "blue_crate";
    for (const poi of LAMANG_POIS) {
      if (poi.kind !== "major" && poi.kind !== "tier4") continue;
      if (poi.tags.includes(fallbackTag)) {
        points.push({
          x: poi.x,
          y: poi.y,
          title: poi.name,
          tier: poi.tier,
          lz: poi.lz,
          kind: poi.kind,
          source:
            fallbackTag === "pc" ? "PC Part Spawn Zone" : "Blue-Planked Crate Zone",
        });
      }
    }
  }

  const unique: SpawnPoint[] = [];
  const seen = new Set<string>();
  for (const pt of points) {
    const k = `${pt.x},${pt.y}`;
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(pt);
    }
  }
  return unique;
}
