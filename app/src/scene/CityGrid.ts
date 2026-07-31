/**
 * Builds the visible city: modular Kenney road tiles laid on a grid with
 * buildings filling the blocks, plus a ground plane. The tile footprint is
 * measured from the straight road model at load time, and the waypoint graph is
 * spaced to match so roads and intersections line up seamlessly.
 */

import * as THREE from "three";
import { AssetLibrary, lightWindows } from "../assets";
import {
  ASSETS,
  BUILDING_HEIGHT_JITTER,
  BUILDING_MODELS,
  GRID_TILES,
  PALETTE,
  PROP_MODELS,
  ROAD_MODELS,
  WORLD,
} from "../config";
import { mulberry32 } from "../util/rng";
import { WaypointGraph } from "./WaypointGraph";

/**
 * Constructs and owns the city meshes and the matching waypoint graph.
 */
export class CityGrid {
  /** World size of one road tile in metres after scaling. */
  tileSize = WORLD.tileMeters;
  /** Scale applied to each raw road/car model unit to reach metre units. */
  private tileScale = 1;
  /** The intersection lattice, built once the tile size is known. */
  graph!: WaypointGraph;
  readonly root = new THREE.Group();

  private readonly rng = mulberry32(0x1a2b3c);

  /**
   * @param assets - The shared asset library.
   */
  constructor(private readonly assets: AssetLibrary) {}

  /**
   * Build the whole city into `this.root` and construct the waypoint graph.
   *
   * @returns A promise that resolves when every tile and building is placed.
   */
  async build(): Promise<void> {
    // Measure the raw tile footprint, then scale it up to metre units so the
    // whole world (speeds, distances, fog) can be reasoned about in metres.
    const straight = await this.assets.load(`${ASSETS.roads}/${ROAD_MODELS.straight}.glb`);
    const rawTile = Math.max(straight.size.x, straight.size.z) || 1;
    this.tileScale = WORLD.tileMeters / rawTile;
    this.tileSize = WORLD.tileMeters;
    this.graph = new WaypointGraph(this.tileSize);

    this.addGround();

    for (let row = 0; row < GRID_TILES; row++) {
      for (let col = 0; col < GRID_TILES; col++) {
        const evenRow = row % 2 === 0;
        const evenCol = col % 2 === 0;
        if (evenRow && evenCol) {
          await this.placeRoad(ROAD_MODELS.crossroad, col, row, 0);
        } else if (evenRow && !evenCol) {
          await this.placeRoad(ROAD_MODELS.straight, col, row, Math.PI / 2);
        } else if (!evenRow && evenCol) {
          await this.placeRoad(ROAD_MODELS.straight, col, row, 0);
        } else {
          await this.placeBuilding(col, row);
          await this.placeStreetLight(col, row);
        }
      }
    }
  }

  /** Add a large ground plane beneath the city. */
  private addGround(): void {
    const span = (GRID_TILES + 2) * this.tileSize;
    const geometry = new THREE.PlaneGeometry(span, span);
    const material = new THREE.MeshStandardMaterial({
      color: PALETTE.ground,
      roughness: 1,
      metalness: 0,
    });
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.root.add(ground);
  }

  /**
   * Place one road tile at a tile coordinate.
   *
   * @param model - Road model basename.
   * @param col - Tile column.
   * @param row - Tile row.
   * @param rotationY - Y rotation in radians.
   */
  private async placeRoad(
    model: string,
    col: number,
    row: number,
    rotationY: number
  ): Promise<void> {
    const tile = await this.assets.instance(`${ASSETS.roads}/${model}.glb`);
    tile.scale.setScalar(this.tileScale);
    const pos = this.graph.worldOfTile(col, row);
    tile.position.copy(pos);
    tile.rotation.y = rotationY;
    this.settleOnGround(tile);
    this.root.add(tile);
  }

  /**
   * Place a building on a block tile, scaled to fit and lit for dusk.
   *
   * @param col - Tile column (odd).
   * @param row - Tile row (odd).
   */
  private async placeBuilding(col: number, row: number): Promise<void> {
    const name = BUILDING_MODELS[Math.floor(this.rng() * BUILDING_MODELS.length)];
    const building = await this.assets.instance(`${ASSETS.buildings}/${name}.glb`);

    const box = new THREE.Box3().setFromObject(building);
    const size = new THREE.Vector3();
    box.getSize(size);
    const footprint = Math.max(size.x, size.z);
    const targetFootprint = this.tileSize * (0.62 + this.rng() * 0.16);
    const scale = footprint > 0 ? targetFootprint / footprint : 1;

    // Vary the height per instance so the skyline is not one repeated shape.
    const stretch =
      BUILDING_HEIGHT_JITTER.min +
      this.rng() * (BUILDING_HEIGHT_JITTER.max - BUILDING_HEIGHT_JITTER.min);
    building.scale.set(scale, scale * stretch, scale);

    building.rotation.y = (Math.PI / 2) * Math.floor(this.rng() * 4);
    const pos = this.graph.worldOfTile(col, row);
    building.position.copy(pos);
    this.settleOnGround(building);
    lightWindows(building);
    this.root.add(building);
  }

  /**
   * Put a street light on the corner of a block, so the streets have some
   * vertical detail at eye level rather than bare kerbs.
   *
   * @param col - Tile column of the block.
   * @param row - Tile row of the block.
   */
  private async placeStreetLight(col: number, row: number): Promise<void> {
    // Only light some corners, so the city does not look regimented.
    if (this.rng() > 0.55) return;
    const name = PROP_MODELS[Math.floor(this.rng() * PROP_MODELS.length)];
    const light = await this.assets.instance(`${ASSETS.roads}/${name}.glb`);
    light.scale.setScalar(this.tileScale);

    const centre = this.graph.worldOfTile(col, row);
    const edge = this.tileSize * 0.5;
    const cornerX = this.rng() < 0.5 ? -edge : edge;
    const cornerZ = this.rng() < 0.5 ? -edge : edge;
    light.position.set(centre.x + cornerX, 0, centre.z + cornerZ);
    light.rotation.y = (Math.PI / 2) * Math.floor(this.rng() * 4);
    this.settleOnGround(light);
    this.root.add(light);
  }

  /**
   * Drop an object so its lowest point rests on the ground plane.
   *
   * @param object - The object to settle.
   */
  private settleOnGround(object: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(object);
    object.position.y += -box.min.y;
  }
}
