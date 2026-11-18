import {
  BASES_05,
  BLUE_CRATES_05,
  CHEMICAL_AREAS_05,
  COPS_05,
  DISASSEMBLY_SPAWNS_05,
  LZS_05,
  MAJOR_POIS_05,
  SUB_POIS_05,
  type RawPoi05,
} from "./mapData05";

/**
 * ============================================================================
 * OFFICIAL GRAY ZONE WARFARE (UPDATE 0.5: ROGUE OPS) LAMANG ISLAND TILE LAYER
 * Served via local Express tile proxy (/api/map/tiles/{z}/{x}/{y}.png ->
 * https://cdn.gzwtacmap.com/0.5/lamang/{z}/{x}/{y}.png) in EPSG:3857 meters.
 * Coordinate extent: [0, 0] to [14000, 8000] (100m = 1 in-game Grid Square).
 * ============================================================================
 */
export const LAMANG_TILE_URL = "/api/map/tiles/{z}/{x}/{y}.png";
export const LAMANG_DIRECT_TILE_URL = "https://cdn.gzwtacmap.com/0.5/lamang/{z}/{x}/{y}.png";

export const MAP_EXTENT = {
  minX: 0,
  minY: 0,
  maxX: 14000,
  maxY: 8000,
};

export function formatGridSquare(x: number, y: number): string {
  const gx = Math.max(100, Math.min(240, Math.floor(x / 100) + 100));
  const gy = Math.max(100, Math.min(180, Math.floor(y / 100) + 100));
  return `${gx} ${gy}`;
}

export function parseGridInputToMeters(
  raw: string
): { grid: string; x: number; y: number } | null {
  const m = raw
    .trim()
    .match(/^(1[0-9]{2}|2[0-3][0-9])\s*[,\s/]+\s*(1[0-7][0-9])$/);
  if (!m) return null;
  const gx = Number(m[1]);
  const gy = Number(m[2]);
  if (gx < 100 || gx > 240 || gy < 100 || gy > 180) return null;
  return {
    grid: `${gx} ${gy}`,
    x: (gx - 100) * 100 + 50,
    y: (gy - 100) * 100 + 50,
  };
}

export type PoiKind = RawPoi05["kind"];

export interface LamangPoi extends RawPoi05 {
  tags: string[];
}

export type MapLayerKey =
  | "blueCrates"
  | "pcSpawns"
  | "chemicalAreas"
  | "disassemblySpawns"
  | "lockedDoors"
  | "tickedSpawns"
  | "apiLoot"
  | "customPins"
  | "poiLabels"
  | "subLocations"
  | "copsAndLzs";

export interface CustomMapPin {
  id: string;
  x: number;
  y: number;
  layer: "blueCrates" | "pcSpawns" | "customPins";
  label: string;
  materialId: string;
  createdAt?: number;
}

export type FactionId = "ALL" | "LRI" | "MSS" | "CSI";

export interface FactionInfo {
  id: Exclude<FactionId, "ALL">;
  short: "LRI" | "MSS" | "CSI";
  name: string;
  baseId: string;
  baseName: string;
  starterTown: "Pha Lang" | "Nam Thaven" | "Kiu Vongsa";
  color: string;
  x: number;
  y: number;
}

export const FACTIONS: Record<Exclude<FactionId, "ALL">, FactionInfo> = {
  LRI: {
    id: "LRI",
    short: "LRI",
    name: "Lamang Recovery Initiative",
    baseId: "base-lri",
    baseName: "LRI Main Base",
    starterTown: "Pha Lang",
    color: "#38bdf8",
    x: 10772,
    y: 7162,
  },
  MSS: {
    id: "MSS",
    short: "MSS",
    name: "Mithras Security Systems",
    baseId: "base-mss",
    baseName: "MSS Main Base",
    starterTown: "Nam Thaven",
    color: "#e5a93c",
    x: 7268,
    y: 813,
  },
  CSI: {
    id: "CSI",
    short: "CSI",
    name: "Crimson Shield International",
    baseId: "base-csi",
    baseName: "CSI Main Base",
    starterTown: "Kiu Vongsa",
    color: "#f87171",
    x: 3393,
    y: 7006,
  },
};

export const STARTER_TOWNS = ["Pha Lang", "Nam Thaven", "Kiu Vongsa"] as const;

export function doesTaskBelongToFaction(
  taskFaction: string | undefined,
  taskAreas: string[],
  selectedFaction: FactionId
): boolean {
  if (selectedFaction === "ALL") return true;
  const active = FACTIONS[selectedFaction];

  if (taskFaction && taskFaction.trim()) {
    const fLower = taskFaction.toLowerCase();
    const mentionsLri = /\blri\b|lamang\s*recovery/i.test(fLower);
    const mentionsMss = /\bmss\b|mithras/i.test(fLower);
    const mentionsCsi = /\bcsi\b|crimson\s*shield/i.test(fLower);
    if (mentionsLri || mentionsMss || mentionsCsi) {
      if (selectedFaction === "LRI" && !mentionsLri) return false;
      if (selectedFaction === "MSS" && !mentionsMss) return false;
      if (selectedFaction === "CSI" && !mentionsCsi) return false;
    }
  }

  // If task areas exclusively point to rival starter town(s) (excluding Pha Lang Airfield), hide from active faction list
  const starterMatches = taskAreas.filter((a) =>
    (STARTER_TOWNS as readonly string[]).includes(a)
  );
  if (
    starterMatches.length > 0 &&
    !starterMatches.includes(active.starterTown) &&
    starterMatches.length === taskAreas.length
  ) {
    return false;
  }

  return true;
}

const REGION_LOOT_TAGS: Record<string, string[]> = {
  "Northern Reach": [
    "northern reach",
    "military",
    "research",
    "server cpu",
    "server",
    "military software",
    "signal generator",
    "laser tube",
    "hepa",
    "oscilloscope",
    "circuit",
    "stainless",
    "chemicals",
    "pc",
    "electrical",
    "microscope",
    "flask",
    "pipette",
    "complex glass",
  ],
  "Lakevale Sanctuary": [
    "lakevale",
    "sanctuary",
    "asylum",
    "lab",
    "glassware",
    "flask",
    "pipette",
    "microscope",
    "complex glass",
    "vapor lamp",
    "crystal prism",
    "chemicals",
    "hepa",
    "refrigerant",
    "zinc electrode",
  ],
  "RLSL-1 Radio Observatory": [
    "rlsl",
    "observatory",
    "radio",
    "radar",
    "signal generator",
    "oscilloscope",
    "laser tube",
    "server cpu",
    "military software",
    "civilian software",
    "circuit",
    "motherboard",
    "graphics card",
    "cpu",
    "ram",
    "power supply",
    "pc",
    "zinc electrode",
  ],
  "Ground Zero": [
    "ground zero",
    "exclusion",
    "hepa",
    "chemicals",
    "server cpu",
    "military software",
    "crystal prism",
  ],
  "Kiu Vongsa": [
    "starter",
    "town",
    "blue_crate",
    "wood",
    "plastics",
    "fabrics",
    "glass",
    "silicone",
    "toolset",
    "motor oil",
    "construction",
    "civilian software",
  ],
  "Hunter's Paradise": [
    "shooting",
    "mechanical",
    "tools",
    "toolset",
    "tooling coolant",
    "cnc",
    "blue_crate",
    "steel",
    "copper",
    "burner head",
    "motor oil",
    "dynamo",
  ],
  "Midnight Sapphire": [
    "hotel",
    "villa",
    "pc",
    "motherboard",
    "graphics card",
    "cpu",
    "ram",
    "power supply",
    "pc fan",
    "civilian software",
    "electronics",
    "electrical",
    "glassware",
    "vapor lamp",
    "crystal prism",
    "circuit",
    "refrigerant",
    "hepa",
  ],
  "Pha Lang": [
    "starter",
    "town",
    "blue_crate",
    "plastics",
    "wood",
    "fabrics",
    "glass",
    "silicone",
    "plumbing",
    "soldering",
    "multimeter",
    "civilian software",
  ],
  "Pha Lang Airfield": [
    "airfield",
    "hangar",
    "mechanical",
    "steel",
    "stainless",
    "copper",
    "dynamo",
    "motor oil",
    "water pump",
    "analog indicator",
    "fine metal mesh",
    "blue_crate",
    "tools",
    "tooling coolant",
  ],
  Sawmill: [
    "sawmill",
    "lumber",
    "wood",
    "steel",
    "stainless",
    "construction",
    "blue_crate",
    "mechanical",
    "tools",
    "toolset",
    "cnc",
    "burner head",
    "copper",
    "fine metal mesh",
  ],
  "Fort Narith": [
    "military",
    "fort",
    "military software",
    "server cpu",
    "signal generator",
    "oscilloscope",
    "laser tube",
    "pc",
    "electronics",
    "electrical",
    "steel",
    "stainless",
    "circuit",
    "dynamo",
    "hepa",
    "analog indicator",
    "burner head",
  ],
  "YBL-1 Bunker": [
    "bunker",
    "military",
    "electronics",
    "pc",
    "motherboard",
    "power supply",
    "pc fan",
    "ram",
    "cpu",
    "electrical",
    "server",
    "circuit",
    "dynamo",
    "signal generator",
    "soldering",
    "multimeter",
    "analog indicator",
    "zinc electrode",
  ],
  "Nam Thaven": [
    "starter",
    "town",
    "blue_crate",
    "wood",
    "plastics",
    "plumbing",
    "fabrics",
    "glass",
    "silicone",
    "motor oil",
    "water pump",
    "civilian software",
  ],
  "Ban Pa": [
    "village",
    "dock",
    "clinic",
    "glassware",
    "glass",
    "flask",
    "pipette",
    "microscope",
    "complex glass",
    "chemicals",
    "wood",
    "blue_crate",
    "plumbing",
    "water pump",
    "refrigerant",
    "fabrics",
  ],
  "Tiger Bay": [
    "mall",
    "unlra",
    "pc",
    "motherboard",
    "graphics card",
    "cpu",
    "server cpu",
    "ram",
    "power supply",
    "pc fan",
    "civilian software",
    "electronics",
    "electrical",
    "glassware",
    "glass",
    "flask",
    "pipette",
    "microscope",
    "construction",
    "blue_crate",
    "circuit",
    "refrigerant",
    "hepa",
    "oscilloscope",
    "cement",
  ],
  "Blue Lagoon": [
    "resort",
    "warehouse",
    "electronics",
    "plastics",
    "plumbing",
    "water pump",
    "refrigerant",
    "copper",
    "burner head",
    "silicone",
    "blue_crate",
    "multimeter",
    "soldering",
  ],
};

function buildTagsForSub(poi: RawPoi05): string[] {
  const n = poi.name.toLowerCase();
  const p = (poi.parentRegion || "").toLowerCase();
  const tags: string[] = [n];
  if (p) tags.push(p);

  if (/hospital|clinic|decontamination|medical|evac/.test(n)) {
    tags.push("hepa", "microscope", "flask", "pipette", "complex glass", "chemicals", "glass");
  }
  if (/research|laboratory|drug lab/.test(n)) {
    tags.push("chemicals", "flask", "pipette", "microscope", "complex glass", "vapor lamp", "zinc electrode");
  }
  if (/armory|headquarters|offices|radio|telescope|substation|hotel|mall|radar/.test(n)) {
    tags.push(
      "pc",
      "motherboard",
      "graphics card",
      "cpu",
      "server cpu",
      "ram",
      "power supply",
      "circuit",
      "signal generator",
      "oscilloscope",
      "laser tube",
      "civilian software",
      "military software"
    );
  }
  if (/warehouse|lumberyard|depot|construction|cement|hangar|garage|repair/.test(n)) {
    tags.push(
      "blue_crate",
      "steel",
      "stainless",
      "wood",
      "construction",
      "plumbing",
      "mechanical",
      "copper",
      "fine metal mesh",
      "toolset",
      "tooling coolant",
      "cnc",
      "motor oil",
      "dynamo",
      "burner head"
    );
  }
  return tags;
}

export const LAMANG_POIS: LamangPoi[] = [
  ...BASES_05.map((p) => ({ ...p, tags: ["base", p.name.toLowerCase()] })),
  ...MAJOR_POIS_05.map((p) => ({
    ...p,
    tags: REGION_LOOT_TAGS[p.name] || [p.name.toLowerCase()],
  })),
  ...SUB_POIS_05.map((p) => ({
    ...p,
    tags: buildTagsForSub(p),
  })),
  ...COPS_05.map((p) => ({ ...p, tags: ["cop"] })),
  ...LZS_05.map((p) => ({ ...p, tags: ["lz"] })),
];

export { BLUE_CRATES_05, DISASSEMBLY_SPAWNS_05, CHEMICAL_AREAS_05 };

/**
 * Exact Update 0.5 PC Part & Tech Spawn anchors (verified EPSG:3857 coordinates)
 * supplemented with custom user-dropped pins.
 */
export const DEFAULT_SEED_PINS: CustomMapPin[] = [
  {
    id: "seed-pc-tigerbay",
    x: 9866,
    y: 2987,
    layer: "pcSpawns",
    label: "Tiger Bay Mall & Tech Offices",
    materialId: "motherboard",
  },
  {
    id: "seed-pc-midnight-hotel",
    x: 7144,
    y: 6669,
    layer: "pcSpawns",
    label: "Midnight Sapphire Hotel & Admin",
    materialId: "graphics_card",
  },
  {
    id: "seed-pc-ybl1",
    x: 4319,
    y: 2254,
    layer: "pcSpawns",
    label: "YBL-1 Underground Bunker Server Room",
    materialId: "power_supply",
  },
  {
    id: "seed-pc-narith",
    x: 4315,
    y: 2971,
    layer: "pcSpawns",
    label: "Fort Narith HQ & Comms Room",
    materialId: "military_software",
  },
  {
    id: "seed-pc-rlsl1-hq",
    x: 5073,
    y: 4049,
    layer: "pcSpawns",
    label: "RLSL-1 Observatory Headquarters",
    materialId: "signal_generator",
  },
  {
    id: "seed-pc-rlsl1-dish",
    x: 5154,
    y: 4080,
    layer: "pcSpawns",
    label: "RLSL-1 Telescope Building",
    materialId: "oscilloscope",
  },
  {
    id: "seed-pc-nr-offices",
    x: 7045,
    y: 5285,
    layer: "pcSpawns",
    label: "Northern Reach Offices & Tech",
    materialId: "server_cpu",
  },
  {
    id: "seed-pc-nr-hq",
    x: 6922,
    y: 5252,
    layer: "pcSpawns",
    label: "Northern Reach Headquarters",
    materialId: "military_software",
  },
  {
    id: "seed-pc-siang-radio",
    x: 9301,
    y: 4696,
    layer: "pcSpawns",
    label: "Siang Radio Station",
    materialId: "signal_generator",
  },
  {
    id: "seed-pc-amateur-radio",
    x: 8840,
    y: 2753,
    layer: "pcSpawns",
    label: "Amateur Radio Station",
    materialId: "circuit_board",
  },
  {
    id: "seed-pc-lakevale-sub",
    x: 8283,
    y: 4160,
    layer: "pcSpawns",
    label: "Lakevale Electrical Substation",
    materialId: "electrical_parts",
  },
  {
    id: "seed-pc-lakevale-main",
    x: 8386,
    y: 4249,
    layer: "pcSpawns",
    label: "Lakevale Sanctuary Main Building",
    materialId: "complex_glass_electrode",
  },
];
