import {
  DEFAULT_SEED_PINS,
  type CustomMapPin,
  type FactionId,
} from "../config/mapConfig";
import { safeStorageGet, safeStorageSet } from "../services/gzwApi";

export type OperatorSlotId = "op-1" | "op-2" | "op-3";

export const OPERATOR_SLOT_IDS: OperatorSlotId[] = ["op-1", "op-2", "op-3"];

export interface OperatorStateSnapshot {
  faction: FactionId;
  builtUpgrades: Record<string, boolean>;
  plannedUpgrades: Record<string, boolean>;
  stashCounts: Record<string, number>;
  completedTasks: Record<string, boolean>;
  ownedKeys: Record<string, boolean>;
  tickedMapMaterials: Record<string, boolean>;
  customPins: CustomMapPin[];
}

export interface OperatorProfileMeta {
  id: OperatorSlotId;
  name: string;
  faction: FactionId;
  updatedAt: number;
}

const ACTIVE_OP_KEY = "lamang_ops_active_operator_v1";
const OP_PROFILES_KEY = "lamang_ops_operator_profiles_v1";
const OP_STATE_PREFIX = "lamang_ops_operator_state_v1_";

// Legacy single-operator localStorage keys for seamless migration into Operator 1
const LEGACY_KEYS = {
  built: "lamang_ops_built_upgrades_v1",
  planned: "lamang_ops_planned_upgrades_v1",
  stash: "lamang_ops_stash_counts_v1",
  tasks: "lamang_ops_completed_tasks_v1",
  keys: "lamang_ops_owned_keys_v1",
  mapTicked: "lamang_ops_ticked_materials_v5",
  customPins: "lamang_ops_custom_pins_v5",
  faction: "lamang_ops_faction_v1",
};

const DEFAULT_NAMES: Record<OperatorSlotId, string> = {
  "op-1": "Operator 1",
  "op-2": "Operator 2",
  "op-3": "Operator 3",
};

export function createEmptyOperatorSnapshot(): OperatorStateSnapshot {
  return {
    faction: "ALL",
    builtUpgrades: {},
    plannedUpgrades: {},
    stashCounts: {},
    completedTasks: {},
    ownedKeys: {},
    tickedMapMaterials: {},
    customPins: DEFAULT_SEED_PINS.map((p) => ({ ...p })),
  };
}

function getStateKey(slotId: OperatorSlotId): string {
  return `${OP_STATE_PREFIX}${slotId}`;
}

function hasStoredKey(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function sanitizeFaction(raw: unknown): FactionId {
  return raw === "LRI" || raw === "MSS" || raw === "CSI" ? raw : "ALL";
}

function sanitizeSnapshot(raw: Partial<OperatorStateSnapshot> | null): OperatorStateSnapshot {
  const empty = createEmptyOperatorSnapshot();
  if (!raw || typeof raw !== "object") return empty;
  return {
    faction: sanitizeFaction(raw.faction),
    builtUpgrades:
      raw.builtUpgrades && typeof raw.builtUpgrades === "object"
        ? raw.builtUpgrades
        : {},
    plannedUpgrades:
      raw.plannedUpgrades && typeof raw.plannedUpgrades === "object"
        ? raw.plannedUpgrades
        : {},
    stashCounts:
      raw.stashCounts && typeof raw.stashCounts === "object"
        ? raw.stashCounts
        : {},
    completedTasks:
      raw.completedTasks && typeof raw.completedTasks === "object"
        ? raw.completedTasks
        : {},
    ownedKeys:
      raw.ownedKeys && typeof raw.ownedKeys === "object" ? raw.ownedKeys : {},
    tickedMapMaterials:
      raw.tickedMapMaterials && typeof raw.tickedMapMaterials === "object"
        ? raw.tickedMapMaterials
        : {},
    customPins: Array.isArray(raw.customPins)
      ? raw.customPins
      : empty.customPins,
  };
}

/**
 * Ensures legacy single-operator progress (built hideout, tasks, keys, pins, faction)
 * is migrated once into Operator 1 without overwriting subsequent multi-operator edits.
 */
export function ensureOperatorsInitialized(): void {
  const op1Key = getStateKey("op-1");
  if (!hasStoredKey(op1Key)) {
    const legacySnapshot: OperatorStateSnapshot = {
      faction: sanitizeFaction(safeStorageGet<string>(LEGACY_KEYS.faction, "ALL")),
      builtUpgrades: safeStorageGet<Record<string, boolean>>(LEGACY_KEYS.built, {}),
      plannedUpgrades: safeStorageGet<Record<string, boolean>>(
        LEGACY_KEYS.planned,
        {}
      ),
      stashCounts: safeStorageGet<Record<string, number>>(LEGACY_KEYS.stash, {}),
      completedTasks: safeStorageGet<Record<string, boolean>>(
        LEGACY_KEYS.tasks,
        {}
      ),
      ownedKeys: safeStorageGet<Record<string, boolean>>(LEGACY_KEYS.keys, {}),
      tickedMapMaterials: safeStorageGet<Record<string, boolean>>(
        LEGACY_KEYS.mapTicked,
        {}
      ),
      customPins: safeStorageGet<CustomMapPin[]>(
        LEGACY_KEYS.customPins,
        DEFAULT_SEED_PINS
      ),
    };
    safeStorageSet(op1Key, legacySnapshot);
  }

  for (const id of OPERATOR_SLOT_IDS) {
    const key = getStateKey(id);
    if (!hasStoredKey(key)) {
      safeStorageSet(key, createEmptyOperatorSnapshot());
    }
  }

  const existingProfiles = safeStorageGet<OperatorProfileMeta[] | null>(
    OP_PROFILES_KEY,
    null
  );
  if (!Array.isArray(existingProfiles) || existingProfiles.length !== 3) {
    const seeded: OperatorProfileMeta[] = OPERATOR_SLOT_IDS.map((id) => {
      const snap = loadOperatorSnapshot(id);
      return {
        id,
        name: DEFAULT_NAMES[id],
        faction: snap.faction,
        updatedAt: Date.now(),
      };
    });
    safeStorageSet(OP_PROFILES_KEY, seeded);
  }
}

export function loadActiveOperatorId(): OperatorSlotId {
  ensureOperatorsInitialized();
  const saved = safeStorageGet<string>(ACTIVE_OP_KEY, "op-1");
  return saved === "op-2" || saved === "op-3" ? saved : "op-1";
}

export function saveActiveOperatorId(slotId: OperatorSlotId): void {
  safeStorageSet(ACTIVE_OP_KEY, slotId);
}

export function loadOperatorProfiles(): OperatorProfileMeta[] {
  ensureOperatorsInitialized();
  const profiles = safeStorageGet<OperatorProfileMeta[]>(OP_PROFILES_KEY, []);
  return OPERATOR_SLOT_IDS.map((id) => {
    const match = profiles.find((p) => p.id === id);
    const snap = loadOperatorSnapshot(id);
    return {
      id,
      name: match?.name?.trim() || DEFAULT_NAMES[id],
      faction: snap.faction,
      updatedAt: match?.updatedAt || Date.now(),
    };
  });
}

export function saveOperatorProfiles(profiles: OperatorProfileMeta[]): void {
  safeStorageSet(OP_PROFILES_KEY, profiles);
}

export function loadOperatorSnapshot(
  slotId: OperatorSlotId
): OperatorStateSnapshot {
  const raw = safeStorageGet<Partial<OperatorStateSnapshot> | null>(
    getStateKey(slotId),
    null
  );
  return sanitizeSnapshot(raw);
}

export function saveOperatorSnapshot(
  slotId: OperatorSlotId,
  snapshot: OperatorStateSnapshot
): void {
  safeStorageSet(getStateKey(slotId), snapshot);
}
