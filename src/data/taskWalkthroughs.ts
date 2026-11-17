export interface CuratedTaskCoord {
  gridX: number;
  gridY: number;
  label: string;
}

export interface CuratedTaskWalkthrough {
  steps: string[];
  equipment?: string[];
  coords?: CuratedTaskCoord[];
  tip?: string;
}

/**
 * Curated Update 0.5 (Rogue Ops) tactical walkthrough intelligence keyed by
 * lowercase task name (or slug id). Supplements live gzw-data.dev task_guides,
 * objectives, keys, and task_items.
 */
export const CURATED_TASK_WALKTHROUGHS: Record<string, CuratedTaskWalkthrough> = {
  "first recon": {
    steps: [
      "Deploy to your faction's starter town outskirts (Kiu Vongsa, Nam Thaven, or Pha Lang) and scout the Convenience Store / Gas Station / Water Tower.",
      "Approach each landmark perimeter until the recon popup triggers—no interaction prompt is required.",
      "Clear local insurgent patrols along the main road before rotating to the next landmark, then debrief with Handshake via FOB or COP.",
    ],
    tip: "Starter towns share faction-mirrored layouts: Gas Station on the highway edge, Convenience Store near center, and Water Tower on high ground.",
  },
  "cache retrieval": {
    steps: [
      "Locate the two military ammo caches inside your starter town: one inside the Warehouse storage compound and one near the Lumberyard / Market sheds.",
      "Ensure you bring 2× GPS Trackers provided in Handshake's briefing message (buy spares from Handshake Lv.1 if lost).",
      "Approach each wooden/olive ammo crate and hold F to plant a GPS Tracker, then exfil safely.",
    ],
    equipment: ["GPS Tracker ×2"],
    tip: "Place trackers in your SafeLock container until you reach the cache so you don't lose them if downed.",
  },
  "meds wanted": {
    steps: [
      "Check the local Pharmacy / Clinic building near the starter town center.",
      "Enter the back dispensary room and search the white metal medical crate / counter for the Meds Supply package (1×2 slot).",
      "Place the item in your SafeLock if space allows and hand it in to Lab Rat.",
    ],
    equipment: ["1×2 Backpack / SafeLock space"],
  },
  "medical detective": {
    steps: [
      "Obtain the Doctor's Office Key (drops from starter town rebels or check the Pharmacy reception counter).",
      "Head to the town Clinic / Doctor's Office, unlock the interior door, and inspect the clipboard/patient files on the desk.",
      "Retrieve the Medical Report folder and turn it in to Lab Rat.",
    ],
    equipment: ["Doctor's Office Key"],
  },
  "leave no man behind": {
    steps: [
      "Move to the demolished roadside building / alley near the town Town Hall / Gas Station where a fallen PMC was reported.",
      "Inspect the PMC body wearing tan tactical gear to recover their Dog Tags / Recon Intel.",
      "Report back to Gunny once confirmed.",
    ],
  },
  "little bird down": {
    steps: [
      "Push out to the open field just outside the starter town boundary where the crashed MH-6 Little Bird helicopter sits.",
      "Watch for patrol guards stationed around the wreckage perimeter, then approach the cockpit to inspect the crash site.",
      "Search the nearby brush/trail if secondary black-box or pilot objectives appear, then debrief with Handshake.",
    ],
  },
  "tools of the trade": {
    steps: [
      "Head to the Garage / Repair Shop compound in your starter town.",
      "Search the workbenches inside the main bay for Artisan's red Mechanic Toolbox.",
      "Pick up the heavy toolbox (takes backpack/rig space) and deliver it to Artisan.",
    ],
    equipment: ["2×2 Backpack space"],
  },
  "lost and found": {
    steps: [
      "Search the town Market / Clinic outskirts for the missing local's last known campsite or Motel room.",
      "Look for the personal keepsake / necklace on the floor or beside the bed and return it to Lab Rat.",
    ],
  },
  "reclamation": {
    steps: [
      "Move to the Motel / Restaurant back office in your starter town.",
      "Retrieve the stolen folder / hard drive from the desk and deliver it back to Handshake.",
    ],
  },
  "secret compassion": {
    steps: [
      "Grab the 3× MREs / Supply Packages from your inventory (or Handshake/Lab Rat mail) before infil.",
      "Visit the three marked civilian drop-off boxes behind houses in the outer residential blocks of your starter town.",
      "Hold F at each cardboard box to leave supplies—avoid waking nearby street patrols.",
    ],
    equipment: ["Supply Packages ×3"],
  },
  "at the mounds of madness": {
    steps: [
      "Travel to the unmarked graveyard / burial mounds on the wooded edge outside your starter town.",
      "Inspect the disturbed shrine/grave marker and scan the surrounding clearing for ritual items or note.",
      "Extract and turn in findings to Lab Rat.",
    ],
  },
  "a single drop": {
    coords: [{ gridX: 181, gridY: 158, label: "Pha Lang Airfield Apron & Hangars" }],
    steps: [
      "Infil at Pha Lang Airfield (nearest LZs: Echo 1 / Echo 2 / Echo 3) and clear LAF sentries along the runway.",
      "Locate the first fuel tanker truck parked along the hangar apron and interact with its tank valve to check fuel levels.",
      "Rotate to the second tanker truck near the fuel depot / runway service road, inspect its tank, and debrief Gunny.",
    ],
    tip: "Approach from the north treeline (Echo 2) to flank the hangar snipers before crossing the open tarmac.",
  },
  "a shot in the dark": {
    coords: [{ gridX: 160, gridY: 168, label: "Hunter's Paradise Main Entrance Gate" }],
    steps: [
      "Infil near Hunter's Paradise (LZ Foxtrot 1 or Charlie 1) and approach the southern Main Entrance guardhouse.",
      "Check the guard booth desk / counter at the entrance gate for the VIP Program Client List.",
      "Decide carefully: turning this in to Banshee completes 'A Shot in the Dark' instead of Handshake's 'Up to Snuff'.",
    ],
  },
  "up to snuff": {
    coords: [{ gridX: 160, gridY: 168, label: "Hunter's Paradise Main Entrance" }],
    steps: [
      "Move to the Hunter's Paradise Main Entrance gatehouse from LZ Foxtrot 1.",
      "Clear the gate guards and pick up the VIP Client List inside the checkpoint booth.",
      "Hand the list to Handshake (or give to Banshee for the alternate path).",
    ],
  },
  "on the range": {
    coords: [{ gridX: 160, gridY: 168, label: "Hunter's Paradise Firing Lanes" }],
    steps: [
      "Eliminate designated enemy combatants inside the Hunter's Paradise shooting range lanes and clubhouse.",
      "Stay behind concrete berm dividers—AI frequently flanks along the covered firing stalls.",
    ],
  },
  "guns & ammo": {
    coords: [{ gridX: 160, gridY: 168, label: "Hunter's Paradise Armory" }],
    steps: [
      "Locate the Hunter's Paradise Armory / Storage building near the firing lanes (check if HP Weapons Storage Key is needed).",
      "Place the GPS Trackers inside the marked weapons & ammunition crates and extract.",
    ],
    equipment: ["GPS Tracker", "HP Weapons Key (optional backup)"],
  },
  "what was left": {
    coords: [{ gridX: 139, gridY: 144, label: "Sawmill Central Office & Sheds" }],
    steps: [
      "Infil near Sawmill via LZ Juliet 1 or Juliet 2 and clear guards around the timber mill.",
      "Check inside the wooden Office / Boss Trailer near the central saw deck for the Sawmill Ledger / Manifest.",
      "Retrieve the document and deliver it to Handshake.",
    ],
  },
  "the negotiator": {
    coords: [{ gridX: 43, gridY: 22, label: "YBL-1 Underground Bunker" }],
    steps: [
      "Wait—deploy to YBL-1 Bunker (Grid 143 122, nearest LZs: Lima 1 / Lima 2 / Lima 3) with a flashlight and weapon-mounted light.",
      "Descend into the subterranean bunker levels via the main blast doors or ventilation shaft.",
      "Locate the Negotiator room (often behind the Generator / Detention wing; YBL-1 Office Key or Dorm/Bedrooms Key helps) and secure the objective.",
    ],
    equipment: ["Flashlight / NVG", "YBL-1 Keys (Generator / Office)"],
    coordsOverride: [{ gridX: 143, gridY: 122, label: "YBL-1 Bunker Entrance" }],
  } as unknown as CuratedTaskWalkthrough,
  "living in burrows": {
    coords: [{ gridX: 143, gridY: 122, label: "YBL-1 Bunker Sub-Levels" }],
    steps: [
      "Infil via LZ Lima 2 near YBL-1 Bunker and clear the surface fence guards.",
      "Enter the main concrete bunker ramp and inspect both upper barracks and lower tunnel generator/water filtration chambers.",
      "Complete the underground sweep and report back to Handshake.",
    ],
    equipment: ["Flashlight", "Extra bandages / splints"],
  },
  "radio silence": {
    coords: [{ gridX: 143, gridY: 129, label: "Fort Narith Airfield & Comms" }],
    steps: [
      "Approach Fort Narith from a perimeter COP or LZ Delta 1 / Delta 3 and watch for LAF patrols with magnified optics.",
      "Infiltrate the Radio / Comms Tower building or Bunker terminal and plant/disable the communications equipment.",
      "Use smoke or hard cover along the perimeter walls while extracting.",
    ],
    equipment: ["Wiretapping / Tracker Device if supplied"],
  },
  "hazardous treasures": {
    coords: [
      { gridX: 143, gridY: 122, label: "YBL-1 Bunker" },
      { gridX: 143, gridY: 129, label: "Fort Narith" },
      { gridX: 198, gridY: 129, label: "Tiger Bay" },
    ],
    steps: [
      "Multi-zone container retrieval: prepare 3× Secure Containers or space in a large backpack.",
      "Recover the hazardous samples from the designated high-tier compounds (check sub-objectives for exact wing).",
      "Bring high-penetration ammo (M855 / 5.45 BP+) for LAF armor.",
    ],
    equipment: ["Armor-piercing ammo", "Large Backpack (3×3+)"],
  },
  "terminal initiative": {
    coords: [
      { gridX: 170, gridY: 167, label: "Midnight Sapphire Hotel" },
      { gridX: 143, gridY: 129, label: "Fort Narith HQ" },
      { gridX: 198, gridY: 129, label: "Tiger Bay UNLRA Mall" },
    ],
    steps: [
      "Late-game high-risk mission requiring precision kills & intel recovery across Tier 3/4 strongholds without dying between stages.",
      "Clear sectors methodically from outer approaches, carry extra surgical kits and painkillers, and hand over all collected containers at base.",
    ],
    equipment: ["Tier 3+ Ballistic Plate", "Surgical Kit & Painkillers", "AP Ammo"],
  },
  "wing clipper": {
    coords: [{ gridX: 143, gridY: 129, label: "Fort Narith Airfield Hangars" }],
    steps: [
      "Deploy to Fort Narith (LZ Delta 1 or South Gate) and clear the runway hangars of LAF guards.",
      "Plant explosives/markers on the grounded attack helicopter/aircraft inside the hangars.",
      "Rotate south toward the airfield fence to extract cleanly.",
    ],
    equipment: ["Planting Device / Trackers from briefing"],
  },
  "the great escape": {
    coords: [{ gridX: 205, gridY: 137, label: "Ban Pa Docks & Kapu Boat Rental" }],
    steps: [
      "Deploy to Ban Pa (LZ India 1 / India 2) and move to Kapu Boat Rental by the waterfront docks.",
      "Locate the boat at the dock, then head into the nearby restaurant and inspect the wall map next to the kitchen bar.",
      "Follow the map lead to the indicated small riverside hut, vault/jump in through the window, and grab the Intel on the table.",
    ],
  },
  "the call of phi pa mum": {
    coords: [
      { gridX: 203, gridY: 138, label: "Ban Pa House of Prayers (203, 138)" },
      { gridX: 203, gridY: 148, label: "Alternate Approach House (203, 148)" },
    ],
    steps: [
      "Move to the House of Prayers in Ban Pa around Grid 203, 138 (outer stairs lead to the 2nd floor).",
      "Open the upper quest room door; if locked, carefully ledge-hop along the exterior trim to the open window and vault inside.",
      "Pick up the Weird Book lying on the floor beside the circle of candles, then deliver it to Artisan at FOB or a friendly COP.",
    ],
  },
  "letter from beyond": {
    coords: [
      { gridX: 189, gridY: 163, label: "Fallen Body (189, 163)" },
      { gridX: 189, gridY: 160, label: "Letter Inside House (189, 160)" },
    ],
    steps: [
      "Sweep to Grid 189, 163 near Pha Lang Airfield / Pha Lang outskirts to locate the body.",
      "Move south to the house at Grid 189, 160 and pick up the Letter resting inside.",
      "Deliver the letter to Artisan via base or a controlled Combat Outpost.",
    ],
  },
  "repossession ii": {
    coords: [
      { gridX: 158, gridY: 156, label: "2-Story Green House — Briefcase (158, 156)" },
      { gridX: 158, gridY: 153, label: "Delivery Hut — Gray Container (158, 153)" },
    ],
    steps: [
      "At Grid 158, 156, enter the green two-story house and climb to the second floor.",
      "Take the left door and pick up the gray Briefcase hidden underneath the bed.",
      "Carry it south to the small hut at Grid 158, 153 and deposit the briefcase inside the gray container on the left.",
    ],
    equipment: ["Briefcase slot (2×2+)"],
  },
  "final checkout": {
    coords: [{ gridX: 170, gridY: 167, label: "Midnight Sapphire Hotel" }],
    steps: [
      "Deploy to Midnight Sapphire (LZ Hotel 1 / Hotel 2 / Golf 1) and breach the main Hotel building.",
      "Watch all upper atrium balconies for guards and retrieve the VIP ledger / target objective inside the reception or suite wing.",
    ],
  },
};

// Fix the accidental YBL-1 entry coordinates cleanly
CURATED_TASK_WALKTHROUGHS["the negotiator"] = {
  coords: [{ gridX: 143, gridY: 122, label: "YBL-1 Underground Bunker" }],
  steps: [
    "Deploy to YBL-1 Bunker (Grid 143 122, nearest LZs: Lima 1 / Lima 2 / Lima 3) with a weapon-mounted flashlight.",
    "Clear surface rebels along the fence and descend the main concrete bunker ramp or side shaft.",
    "Locate the Negotiator room near the lower generator / detention wing (carry YBL-1 Office / Bedroom keys if available) and secure the objective.",
  ],
  equipment: ["Weapon Flashlight", "YBL-1 Keys (backup)"],
};
