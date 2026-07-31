/**
 * Tier 2 ambient pedestrians: Quaternius CC0 animated characters walking
 * sidewalk loops around city blocks, their walk clips driven by an
 * AnimationMixer. They are purely decorative: they follow fixed block-perimeter
 * paths on the sidewalk and never step onto the road, so there is no collision
 * logic. The pedestrian camera can ride one of them at a corner.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { GRID_TILES, WORLD } from "../config";
import type { WaypointGraph } from "./WaypointGraph";

const CHARACTER_URL = "/models/characters/RobotExpressive.glb";
const WALK_SPEED = 1.35; // metres per second
const TARGET_HEIGHT = 1.9; // metres

/** One walking pedestrian on a fixed loop. */
interface Walker {
  object: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  loop: THREE.Vector3[];
  segmentLengths: number[];
  perimeter: number;
  distance: number;
}

/**
 * Loads the animated character once and instances several walkers.
 */
export class Pedestrians {
  readonly root = new THREE.Group();
  private readonly walkers: Walker[] = [];

  /**
   * @param graph - The shared waypoint graph (for block geometry).
   * @param _assets - Unused; the character is loaded directly to keep its clips.
   * @param rng - Seeded RNG for placement and phase.
   */
  constructor(
    private readonly graph: WaypointGraph,
    _assets: unknown,
    private readonly rng: () => number
  ) {}

  /**
   * Load the character and spawn walkers on distinct block sidewalks.
   *
   * @param count - Desired number of pedestrians (clamped to 6-8).
   */
  async load(count = 7): Promise<void> {
    const n = Math.max(6, Math.min(8, count));
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(CHARACTER_URL);
    const prototype = gltf.scene;
    const walkClip =
      gltf.animations.find((c) => /walk/i.test(c.name)) ?? gltf.animations[0];

    const scale = this.computeScale(prototype);
    const loops = this.blockLoops().slice(0, n);

    for (const loop of loops) {
      const object = skeletonClone(prototype) as THREE.Object3D;
      object.scale.setScalar(scale);
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
      });

      const mixer = new THREE.AnimationMixer(object);
      if (walkClip) {
        const action = mixer.clipAction(walkClip);
        action.time = this.rng() * walkClip.duration;
        action.play();
      }

      const segmentLengths: number[] = [];
      let perimeter = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const len = a.distanceTo(b);
        segmentLengths.push(len);
        perimeter += len;
      }

      const walker: Walker = {
        object,
        mixer,
        loop,
        segmentLengths,
        perimeter,
        distance: this.rng() * perimeter,
      };
      this.placeWalker(walker);
      this.root.add(object);
      this.walkers.push(walker);
    }
  }

  /**
   * Compute a uniform scale bringing the character to a human-ish height.
   *
   * @param prototype - The loaded character scene.
   * @returns The scale factor.
   */
  private computeScale(prototype: THREE.Object3D): number {
    const box = new THREE.Box3().setFromObject(prototype);
    const size = new THREE.Vector3();
    box.getSize(size);
    return size.y > 0 ? TARGET_HEIGHT / size.y : 1;
  }

  /**
   * Build rectangular sidewalk loops, one per interior block.
   *
   * @returns A shuffled list of loops, each a list of corner points.
   */
  private blockLoops(): THREE.Vector3[][] {
    const loops: THREE.Vector3[][] = [];
    const half = WORLD.tileMeters * 0.5;
    for (let row = 1; row < GRID_TILES; row += 2) {
      for (let col = 1; col < GRID_TILES; col += 2) {
        const center = this.graph.worldOfTile(col, row);
        loops.push([
          new THREE.Vector3(center.x - half, 0, center.z - half),
          new THREE.Vector3(center.x + half, 0, center.z - half),
          new THREE.Vector3(center.x + half, 0, center.z + half),
          new THREE.Vector3(center.x - half, 0, center.z + half),
        ]);
      }
    }
    // Deterministic shuffle so the chosen blocks vary but stay reproducible.
    for (let i = loops.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [loops[i], loops[j]] = [loops[j], loops[i]];
    }
    return loops;
  }

  /**
   * Advance walk animations and move each pedestrian along its loop.
   *
   * @param dt - Delta time in seconds.
   */
  update(dt: number): void {
    for (const walker of this.walkers) {
      walker.mixer.update(dt);
      walker.distance = (walker.distance + WALK_SPEED * dt) % walker.perimeter;
      this.placeWalker(walker);
    }
  }

  /**
   * Position and orient a walker at its current loop distance.
   *
   * @param walker - The walker to place.
   */
  private placeWalker(walker: Walker): void {
    let remaining = walker.distance;
    let index = 0;
    while (remaining > walker.segmentLengths[index]) {
      remaining -= walker.segmentLengths[index];
      index = (index + 1) % walker.loop.length;
    }
    const a = walker.loop[index];
    const b = walker.loop[(index + 1) % walker.loop.length];
    const t = walker.segmentLengths[index] > 0 ? remaining / walker.segmentLengths[index] : 0;
    walker.object.position.lerpVectors(a, b, t);
    const dir = new THREE.Vector3().subVectors(b, a);
    walker.object.rotation.y = Math.atan2(dir.x, dir.z);
  }

  /**
   * Eye position of the first pedestrian, for the pedestrian camera to ride.
   *
   * @returns A world position at head height, or null if none loaded.
   */
  cornerObserver(): THREE.Vector3 | null {
    const lead = this.walkers[0];
    if (!lead) return null;
    return new THREE.Vector3(
      lead.object.position.x,
      TARGET_HEIGHT * 0.9,
      lead.object.position.z
    );
  }
}
