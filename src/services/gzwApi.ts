import { GzwDataClient } from "@zoniboy/gzw-data-client";

export const API_ROOT = "https://gzw-data.dev/api/v1";

const CACHE_KEY = "lamang_ops_gzw_api_cache_v5";
const SPAWN_LOOKUP_CACHE_KEY = "lamang_ops_spawn_lookup_v3";

// Direct SDK fallback client (used only if backend /api/gzw/* proxy is unavailable)
export const gzwClient = new GzwDataClient({
  baseUrl: API_ROOT,
  cache: { ttlMs: 5 * 60 * 1000, maxEntries: 200 },
  retries: 1,
  timeoutMs: 8000,
});

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

export async function discoverAndFetchAllDatasets(
  forceRefresh = false
): Promise<ApiCachePayload> {
  // Primary path: Express server-side proxy (/api/gzw/bootstrap)
  const res = await fetch(
    `/api/gzw/bootstrap${forceRefresh ? "?force=1" : ""}`,
    {
      headers: { Accept: "application/json" },
    }
  );
  if (!res.ok) {
    throw new Error(`API proxy returned ${res.status}`);
  }
  const payload = (await res.json()) as ApiCachePayload;
  if (!payload || !payload.datasets || Object.keys(payload.datasets).length === 0) {
    throw new Error("Empty dataset payload received");
  }
  safeStorageSet(CACHE_KEY, payload);
  return payload;
}

/**
 * Live per-material spawn & loot-table lookup via /api/gzw/search (cached in localStorage).
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
  const matchedModules: { name: string; room?: string; quantity?: number }[] = [];

  try {
    let results: Record<string, Record<string, unknown>[]> = {};
    const res = await fetch(`/api/gzw/search?q=${encodeURIComponent(itemName)}`);
    if (res.ok) {
      const json = (await res.json()) as {
        results?: Record<string, Record<string, unknown>[]>;
      };
      results = json.results || {};
    } else {
      const resp = await gzwClient.search(itemName, { limit: 15 });
      results = (resp?.results || {}) as Record<string, Record<string, unknown>[]>;
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
  const res = await fetch(`/api/gzw/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) return {};
  const json = (await res.json()) as {
    results?: Record<string, Record<string, unknown>[]>;
  };
  return json.results || {};
}
