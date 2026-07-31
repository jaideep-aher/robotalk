/**
 * Central configuration for the robotalk simulator: grid dimensions, the dusk
 * art direction, driving parameters, and asset paths. Keeping these in one
 * place makes the whole look and feel tunable from a single file.
 */

/** Number of city blocks per side. A 4x4 block grid. */
export const GRID_BLOCKS = 4;

/**
 * Tiles per side of the road lattice. Blocks sit on odd tile coordinates and
 * road intersections on even ones, so a B-block grid needs 2*B + 1 tiles.
 */
export const GRID_TILES = 2 * GRID_BLOCKS + 1;

/** Dusk art-direction palette. One cohesive warm-to-cool gradient. */
export const PALETTE = {
  skyTop: 0x2a2a52,
  skyBottom: 0xff9e5e,
  fog: 0x4a4170,
  ground: 0x39335a,
  hero: 0x14b8a6, // teal robotaxi
  emissiveWindow: 0xffd28a,
  ambient: 0x50506a,
  sun: 0xffb26b,
} as const;

/**
 * World scale. Kenney road tiles are one model unit across, so we scale each
 * tile up to represent this many metres of road and treat one world unit as one
 * metre everywhere else (speeds, fog, distances from the schema).
 */
export const WORLD = {
  // Roads are three car widths across, so an intersection is wide enough for a
  // vehicle to turn through it without clipping the kerb or the oncoming lane.
  tileMeters: 13,
  carLengthMeters: 4.6,
} as const;

/** Fog depth, in metres, tuned to the grid size. */
export const FOG = {
  near: 22,
  far: 135,
} as const;

/** Driving parameters for the on-rails autopilot, in metres and seconds. */
export const DRIVE = {
  speed: 3.4, // metres per second at cruise, an unhurried city pace
  turnRate: 1.1, // radians per second, so corners are eased rather than snapped
  nodePauseSeconds: 1.1, // dwell at each intersection
  curbOffset: 2.0, // lateral offset when pulling over
  creepDefaultMeters: 3, // creep distance when none is given
  backupDefaultMeters: 3,
  reverseSpeed: 2.2,
} as const;

/** Asset locations served by Vite from `app/public`. */
export const ASSETS = {
  roads: "/models/roads",
  buildings: "/models/buildings",
  cars: "/models/cars",
  characters: "/models/characters",
} as const;

/** Building GLB basenames used to populate blocks. */
export const BUILDING_MODELS = [
  "building-a",
  "building-b",
  "building-c",
  "building-d",
  "building-e",
  "building-f",
  "building-g",
  "building-h",
  "building-i",
  "building-j",
  "building-k",
  "building-l",
  "building-m",
  "building-n",
  "building-skyscraper-a",
  "building-skyscraper-b",
  "building-skyscraper-c",
  "building-skyscraper-d",
  "building-skyscraper-e",
] as const;

/** Street furniture placed at intersections to break up the grid. */
export const PROP_MODELS = [
  "light-square",
  "light-curved",
  "light-square-double",
] as const;

/**
 * How much a building may be stretched vertically. Kenney blocks are uniform
 * heights, so a little per-instance variation is what stops the skyline
 * reading as one repeated shape.
 */
export const BUILDING_HEIGHT_JITTER = { min: 0.85, max: 1.9 } as const;

/** NPC car GLB basenames (Tier 2). */
export const NPC_CAR_MODELS = [
  "sedan",
  "suv",
  "hatchback-sports",
  "police",
  "delivery",
] as const;

/** Road tile GLB basenames. */
export const ROAD_MODELS = {
  straight: "road-straight",
  bend: "road-bend",
  crossroad: "road-crossroad",
  intersection: "road-intersection",
  end: "road-end",
} as const;
