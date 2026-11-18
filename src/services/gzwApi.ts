import { GzwDataClient } from "@zoniboy/gzw-data-client";

export const API_ROOT = "https://gzw-data.dev/api/v1";

const CACHE_KEY = "lamang_ops_gzw_api_cache_v8";
const SPAWN_LOOKUP_CACHE_KEY = "lamang_ops_spawn_lookup_v3";

const PRIORITY_DATASETS = [
  "hideout_modules",
  "disassembly_recipes",
  "building_material",
  "workshop_supplies",
  "laboratory_supplies",
  "electronics",
  "tools",
  "keys",
  "keycards",
  "loot_container",
  "regions",
  "vendors",
  "tasks",
  "main_task",
  "side_task",
  "hidden_task",
  "contract",
  "contracts",
  "squad_strike_missions",
  "squad_strike_missions_item",
  "task_items",
  "task_guides",
  "intels",
  "bosses",
];

const MAX_PAGES_BY_DATASET: Record<string, number> = {
  tasks: 7,
  side_task: 3,
  keys: 3,
  task_items: 3,
  task_guides: 2,
  intels: 6,
  squad_strike_missions_item: 2,
  contract: 2,
  contracts: 2,
  loot_container: 2,
};

// Direct SDK fallback client (used when backend /api/gzw/* proxy is unavailable, e.g. GitHub Pages)
export const gzwClient = new GzwDataClient({
  baseUrl: API_ROOT,
  cache: { ttlMs: 5 * 60 * 1000, maxEntries: 200 },
  retries: 1,
  timeoutMs: 8000,
});

export function isStaticHostingEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return (
    host.endsWith(".github.io") ||
    host === "github.io" ||
    window.location.protocol === "file:"
  );
}

export interface NormalizedApiRecord {
  uid: string;
  id: string;
  dataset: string;
  name: string;
  description: string;
  category: string;
  image: string | null;
  weight?: string;
  gridSize?: string;
  sellPrice?: string;
  manufacturer?: string;
  room?: string;
  module?: string;
  level?: number;
  requirements?: { name: string; quantity: number }[];
  benefit?: string;
  spawnNotes: string[];
  coords: { x: number; y: number } | null;
  raw: Record<string, unknown>;
}

export interface ApiCachePayload {
  timestamp: string;
  discoveredDatasets: string[];
  totalAvailableDatasets: number;
  datasets: Record<string, NormalizedApiRecord[]>;
  proxySource?: string;
}

export interface LootSpawnSource {
  table: string;
  source: string;
  chancePerRoll?: number;
}

export interface ItemSpawnLookupResult {
  query: string;
  foundIn: LootSpawnSource[];
  matchedModules: { name: string; room?: string; quantity?: number }[];
  fetchedAt: string;
}

/* Safe localStorage helpers with in-memory fallback */
const memoryStorage = new Map<string, string>();

export function safeStorageGet<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    const mem = memoryStorage.get(key);
    if (mem !== undefined) {
      try {
        return JSON.parse(mem) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

export function safeStorageSet(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  memoryStorage.set(key, serialized);
  try {
    window.localStorage.setItem(key, serialized);
  } catch {
    // Kept in memoryStorage
  }
}

export function loadCachedApiData(): ApiCachePayload | null {
  const cached = safeStorageGet<ApiCachePayload | null>(CACHE_KEY, null);
  if (cached && cached.datasets && Object.keys(cached.datasets).length > 0) {
    return cached;
  }
  return null;
}

function extractSpawnNotesClient(raw: Record<string, unknown>): string[] {
  const notes: string[] = [];
  const candidateKeys = [
    "spawn",
    "spawns",
    "spawn_location",
    "spawn_locations",
    "location",
    "locations",
    "found_in",
    "region",
    "regions",
    "lz_callsign",
    "locals_type",
  ];
  for (const key of candidateKeys) {
    const val = raw[key];
    if (!val) continue;
    if (typeof val === "string" && val.trim()) {
      notes.push(val.trim());
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string" && item.trim()) {
          notes.push(item.trim());
        } else if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const label = [obj.source, obj.table].filter(Boolean).join(" · ");
          if (label) notes.push(label);
        }
      }
    }
  }
  return Array.from(new Set(notes));
}

function extractCoordsClient(
  raw: Record<string, unknown>
): { x: number; y: number } | null {
  if (typeof raw.x === "number" && typeof raw.y === "number") {
    return { x: raw.x, y: raw.y };
  }
  const coordinates = raw.coordinates as Record<string, unknown> | undefined;
  if (
    coordinates &&
    typeof coordinates.x === "number" &&
    typeof coordinates.y === "number"
  ) {
    return { x: coordinates.x, y: coordinates.y };
  }
  if (Array.isArray(raw.coords) && raw.coords.length >= 2) {
    const x = Number(raw.coords[0]);
    const y = Number(raw.coords[1]);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return { x, y };
  }
  return null;
}

function extractRequirementsClient(
  raw: Record<string, unknown>
): { name: string; quantity: number }[] | undefined {
  const list = (raw.requirements || raw.build_materials) as unknown;
  if (!Array.isArray(list)) return undefined;
  const parsed: { name: string; quantity: number }[] = [];
  for (const entry of list) {
    if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const name = String(obj.name || obj.id || "").trim();
      const qty = Number(obj.quantity ?? obj.amount ?? 1);
      if (name) {
        parsed.push({ name, quantity: Number.isNaN(qty) ? 1 : qty });
      }
    }
  }
  return parsed.length > 0 ? parsed : undefined;
}

function normalizeRecordClient(
  dataset: string,
  raw: Record<string, unknown>,
  index: number
): NormalizedApiRecord {
  const id = String(raw.id || `${dataset}_${index}`);
  const name = String(
    raw.name ||
      raw.title ||
      raw.item_name ||
      raw.module_name ||
      raw.id ||
      `${dataset} #${index + 1}`
  );
  const description = String(
    raw.description || raw.desc || raw.summary || raw.requirements_text || ""
  );
  const category = String(
    raw.type || raw.category || raw.room || raw.slot || dataset
  );
  const image =
    typeof raw.image === "string" && raw.image.trim() ? raw.image.trim() : null;

  let sellPrice: string | undefined;
  if (typeof raw.sell_price === "string") {
    sellPrice = raw.sell_price;
  } else if (Array.isArray(raw.sell_prices) && raw.sell_prices.length > 0) {
    const first = raw.sell_prices[0] as Record<string, unknown>;
    if (first && first.price !== undefined) {
      const vendors = Array.isArray(first.vendors)
        ? first.vendors.join(", ")
        : "";
      sellPrice = `$${first.price}${vendors ? ` (${vendors})` : ""}`;
    }
  }

  return {
    uid: `${dataset}::${id}`,
    id,
    dataset,
    name,
    description,
    category,
    image,
    weight: typeof raw.weight === "string" ? raw.weight : undefined,
    gridSize: typeof raw.grid_size === "string" ? raw.grid_size : undefined,
    sellPrice,
    manufacturer:
      typeof raw.manufacturer === "string" ? raw.manufacturer : undefined,
    room: typeof raw.room === "string" ? raw.room : undefined,
    module: typeof raw.module === "string" ? raw.module : undefined,
    level: typeof raw.level === "number" ? raw.level : undefined,
    requirements: extractRequirementsClient(raw),
    benefit: typeof raw.function === "string" ? raw.function : undefined,
    spawnNotes: extractSpawnNotesClient(raw),
    coords: extractCoordsClient(raw),
    raw,
  };
}

async function fetchDirectFromGzw(): Promise<ApiCachePayload> {
  const datasets: Record<string, NormalizedApiRecord[]> = {};
  const discoveredDatasets: string[] = [];

  const batchSize = 4;
  for (let i = 0; i < PRIORITY_DATASETS.length; i += batchSize) {
    const slice = PRIORITY_DATASETS.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      slice.map(async (dataset) => {
        const maxPages = MAX_PAGES_BY_DATASET[dataset] ?? 2;
        const rows: NormalizedApiRecord[] = [];
        let page = 1;

        while (page <= maxPages) {
          const upstreamRes = await fetch(
            `${API_ROOT}/${encodeURIComponent(dataset)}?page=${page}`,
            { signal: AbortSignal.timeout(10000) }
          );
          if (!upstreamRes.ok) break;
          const resp = (await upstreamRes.json()) as {
            data?: Record<string, unknown>[];
            totalPages?: number;
            perPage?: number;
          };
          const batch = Array.isArray(resp.data) ? resp.data : [];
          if (batch.length === 0) break;

          const pageSize = resp.perPage || batch.length || 50;
          rows.push(
            ...batch.map((item, idx) =>
              normalizeRecordClient(dataset, item, (page - 1) * pageSize + idx)
            )
          );

          if (resp.totalPages && page >= resp.totalPages) break;
          page += 1;
        }

        const cleanRows = rows.filter((r) => !r.name.startsWith("<DEV>"));
        return { dataset, rows: cleanRows };
      })
    );

    for (const res of settled) {
      if (res.status === "fulfilled" && res.value.rows.length > 0) {
        datasets[res.value.dataset] = res.value.rows;
        discoveredDatasets.push(res.value.dataset);
      }
    }
  }

  if (discoveredDatasets.length === 0) {
    throw new Error("Could not fetch datasets directly from gzw-data.dev");
  }

  return {
    timestamp: new Date().toISOString(),
    discoveredDatasets,
    totalAvailableDatasets: discoveredDatasets.length,
    datasets,
    proxySource: "direct-browser",
  };
}

export async function discoverAndFetchAllDatasets(
  forceRefresh = false
): Promise<ApiCachePayload> {
  // On static hosts like GitHub Pages, fetch directly from gzw-data.dev (CORS enabled)
  if (!isStaticHostingEnvironment()) {
    try {
      const res = await fetch(
        `/api/gzw/bootstrap${forceRefresh ? "?force=1" : ""}`,
        { headers: { Accept: "application/json" } }
      );
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("application/json")) {
        const payload = (await res.json()) as ApiCachePayload;
        if (
          payload &&
          payload.datasets &&
          Object.keys(payload.datasets).length > 0
        ) {
          safeStorageSet(CACHE_KEY, payload);
          return payload;
        }
      }
    } catch {
      // Fall through to direct browser fetch
    }
  }

  const directPayload = await fetchDirectFromGzw();
  safeStorageSet(CACHE_KEY, directPayload);
  return directPayload;
}

/**
 * Live per-material spawn & loot-table lookup via /api/gzw/search (with direct gzw-data.dev fallback).
 */
export async function lookupMaterialSpawnIntel(
  itemName: string
): Promise<ItemSpawnLookupResult> {
  const cache = safeStorageGet<Record<string, ItemSpawnLookupResult>>(
    SPAWN_LOOKUP_CACHE_KEY,
    {}
  );
  const cacheKey = itemName.trim().toLowerCase();
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  const foundIn: LootSpawnSource[] = [];
  const matchedModules: { name: string; room?: string; quantity?: number }[] =
    [];

  try {
    let results: Record<string, Record<string, unknown>[]> = {};
    let loadedViaProxy = false;

    if (!isStaticHostingEnvironment()) {
      try {
        const res = await fetch(
          `/api/gzw/search?q=${encodeURIComponent(itemName)}`
        );
        const ct = res.headers.get("content-type") || "";
        if (res.ok && ct.includes("application/json")) {
          const json = (await res.json()) as {
            results?: Record<string, Record<string, unknown>[]>;
          };
          results = json.results || {};
          loadedViaProxy = true;
        }
      } catch {
        loadedViaProxy = false;
      }
    }

    if (!loadedViaProxy) {
      const resp = await gzwClient.search(itemName, { limit: 15 });
      results = (resp?.results || {}) as Record<
        string,
        Record<string, unknown>[]
      >;
    }

    const lootItems = results.gamedata_loot_by_item || [];
    for (const entry of lootItems) {
      const entryName = String(entry.name || "").toLowerCase();
      if (
        entryName === cacheKey ||
        entryName.includes(cacheKey) ||
        cacheKey.includes(entryName)
      ) {
        const list = Array.isArray(entry.found_in) ? entry.found_in : [];
        for (const f of list) {
          if (f && typeof f === "object") {
            const obj = f as Record<string, unknown>;
            foundIn.push({
              table: String(obj.table || "Loot Table"),
              source: String(obj.source || "World Container"),
              chancePerRoll:
                typeof obj.chance_per_roll === "number"
                  ? obj.chance_per_roll
                  : undefined,
            });
          }
        }
      }
    }

    const modules = results.hideout_modules || [];
    for (const mod of modules) {
      const reqs = Array.isArray(mod.requirements) ? mod.requirements : [];
      const matchingReq = reqs.find(
        (r: Record<string, unknown>) =>
          String(r.name || "").toLowerCase() === cacheKey
      ) as Record<string, unknown> | undefined;
      matchedModules.push({
        name: String(mod.name || "Hideout Module"),
        room: typeof mod.room === "string" ? mod.room : undefined,
        quantity: matchingReq ? Number(matchingReq.quantity || 1) : undefined,
      });
    }
  } catch {
    // Graceful empty result if upstream unavailable
  }

  const result: ItemSpawnLookupResult = {
    query: itemName,
    foundIn: foundIn.slice(0, 12),
    matchedModules,
    fetchedAt: new Date().toISOString(),
  };

  cache[cacheKey] = result;
  safeStorageSet(SPAWN_LOOKUP_CACHE_KEY, cache);
  return result;
}

export async function searchLiveApi(
  query: string
): Promise<Record<string, Record<string, unknown>[]>> {
  const q = query.trim();
  if (!q) return {};

  if (!isStaticHostingEnvironment()) {
    try {
      const res = await fetch(`/api/gzw/search?q=${encodeURIComponent(q)}`);
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("application/json")) {
        const json = (await res.json()) as {
          results?: Record<string, Record<string, unknown>[]>;
        };
        return json.results || {};
      }
    } catch {
      // Fall through to direct browser SDK search
    }
  }

  try {
    const resp = await gzwClient.search(q, { limit: 20 });
    return (resp?.results || {}) as Record<
      string,
      Record<string, unknown>[]
    >;
  } catch {
    return {};
  }
}
