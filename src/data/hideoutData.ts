import type { MapLayerKey } from "../config/mapConfig";

export type RoomId = "utility" | "electronics" | "laboratory";

export interface HideoutMaterialDef {
  id: string;
  name: string;
  required: number;
  room: RoomId;
  layerHint: Exclude<MapLayerKey, "tickedSpawns" | "poiLabels" | "subLocations" | "copsAndLzs">;
  spawnNotes: string[];
  description: string;
}

export interface HideoutUpgradeDef {
  id: string;
  room: RoomId;
  module: string;
  level: number;
  name: string;
  benefit: string;
  requirements: { name: string; quantity: number }[];
}

export interface DisassemblyRecipeDef {
  id: string;
  name: string;
  duration: string;
  outcomes: string[];
  sellPrice?: string;
}

export interface HideoutRoomMeta {
  id: RoomId;
  name: string;
  subtitle: string;
  description: string;
}

export const HIDEOUT_ROOMS: Record<RoomId, HideoutRoomMeta> = {
  utility: {
    id: "utility",
    name: "Utility Room",
    subtitle: "Power & Infrastructure",
    description:
      "Core power generation and infrastructure routing supporting Electronics Workshop and Laboratory operations.",
  },
  electronics: {
    id: "electronics",
    name: "Electronics Workshop",
    subtitle: "Signal Intel, Compute & Fabrication",
    description:
      "Compute hardware, mechanical CNC tooling, micro-electronics assembly, RF sensors, and specialized storage.",
  },
  laboratory: {
    id: "laboratory",
    name: "Laboratory",
    subtitle: "Analysis, Extraction & Bio-Containment",
    description:
      "Analytical instrumentation, extraction & reaction vessels, filtration, heat control, glassware, and lab safety.",
  },
};

/**
 * Complete canonical 36 Hideout Modules from Gray Zone Warfare 0.5 (Utility Room, Electronics Workshop, Laboratory).
 * Enriched automatically by live gzw-data.dev API sync.
 */
export const CANONICAL_HIDEOUT_UPGRADES: HideoutUpgradeDef[] = [
  // === UTILITY ROOM (2) ===
  {
    id: "utility-room-generator-level-1",
    room: "utility",
    module: "Generator",
    level: 1,
    name: "Generator Level 1 (Utility Room)",
    benefit: "+ 9 Available Power",
    requirements: [
      { name: "Steel", quantity: 1 },
      { name: "Mechanical Parts", quantity: 1 },
      { name: "Motor Oil", quantity: 1 },
      { name: "Dynamo", quantity: 1 },
    ],
  },
  {
    id: "utility-room-generator-level-2",
    room: "utility",
    module: "Generator",
    level: 2,
    name: "Generator Level 2 (Utility Room)",
    benefit: "+ 9 Available Power",
    requirements: [
      { name: "Steel", quantity: 2 },
      { name: "Mechanical Parts", quantity: 2 },
      { name: "Motor Oil", quantity: 1 },
      { name: "Dynamo", quantity: 1 },
      { name: "Plumbing Parts", quantity: 1 },
      { name: "Electrical Parts", quantity: 1 },
    ],
  },

  // === ELECTRONICS WORKSHOP (15) ===
  {
    id: "electronics-workshop-hardware-level-1",
    room: "electronics",
    module: "Hardware",
    level: 1,
    name: "Hardware Level 1 (Electronics Workshop)",
    benefit: "+ 2 Compute Capacity",
    requirements: [
      { name: "Motherboard", quantity: 1 },
      { name: "Graphics Card", quantity: 1 },
      { name: "CPU", quantity: 1 },
      { name: "PC Fan", quantity: 1 },
      { name: "RAM", quantity: 1 },
      { name: "Power Supply", quantity: 1 },
    ],
  },
  {
    id: "electronics-workshop-hardware-level-2",
    room: "electronics",
    module: "Hardware",
    level: 2,
    name: "Hardware Level 2 (Electronics Workshop)",
    benefit: "+ 2 Compute Capacity",
    requirements: [
      { name: "Motherboard", quantity: 1 },
      { name: "Graphics Card", quantity: 1 },
      { name: "CPU", quantity: 1 },
      { name: "Plumbing Parts", quantity: 2 },
      { name: "RAM", quantity: 3 },
      { name: "Power Supply", quantity: 1 },
    ],
  },
  {
    id: "electronics-workshop-hardware-level-3",
    room: "electronics",
    module: "Hardware",
    level: 3,
    name: "Hardware Level 3 (Electronics Workshop)",
    benefit: "+ 2 Compute Capacity",
    requirements: [
      { name: "Motherboard", quantity: 1 },
      { name: "Server CPU", quantity: 1 },
      { name: "Electrical Parts", quantity: 5 },
      { name: "RAM", quantity: 4 },
      { name: "Power Supply", quantity: 1 },
      { name: "Dollars", quantity: 45000 },
    ],
  },
  {
    id: "electronics-workshop-machine-tools-level-1",
    room: "electronics",
    module: "Machine Tools",
    level: 1,
    name: "Machine Tools Level 1 (Electronics Workshop)",
    benefit: "+ 1 Mechanical Engineering",
    requirements: [
      { name: "Wood", quantity: 1 },
      { name: "Steel", quantity: 1 },
      { name: "Toolset", quantity: 1 },
    ],
  },
  {
    id: "electronics-workshop-machine-tools-level-2",
    room: "electronics",
    module: "Machine Tools",
    level: 2,
    name: "Machine Tools Level 2 (Electronics Workshop)",
    benefit: "+ 2 Mechanical Engineering",
    requirements: [
      { name: "Steel", quantity: 3 },
      { name: "Mechanical Parts", quantity: 2 },
      { name: "Electrical Parts", quantity: 1 },
      { name: "Tooling Coolant", quantity: 1 },
      { name: "CNC Drill Bits", quantity: 1 },
    ],
  },
  {
    id: "electronics-workshop-micro-electronics-level-1",
    room: "electronics",
    module: "Micro Electronics",
    level: 1,
    name: "Micro Electronics Level 1 (Electronics Workshop)",
    benefit: "+ 1 Electronics Capability",
    requirements: [
      { name: "Soldering Iron", quantity: 1 },
      { name: "Multimeter", quantity: 1 },
      { name: "Toolset", quantity: 1 },
      { name: "Power Supply", quantity: 1 },
      { name: "Wood", quantity: 1 },
    ],
  },
  {
    id: "electronics-workshop-micro-electronics-level-2",
    room: "electronics",
    module: "Micro Electronics",
    level: 2,
    name: "Micro Electronics Level 2 (Electronics Workshop)",
    benefit: "+ 2 Electronics Capability",
    requirements: [
      { name: "Soldering Iron", quantity: 2 },
      { name: "Multimeter", quantity: 1 },
      { name: "Power Supply", quantity: 1 },
      { name: "Oscilloscope", quantity: 1 },
      { name: "Electrical Parts", quantity: 4 },
    ],
  },
  {
    id: "electronics-workshop-micro-electronics-level-3",
    room: "electronics",
    module: "Micro Electronics",
    level: 3,
    name: "Micro Electronics Level 3 (Electronics Workshop)",
    benefit: "+ 3 Electronics Capability",
    requirements: [
      { name: "Microscope", quantity: 1 },
      { name: "Multimeter", quantity: 1 },
      { name: "Circuit Board", quantity: 2 },
      { name: "Power Supply", quantity: 1 },
      { name: "Oscilloscope", quantity: 1 },
      { name: "Electrical Parts", quantity: 5 },
      { name: "Dollars", quantity: 35000 },
    ],
  },
  {
    id: "electronics-workshop-rf-sensors-level-1",
    room: "electronics",
    module: "RF Sensors",
    level: 1,
    name: "RF Sensors Level 1 (Electronics Workshop)",
    benefit: "+ 1 Sensor and RF Processing",
    requirements: [
      { name: "Wood", quantity: 1 },
      { name: "Steel", quantity: 1 },
      { name: "Electrical Parts", quantity: 1 },
      { name: "Signal Generator", quantity: 1 },
      { name: "Soldering Iron", quantity: 1 },
    ],
  },
  {
    id: "electronics-workshop-rf-sensors-level-2",
    room: "electronics",
    module: "RF Sensors",
    level: 2,
    name: "RF Sensors Level 2 (Electronics Workshop)",
    benefit: "+ 2 Sensor and RF Processing",
    requirements: [
      { name: "Steel", quantity: 6 },
      { name: "Mechanical Parts", quantity: 2 },
      { name: "Electrical Parts", quantity: 4 },
      { name: "Signal Generator", quantity: 1 },
      { name: "Oscilloscope", quantity: 1 },
      { name: "Laser Tube", quantity: 1 },
      { name: "Dollars", quantity: 30000 },
    ],
  },
  {
    id: "electronics-workshop-software-level-1",
    room: "electronics",
    module: "Software",
    level: 1,
    name: "Software Level 1 (Electronics Workshop)",
    benefit: "+ 2 Compute Capacity",
    requirements: [
      { name: "Civilian Software", quantity: 3 },
      { name: "Military Software", quantity: 1 },
    ],
  },
  {
    id: "electronics-workshop-software-level-2",
    room: "electronics",
    module: "Software",
    level: 2,
    name: "Software Level 2 (Electronics Workshop)",
    benefit: "+ 2 Compute Capacity",
    requirements: [
      { name: "Civilian Software", quantity: 6 },
      { name: "Military Software", quantity: 2 },
      { name: "Graphics Card", quantity: 1 },
    ],
  },
  {
    id: "electronics-workshop-storage-equipment-level-1",
    room: "electronics",
    module: "Storage Equipment",
    level: 1,
    name: "Storage Equipment Level 1 (Electronics Workshop)",
    benefit: "+ 2 Storage Capacity",
    requirements: [
      { name: "Wood", quantity: 1 },
      { name: "Mechanical Parts", quantity: 1 },
    ],
  },
  {
    id: "electronics-workshop-storage-equipment-level-2",
    room: "electronics",
    module: "Storage Equipment",
    level: 2,
    name: "Storage Equipment Level 2 (Electronics Workshop)",
    benefit: "+ 2 Storage Capacity",
    requirements: [
      { name: "Steel", quantity: 9 },
      { name: "Mechanical Parts", quantity: 3 },
    ],
  },
  {
    id: "electronics-workshop-storage-equipment-level-3",
    room: "electronics",
    module: "Storage Equipment",
    level: 3,
    name: "Storage Equipment Level 3 (Electronics Workshop)",
    benefit: "+ 2 Storage Capacity",
    requirements: [
      { name: "Steel", quantity: 12 },
      { name: "Mechanical Parts", quantity: 6 },
      { name: "Stainless Steel Sheet", quantity: 4 },
      { name: "Dollars", quantity: 30000 },
    ],
  },

  // === LABORATORY (19) ===
  {
    id: "laboratory-analysis-level-1",
    room: "laboratory",
    module: "Analysis",
    level: 1,
    name: "Analysis Level 1 (Laboratory)",
    benefit: "+ 3 Analysis & Precision",
    requirements: [
      { name: "Plastics", quantity: 2 },
      { name: "Electrical Parts", quantity: 1 },
      { name: "Circuit Board", quantity: 1 },
      { name: "Complex Glass Electrode", quantity: 1 },
    ],
  },
  {
    id: "laboratory-analysis-level-2",
    room: "laboratory",
    module: "Analysis",
    level: 2,
    name: "Analysis Level 2 (Laboratory)",
    benefit: "+ 3 Analysis & Precision",
    requirements: [
      { name: "Plastics", quantity: 2 },
      { name: "Electrical Parts", quantity: 4 },
      { name: "Circuit Board", quantity: 3 },
      { name: "Mechanical Parts", quantity: 2 },
      { name: "Vapor Lamp", quantity: 1 },
      { name: "Crystal Prism", quantity: 1 },
      { name: "Dollars", quantity: 35000 },
    ],
  },
  {
    id: "laboratory-extraction-vessel-level-1",
    room: "laboratory",
    module: "Extraction Vessel",
    level: 1,
    name: "Extraction Vessel Level 1 (Laboratory)",
    benefit: "Adds Extraction & Reaction",
    requirements: [
      { name: "Steel", quantity: 1 },
      { name: "Copper", quantity: 1 },
      { name: "Plumbing Parts", quantity: 1 },
      { name: "Analog Indicator", quantity: 1 },
    ],
  },
  {
    id: "laboratory-extraction-vessel-level-2",
    room: "laboratory",
    module: "Extraction Vessel",
    level: 2,
    name: "Extraction Vessel Level 2 (Laboratory)",
    benefit: "Adds Extraction & Reaction",
    requirements: [
      { name: "Copper", quantity: 5 },
      { name: "Plumbing Parts", quantity: 1 },
      { name: "Analog Indicator", quantity: 1 },
      { name: "Water Pump", quantity: 1 },
    ],
  },
  {
    id: "laboratory-filtration-level-1",
    room: "laboratory",
    module: "Filtration",
    level: 1,
    name: "Filtration Level 1 (Laboratory)",
    benefit: "+ 1 Filtration & Processing",
    requirements: [
      { name: "Wood", quantity: 2 },
      { name: "Fabrics", quantity: 4 },
    ],
  },
  {
    id: "laboratory-filtration-level-2",
    room: "laboratory",
    module: "Filtration",
    level: 2,
    name: "Filtration Level 2 (Laboratory)",
    benefit: "+ 1 Filtration & Processing",
    requirements: [
      { name: "Steel", quantity: 3 },
      { name: "Fine Metal Mesh", quantity: 3 },
    ],
  },
  {
    id: "laboratory-glassware-level-1",
    room: "laboratory",
    module: "Glassware",
    level: 1,
    name: "Glassware Level 1 (Laboratory)",
    benefit: "Adds Analysis & Precision",
    requirements: [
      { name: "Glass", quantity: 1 },
      { name: "Plastics", quantity: 1 },
      { name: "Laboratory Flask", quantity: 1 },
    ],
  },
  {
    id: "laboratory-glassware-level-2",
    room: "laboratory",
    module: "Glassware",
    level: 2,
    name: "Glassware Level 2 (Laboratory)",
    benefit: "Adds Analysis & Precision",
    requirements: [
      { name: "Glass", quantity: 2 },
      { name: "Plastics", quantity: 1 },
      { name: "Laboratory Flask", quantity: 1 },
      { name: "Mechanical Pipette", quantity: 1 },
    ],
  },
  {
    id: "laboratory-heat-source-level-1",
    room: "laboratory",
    module: "Heat Source",
    level: 1,
    name: "Heat Source Level 1 (Laboratory)",
    benefit: "Adds Heat control",
    requirements: [
      { name: "Steel", quantity: 3 },
      { name: "Construction Material", quantity: 2 },
      { name: "Wood", quantity: 1 },
    ],
  },
  {
    id: "laboratory-heat-source-level-2",
    room: "laboratory",
    module: "Heat Source",
    level: 2,
    name: "Heat Source Level 2 (Laboratory)",
    benefit: "Adds Heat control",
    requirements: [
      { name: "Steel", quantity: 4 },
      { name: "Plumbing Parts", quantity: 2 },
      { name: "Construction Material", quantity: 3 },
      { name: "Burner Head", quantity: 1 },
    ],
  },
  {
    id: "laboratory-heat-source-level-3",
    room: "laboratory",
    module: "Heat Source",
    level: 3,
    name: "Heat Source Level 3 (Laboratory)",
    benefit: "+ 2 Heat control",
    requirements: [
      { name: "Steel", quantity: 10 },
      { name: "Plumbing Parts", quantity: 5 },
      { name: "Construction Material", quantity: 5 },
      { name: "Burner Head", quantity: 2 },
      { name: "Mechanical Parts", quantity: 2 },
      { name: "Dollars", quantity: 40000 },
    ],
  },
  {
    id: "laboratory-reaction-vessel-level-1",
    room: "laboratory",
    module: "Reaction Vessel",
    level: 1,
    name: "Reaction Vessel Level 1 (Laboratory)",
    benefit: "Adds Extraction & Reaction",
    requirements: [
      { name: "Plastics", quantity: 2 },
      { name: "Construction Material", quantity: 1 },
      { name: "Silicone Sealant", quantity: 1 },
    ],
  },
  {
    id: "laboratory-reaction-vessel-level-2",
    room: "laboratory",
    module: "Reaction Vessel",
    level: 2,
    name: "Reaction Vessel Level 2 (Laboratory)",
    benefit: "Adds Extraction & Reaction",
    requirements: [
      { name: "Steel", quantity: 4 },
      { name: "Chemicals", quantity: 2 },
      { name: "Zinc Electrode", quantity: 1 },
    ],
  },
  {
    id: "laboratory-reaction-vessel-level-3",
    room: "laboratory",
    module: "Reaction Vessel",
    level: 3,
    name: "Reaction Vessel Level 3 (Laboratory)",
    benefit: "+ 2 Extraction & Reaction",
    requirements: [
      { name: "Steel", quantity: 12 },
      { name: "Stainless Steel Sheet", quantity: 3 },
      { name: "Mechanical Parts", quantity: 6 },
      { name: "Dollars", quantity: 45000 },
    ],
  },
  {
    id: "laboratory-safety-level-1",
    room: "laboratory",
    module: "Safety",
    level: 1,
    name: "Safety Level 1 (Laboratory)",
    benefit: "+ 1 Safety & Containment",
    requirements: [
      { name: "Electrical Parts", quantity: 2 },
      { name: "Plastics", quantity: 2 },
      { name: "PC Fan", quantity: 2 },
    ],
  },
  {
    id: "laboratory-safety-level-2",
    room: "laboratory",
    module: "Safety",
    level: 2,
    name: "Safety Level 2 (Laboratory)",
    benefit: "+ 2 Safety & Containment",
    requirements: [
      { name: "Steel", quantity: 10 },
      { name: "Electrical Parts", quantity: 5 },
      { name: "Plumbing Parts", quantity: 5 },
      { name: "PC Fan", quantity: 3 },
      { name: "HEPA Filter", quantity: 1 },
      { name: "Dollars", quantity: 35000 },
    ],
  },
  {
    id: "laboratory-storage-equipment-level-1",
    room: "laboratory",
    module: "Storage Equipment",
    level: 1,
    name: "Storage Equipment Level 1 (Laboratory)",
    benefit: "+ 2 Storage Capacity",
    requirements: [
      { name: "Steel", quantity: 1 },
      { name: "Electrical Parts", quantity: 1 },
      { name: "Refrigerant", quantity: 1 },
      { name: "Plumbing Parts", quantity: 1 },
    ],
  },
  {
    id: "laboratory-storage-equipment-level-2",
    room: "laboratory",
    module: "Storage Equipment",
    level: 2,
    name: "Storage Equipment Level 2 (Laboratory)",
    benefit: "+ 2 Storage Capacity",
    requirements: [
      { name: "Steel", quantity: 3 },
      { name: "Glass", quantity: 3 },
      { name: "Plumbing Parts", quantity: 2 },
      { name: "Electrical Parts", quantity: 1 },
      { name: "Refrigerant", quantity: 1 },
    ],
  },
  {
    id: "laboratory-storage-equipment-level-3",
    room: "laboratory",
    module: "Storage Equipment",
    level: 3,
    name: "Storage Equipment Level 3 (Laboratory)",
    benefit: "+ 2 Storage Capacity",
    requirements: [
      { name: "Steel", quantity: 6 },
      { name: "Glass", quantity: 5 },
      { name: "Plumbing Parts", quantity: 2 },
      { name: "Refrigerant", quantity: 2 },
      { name: "Electrical Parts", quantity: 2 },
      { name: "Circuit Board", quantity: 2 },
      { name: "Dollars", quantity: 45000 },
    ],
  },
];

/**
 * Spawn & container intel hints strictly for the materials required across the 36 Hideout upgrades.
 */
export const MATERIAL_INTEL_HINTS: Record<
  string,
  {
    layerHint: Exclude<MapLayerKey, "tickedSpawns" | "poiLabels" | "subLocations" | "copsAndLzs">;
    spawnNotes: string[];
    description: string;
  }
> = {
  plastics: {
    layerHint: "blueCrates",
    spawnNotes: [
      "Blue-Planked Building Material Crates",
      "Blue Lagoon Warehouses & Maintenance",
      "Ban Pa Village Sheds",
      "Kiu Vongsa & Pha Lang Hardware",
    ],
    description: "Molded polymer stock used across Analysis, Glassware, Reaction Vessel, and Safety upgrades.",
  },
  steel: {
    layerHint: "blueCrates",
    spawnNotes: [
      "Blue-Planked Building Material Crates",
      "Sawmill Yard & Warehouse",
      "Pha Lang Airfield Hangars",
      "Fort Narith Motor Pool",
    ],
    description: "Structural steel plates and bars required across Generator, Storage, Heat Source, and RF Sensors.",
  },
  wood: {
    layerHint: "blueCrates",
    spawnNotes: [
      "Sawmill Lumberyard Stacks",
      "Blue-Planked Building Material Crates",
      "Pha Lang & Kiu Vongsa Lumberyards",
    ],
    description: "Treated timber planks for Level 1 workbenches, filtration frames, and starter storage racks.",
  },
  "plumbing parts": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Blue-Planked Building Material Crates",
      "Ban Pa Dockyard & Utility Closets",
      "Blue Lagoon Maintenance Sheds",
      "Nam Thaven & Pha Lang Workshops",
    ],
    description: "Valves, brass couplings, and pipes for Extraction Vessels, Heat Sources, and Cold Storage.",
  },
  "mechanical parts": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Hunter's Paradise Garages & Shooting Lines",
      "Pha Lang Airfield Hangars",
      "Toolboxes & Blue-Planked Crates",
    ],
    description: "Precision gears, actuators, and bearings used in Generator, Machine Tools, and Storage.",
  },
  "construction material": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Blue-Planked Building Material Crates",
      "Cement Factory & Construction Site",
      "Tiger Bay Trade Depot",
      "Sawmill Warehouse",
    ],
    description: "Heavy masonry anchors, fasteners, and composite sheeting for Heat Sources and Reaction Vessels.",
  },
  "stainless steel sheet": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Cement Factory & Construction Site",
      "Fort Narith Hangars & Motor Pool",
      "Tiger Bay Trade Depot",
      "Northern Reach Military Camp",
    ],
    description: "Corrosion-resistant sheet metal required for Level 3 Storage Equipment and Reaction Vessel L3.",
  },
  "electrical parts": {
    layerHint: "pcSpawns",
    spawnNotes: [
      "PC Part Spawns & Electronics Containers",
      "YBL-1 Bunker Control Rooms",
      "Tiger Bay Central Mall Tech Shops",
      "Midnight Sapphire Admin Wing",
    ],
    description: "Capacitors, relays, and wiring harnesses for Micro Electronics, Analysis, Safety, and Generator L2.",
  },
  "circuit board": {
    layerHint: "pcSpawns",
    spawnNotes: [
      "Tiger Bay Central Mall Tech Shops",
      "RLSL-1 Radio Observatory",
      "Midnight Sapphire Admin Wing",
      "YBL-1 Bunker Server Room",
    ],
    description: "Printed circuit boards salvaged from high-tier electronics spawns.",
  },
  motherboard: {
    layerHint: "pcSpawns",
    spawnNotes: [
      "PC Towers — Tiger Bay Tech Mall",
      "Midnight Sapphire Hotel Admin",
      "YBL-1 Server Room",
      "RLSL-1 Underground Bunker",
    ],
    description: "Desktop & workstation motherboard required for Hardware Levels 1, 2, and 3.",
  },
  "graphics card": {
    layerHint: "pcSpawns",
    spawnNotes: [
      "PC Towers — Tiger Bay Tech Mall",
      "Midnight Sapphire Hotel & Villas",
      "RLSL-1 Underground Bunker",
    ],
    description: "High-demand GPU component needed for Hardware L1/L2 and Software L2.",
  },
  cpu: {
    layerHint: "pcSpawns",
    spawnNotes: [
      "PC Towers — Tiger Bay Tech Mall",
      "YBL-1 Server Room",
      "Midnight Sapphire Admin",
    ],
    description: "Standard processor harvested from office PCs for Hardware Levels 1 and 2.",
  },
  "server cpu": {
    layerHint: "pcSpawns",
    spawnNotes: [
      "Northern Reach Military Camp",
      "RLSL-1 Radio Observatory",
      "Fort Narith HQ Comms Room",
      "Tiger Bay Tech Mall",
    ],
    description: "Enterprise multi-core processor required for Hardware Level 3.",
  },
  ram: {
    layerHint: "pcSpawns",
    spawnNotes: [
      "PC Towers — Tiger Bay Tech Mall",
      "Midnight Sapphire Admin Wing",
      "YBL-1 Server Room",
    ],
    description: "Memory DIMM modules needed across Hardware Levels 1, 2, and 3.",
  },
  "power supply": {
    layerHint: "pcSpawns",
    spawnNotes: [
      "PC Towers — YBL-1 Server Room",
      "Tiger Bay Tech Mall",
      "Midnight Sapphire Admin",
    ],
    description: "ATX power supply unit required across Hardware and Micro Electronics benches.",
  },
  "pc fan": {
    layerHint: "pcSpawns",
    spawnNotes: [
      "PC Towers — Tiger Bay Tech Mall",
      "Midnight Sapphire Villas",
      "YBL-1 Bunker",
    ],
    description: "Cooling fan salvaged from PC cases; used in Hardware L1 and Laboratory Safety L1–L2.",
  },
  "civilian software": {
    layerHint: "pcSpawns",
    spawnNotes: [
      "Office Desks — Tiger Bay Tech Mall",
      "Midnight Sapphire Hotel Admin",
      "UNLRA Offices (Kiu Vongsa / Nam Thaven / Pha Lang)",
    ],
    description: "Commercial software media required for Electronics Workshop Software Levels 1 and 2.",
  },
  "military software": {
    layerHint: "pcSpawns",
    spawnNotes: [
      "Fort Narith HQ & Comms Room",
      "Northern Reach Armory & Camp",
      "RLSL-1 Radio Observatory",
    ],
    description: "Encrypted tactical firmware required for Electronics Workshop Software Levels 1 and 2.",
  },
  "signal generator": {
    layerHint: "pcSpawns",
    spawnNotes: [
      "RLSL-1 Radio Observatory",
      "Fort Narith HQ Comms Room",
      "Siang Radio Station",
      "Northern Reach",
    ],
    description: "Precision RF waveform generator for RF Sensors Levels 1 and 2.",
  },
  oscilloscope: {
    layerHint: "pcSpawns",
    spawnNotes: [
      "RLSL-1 Radio Observatory",
      "Fort Narith HQ Comms Room",
      "Tiger Bay Tech Mall",
      "Siang Radio Station",
    ],
    description: "Benchtop diagnostic oscilloscope for Micro Electronics L2/L3 and RF Sensors L2.",
  },
  "laser tube": {
    layerHint: "pcSpawns",
    spawnNotes: [
      "RLSL-1 Radio Observatory",
      "Northern Reach Military Research",
      "Fort Narith HQ",
    ],
    description: "Optical coherent emitter required for RF Sensors Level 2.",
  },
  "soldering iron": {
    layerHint: "pcSpawns",
    spawnNotes: [
      "Pha Lang & Nam Thaven Workshops",
      "Blue Lagoon Maintenance",
      "YBL-1 Maintenance Corridors",
    ],
    description: "Precision soldering station for Micro Electronics L1/L2 and RF Sensors L1.",
  },
  multimeter: {
    layerHint: "pcSpawns",
    spawnNotes: [
      "Blue Lagoon Maintenance",
      "Toto Hardware & Toolboxes",
      "YBL-1 Bunker Control",
    ],
    description: "Digital multimeter used across all Micro Electronics tiers.",
  },
  microscope: {
    layerHint: "apiLoot",
    spawnNotes: [
      "Lakevale Sanctuary Labs",
      "Northern Reach Field Hospital",
      "Tiger Bay UNLRA Med Tent",
      "Ban Pa Clinic",
    ],
    description: "Optical inspection microscope required for Micro Electronics Level 3.",
  },
  "laboratory flask": {
    layerHint: "apiLoot",
    spawnNotes: [
      "Ban Pa Clinic",
      "Lakevale Sanctuary Labs",
      "Tiger Bay UNLRA Medical Tent",
      "Fort Narith Infirmary",
    ],
    description: "Borosilicate glassware required for Laboratory Glassware Levels 1 and 2.",
  },
  "mechanical pipette": {
    layerHint: "apiLoot",
    spawnNotes: [
      "Lakevale Sanctuary Labs",
      "Ban Pa Clinic",
      "Tiger Bay UNLRA Med Tent",
    ],
    description: "Micropipette instrument required for Laboratory Glassware Level 2.",
  },
  "complex glass electrode": {
    layerHint: "apiLoot",
    spawnNotes: [
      "Lakevale Sanctuary Labs",
      "Ban Pa Clinic",
      "Tiger Bay UNLRA Quarantine",
    ],
    description: "pH / ion-selective glass electrode required for Analysis Level 1.",
  },
  "vapor lamp": {
    layerHint: "apiLoot",
    spawnNotes: [
      "Lakevale Sanctuary Asylum",
      "Tiger Bay UNLRA Quarantine",
      "Midnight Sapphire Hotel",
    ],
    description: "Spectral discharge lamp required for Analysis Level 2.",
  },
  "crystal prism": {
    layerHint: "apiLoot",
    spawnNotes: [
      "Lakevale Sanctuary Asylum",
      "Midnight Sapphire Hotel Safes",
      "Ground Zero / Tier 4 Loot",
    ],
    description: "Optical dispersion prism required for Analysis Level 2.",
  },
  "hepa filter": {
    layerHint: "apiLoot",
    spawnNotes: [
      "Northern Reach Field Hospital & Decon",
      "Lakevale Bio-Labs",
      "Tiger Bay UNLRA Quarantine",
      "Fort Narith Hangars",
    ],
    description: "High-efficiency particulate air filter required for Laboratory Safety Level 2.",
  },
  chemicals: {
    layerHint: "apiLoot",
    spawnNotes: [
      "Lakevale Bio-Labs",
      "Ban Pa Clinic",
      "Tiger Bay UNLRA Med Tent",
      "Northern Reach Decon",
    ],
    description: "Industrial laboratory reagents required for Reaction Vessel Level 2.",
  },
  "zinc electrode": {
    layerHint: "apiLoot",
    spawnNotes: [
      "Lakevale Bio-Labs",
      "RLSL-1 Underground Bunker",
      "YBL-1 Bunker",
    ],
    description: "Sacrificial zinc anode/electrode required for Reaction Vessel Level 2.",
  },
  refrigerant: {
    layerHint: "blueCrates",
    spawnNotes: [
      "Blue Lagoon Resort Maintenance",
      "Ban Pa Dockyard",
      "Tiger Bay Mall & UNLRA",
      "Midnight Sapphire Villas",
    ],
    description: "Cooling gas canister required for Laboratory Storage Equipment Levels 1–3.",
  },
  glass: {
    layerHint: "blueCrates",
    spawnNotes: [
      "Ban Pa Clinic & Village",
      "Kiu Vongsa & Pha Lang Shops",
      "Midnight Sapphire Villas",
    ],
    description: "Tempered glass panes used in Laboratory Glassware and Cold Storage.",
  },
  fabrics: {
    layerHint: "blueCrates",
    spawnNotes: [
      "Starter Town Homes (Kiu Vongsa, Pha Lang, Nam Thaven)",
      "Dongphou Hiking Camp",
      "Midnight Sapphire Villas",
    ],
    description: "Filter cloth and woven fabric stock used in Laboratory Filtration Level 1.",
  },
  "fine metal mesh": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Sawmill Warehouse",
      "Pha Lang Airfield Hangars",
      "Cement Factory",
      "Tiger Bay Trade Depot",
    ],
    description: "Woven stainless mesh screens required for Laboratory Filtration Level 2.",
  },
  copper: {
    layerHint: "blueCrates",
    spawnNotes: [
      "Sawmill & Toto Hardware",
      "Pha Lang Airfield",
      "Blue Lagoon Maintenance",
      "Hunter's Paradise",
    ],
    description: "Conductive copper tubing and coils for Extraction Vessel Levels 1 and 2.",
  },
  "analog indicator": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Pha Lang Airfield Hangars",
      "YBL-1 Bunker Generator Room",
      "Fort Narith Hangars",
    ],
    description: "Dial pressure gauge required for Extraction Vessel Levels 1 and 2.",
  },
  "water pump": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Ban Pa Dockyard",
      "Blue Lagoon Maintenance",
      "Pha Lang Airfield",
      "Khamhao Rice Depot",
    ],
    description: "Circulation pump required for Extraction Vessel Level 2.",
  },
  "burner head": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Hunter's Paradise Garages",
      "Sawmill Workshop",
      "Blue Lagoon Kitchens",
      "Fort Narith Motor Pool",
    ],
    description: "High-output gas burner assembly for Heat Source Levels 2 and 3.",
  },
  "silicone sealant": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Kiu Vongsa / Pha Lang / Nam Thaven Hardware",
      "Blue Lagoon Maintenance",
      "Cement Factory",
    ],
    description: "Chemical-resistant sealant cartridge for Reaction Vessel Level 1.",
  },
  dynamo: {
    layerHint: "blueCrates",
    spawnNotes: [
      "Pha Lang Airfield Hangars",
      "Fort Narith Motor Pool",
      "YBL-1 Generator Room",
      "Hunter's Paradise",
    ],
    description: "Alternator/dynamo unit required for Utility Room Generator Levels 1 and 2.",
  },
  "motor oil": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Kiu Vongsa Gas Station",
      "Pha Lang Airfield Hangars",
      "Hunter's Paradise Garages",
      "Nam Thaven & Khamhao Farm",
    ],
    description: "Engine lubricant required for Utility Room Generator Levels 1 and 2.",
  },
  toolset: {
    layerHint: "blueCrates",
    spawnNotes: [
      "Toto Hardware",
      "Sawmill Sheds",
      "Hunter's Paradise Garages",
      "Kiu Vongsa Lumberyard",
    ],
    description: "Mechanics toolset required for Machine Tools L1 and Micro Electronics L1.",
  },
  "tooling coolant": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Hunter's Paradise Workshop",
      "Pha Lang Airfield Hangars",
      "Toto Hardware",
    ],
    description: "CNC cutting fluid required for Machine Tools Level 2.",
  },
  "cnc drill bits": {
    layerHint: "blueCrates",
    spawnNotes: [
      "Sawmill Maintenance",
      "Hunter's Paradise Workshop",
      "Toto Hardware",
    ],
    description: "Carbide milling & drill bit set required for Machine Tools Level 2.",
  },
};

export const FALLBACK_DISASSEMBLY_RECIPES: DisassemblyRecipeDef[] = [
  {
    id: "artillery-ballistic-calculator",
    name: "Artillery Ballistic Calculator",
    duration: "4 hours",
    outcomes: ["LAF Artillery Data Logs", "CPU Card"],
    sellPrice: "$8,000",
  },
  {
    id: "baget-53-31-onboard-computer",
    name: "Baget-53-31 Onboard Computer",
    duration: "6 hours",
    outcomes: ["Flight Data Drive", "Avionics Processor Board"],
    sellPrice: "$12,000",
  },
  {
    id: "chemical-containment-container",
    name: "Chemical Containment Container",
    duration: "8 hours",
    outcomes: ["Biohazard Canister"],
    sellPrice: "$18,000",
  },
  {
    id: "chemical-munitions-container",
    name: "Chemical Munitions Container",
    duration: "8 hours",
    outcomes: ["Sarin Canister"],
    sellPrice: "$12,000",
  },
  {
    id: "counter-ied-jammer-unit",
    name: "Counter IED/Jammer Unit",
    duration: "8 hours",
    outcomes: ["Electronic Warfare Configuration Drive", "Digital Synthesis Engine"],
    sellPrice: "$18,000",
  },
];
