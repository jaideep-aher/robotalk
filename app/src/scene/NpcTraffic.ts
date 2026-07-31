/**
 * Tier 2 ambient traffic: a handful of NPC cars looping the same waypoint graph
 * as the hero at constant speed. The only interaction rule is a follow-distance
 * check: if another car is close ahead on the same directed edge, stop. That one
 * rule makes cars queue naturally behind each other at intersections.
 */

import * as THREE from "three";
import { AssetLibrary } from "../assets";
import { ASSETS, NPC_CAR_MODELS, WORLD } from "../config";
import type { WaypointGraph } from "./WaypointGraph";

import { CAR_FORWARD_OFFSET } from "./carOrientation";

const NPC_SPEED = 5.0; // metres per second
/**
 * Stop if a vehicle is this close ahead. Kept below the 8 m tile spacing so a
 * car waiting at the next intersection does not freeze this one, and above the
 * 4.6 m car length so they never visually overlap.
 */
const FOLLOW_DISTANCE = 6.0;
const FORWARD_CONE = 0.75; // cos of the half-angle counted as "ahead"
const NODE_PAUSE = 0.6; // seconds paused at each intersection
/**
 * After waiting this long behind someone, pick a different street. Rerouting
 * (rather than driving on) is what keeps traffic from gridlocking without ever
 * letting two cars occupy the same space.
 */
const REROUTE_AFTER = 2.0;
/**
 * Hard floor on the distance between two vehicle centres. Slightly above the
 * 4.6 m car length so bodies never visually intersect, whatever the yielding
 * logic decides.
 */
const MIN_SEPARATION = 5.2;

/** One NPC vehicle driving the graph. */
interface NpcCar {
  root: THREE.Group;
  position: THREE.Vector3;
  heading: number;
  lastNodeId: string;
  targetNodeId: string;
  pauseTimer: number;
  /** Distance travelled from lastNode along the current edge. */
  progress: number;
  /** Seconds spent waiting for a vehicle ahead, used to break deadlocks. */
  blockedFor: number;
}

/**
 * Spawns and updates the NPC cars.
 */
export class NpcTraffic {
  readonly root = new THREE.Group();
  private readonly cars: NpcCar[] = [];

  /**
   * @param graph - The shared waypoint graph.
   * @param assets - The shared asset library.
   * @param rng - Seeded RNG for spawn and route choices.
   */
  constructor(
    private readonly graph: WaypointGraph,
    private readonly assets: AssetLibrary,
    private readonly rng: () => number,
    private readonly heroStartNodeId = ""
  ) {}

  /**
   * Load and place the NPC cars on distinct starting edges.
   *
   * @param count - How many NPC cars to spawn (clamped to 4-6).
   */
  async load(count = 5): Promise<void> {
    const n = Math.max(4, Math.min(6, count));
    // Spawn on distinct nodes so no two cars start inside one another.
    const nodeIds = [...this.graph.nodes.keys()];
    for (let i = nodeIds.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [nodeIds[i], nodeIds[j]] = [nodeIds[j], nodeIds[i]];
    }
    const spawnIds = nodeIds.filter((id) => id !== this.heroStartNodeId).slice(0, n);

    for (let i = 0; i < spawnIds.length; i++) {
      const model = NPC_CAR_MODELS[i % NPC_CAR_MODELS.length];
      const mesh = await this.assets.instance(`${ASSETS.cars}/${model}.glb`);
      this.scaleCar(mesh);

      const startId = spawnIds[i];
      const neighbors = this.graph.neighbors(startId);
      const targetId = neighbors[Math.floor(this.rng() * neighbors.length)];
      const start = this.graph.node(startId)!;

      const group = new THREE.Group();
      group.add(mesh);
      const car: NpcCar = {
        root: group,
        position: start.pos.clone(),
        heading: 0,
        lastNodeId: startId,
        targetNodeId: targetId,
        pauseTimer: this.rng() * NODE_PAUSE,
        progress: 0,
        blockedFor: 0,
      };
      this.settle(car);
      this.root.add(group);
      this.cars.push(car);
    }
  }

  /**
   * World positions of every NPC car, so other drivers can avoid them.
   *
   * @returns A list of live position vectors.
   */
  positions(): THREE.Vector3[] {
    return this.cars.map((car) => car.position);
  }

  /**
   * Scale a car model to a realistic length in metre units.
   *
   * @param mesh - The car mesh group.
   */
  private scaleCar(mesh: THREE.Group): void {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const length = Math.max(size.x, size.z) || 1;
    mesh.scale.setScalar(WORLD.carLengthMeters / length);
  }

  /**
   * Advance all NPC cars, applying the follow-distance queueing rule.
   *
   * @param dt - Delta time in seconds.
   * @param heroPosition - Where the player's robotaxi is, so NPCs yield to it
   *   instead of driving through it.
   */
  update(dt: number, heroPosition?: THREE.Vector3): void {
    for (const car of this.cars) {
      if (car.pauseTimer > 0) {
        car.pauseTimer -= dt;
        this.applyTransform(car);
        continue;
      }
      if (this.blockedAhead(car, heroPosition)) {
        // Never drive through the vehicle ahead. Wait, and if the wait drags
        // on, turn down a different street instead so traffic cannot gridlock.
        car.blockedFor += dt;
        if (car.blockedFor > REROUTE_AFTER) {
          car.blockedFor = 0;
          this.turnAway(car);
        }
        this.applyTransform(car);
        continue;
      }
      car.blockedFor = 0;
      this.advance(car, dt, heroPosition);
      this.applyTransform(car);
    }
  }

  /**
   * Whether any vehicle sits close ahead of this one.
   *
   * Checked as a forward-cone proximity test in world space rather than a
   * same-edge test, so cars also yield when converging on an intersection from
   * different edges and never drive through one another or through the hero.
   *
   * @param car - The car to test.
   * @param heroPosition - The hero robotaxi's position, if known.
   * @returns True if the car should hold.
   */
  private blockedAhead(car: NpcCar, heroPosition?: THREE.Vector3): boolean {
    const forward = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
    const others = this.cars
      .filter((o) => o !== car)
      .map((o) => o.position)
      .concat(heroPosition ? [heroPosition] : []);

    for (const other of others) {
      const toOther = new THREE.Vector3().subVectors(other, car.position);
      toOther.y = 0;
      const distance = toOther.length();
      if (distance < 0.001 || distance > FOLLOW_DISTANCE) continue;
      // Only yield to what is genuinely in front, so cars are not deadlocked
      // by a vehicle sitting beside or behind them.
      if (toOther.normalize().dot(forward) > FORWARD_CONE) {
        return true;
      }
    }
    return false;
  }

  /**
   * Move a car toward its target node, handling arrival and re-routing.
   *
   * @param car - The car to move.
   * @param dt - Delta time in seconds.
   */
  private advance(car: NpcCar, dt: number, heroPosition?: THREE.Vector3): void {
    const target = this.graph.node(car.targetNodeId)!;
    const toTarget = new THREE.Vector3().subVectors(target.pos, car.position);
    const distance = toTarget.length();
    const step = NPC_SPEED * dt;

    if (distance <= step || distance < 0.05) {
      // Arriving still has to respect separation, or cars converging on an
      // intersection from different streets would land on the same node.
      if (this.wouldCollide(car, target.pos, heroPosition)) return;
      car.position.copy(target.pos);
      const previous = car.lastNodeId;
      car.lastNodeId = car.targetNodeId;
      car.targetNodeId = this.pickNext(car.targetNodeId, previous);
      car.progress = 0;
      car.pauseTimer = NODE_PAUSE;
      return;
    }
    toTarget.normalize();

    // Try the step, and simply do not take it if it would close inside another
    // vehicle. This is the hard guarantee that nothing ever overlaps, whatever
    // the higher-level yielding logic decides.
    const tentative = car.position.clone().addScaledVector(toTarget, step);
    if (this.wouldCollide(car, tentative, heroPosition)) return;

    car.position.copy(tentative);
    car.progress += step;
    const desired = Math.atan2(toTarget.x, toTarget.z);
    car.heading = this.steer(car.heading, desired, dt);
  }

  /**
   * Whether moving a car to a position would put it inside another vehicle.
   *
   * @param car - The car being moved.
   * @param candidate - The position it wants to occupy.
   * @param heroPosition - The hero taxi's position, if known.
   * @returns True if the move must be refused.
   */
  private wouldCollide(
    car: NpcCar,
    candidate: THREE.Vector3,
    heroPosition?: THREE.Vector3
  ): boolean {
    for (const other of this.cars) {
      if (other === car) continue;
      if (this.tooClose(candidate, other.position)) return true;
    }
    return heroPosition ? this.tooClose(candidate, heroPosition) : false;
  }

  /**
   * Whether two vehicle centres are closer than one car length.
   *
   * @param a - First position.
   * @param b - Second position.
   * @returns True if they would visibly overlap.
   */
  private tooClose(a: THREE.Vector3, b: THREE.Vector3): boolean {
    return Math.hypot(a.x - b.x, a.z - b.z) < MIN_SEPARATION;
  }

  /**
   * Retarget a stuck car down a different street so traffic cannot gridlock.
   *
   * The car is never teleported, only re-aimed; moving it could place it
   * inside another vehicle, which is exactly what this system must prevent.
   *
   * @param car - The blocked car.
   */
  private turnAway(car: NpcCar): void {
    const alternatives = this.graph
      .neighbors(car.lastNodeId)
      .filter((id) => id !== car.targetNodeId);
    if (alternatives.length === 0) return;
    car.targetNodeId = alternatives[Math.floor(this.rng() * alternatives.length)];
    car.progress = 0;
    car.pauseTimer = NODE_PAUSE;
  }

  /**
   * Choose the next node, avoiding an immediate U-turn when possible.
   *
   * @param fromId - Node just reached.
   * @param cameFromId - Node departed from.
   * @returns The next node id.
   */
  private pickNext(fromId: string, cameFromId: string): string {
    const neighbors = this.graph.neighbors(fromId);
    const forward = neighbors.filter((n) => n !== cameFromId);
    const choices = forward.length > 0 ? forward : neighbors;
    return choices[Math.floor(this.rng() * choices.length)];
  }

  /**
   * Rotate a heading toward a desired yaw at a fixed turn rate.
   *
   * @param heading - Current yaw.
   * @param desired - Desired yaw.
   * @param dt - Delta time in seconds.
   * @returns The updated yaw.
   */
  private steer(heading: number, desired: number, dt: number): number {
    let delta = desired - heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const maxTurn = 3.0 * dt;
    return heading + THREE.MathUtils.clamp(delta, -maxTurn, maxTurn);
  }

  /**
   * Settle a car onto the ground and write its transform once.
   *
   * @param car - The car to settle.
   */
  private settle(car: NpcCar): void {
    car.root.position.copy(car.position);
    const box = new THREE.Box3().setFromObject(car.root);
    car.root.position.y = -box.min.y + 0.02;
  }

  /**
   * Write a car's position and heading onto its group.
   *
   * @param car - The car to update.
   */
  private applyTransform(car: NpcCar): void {
    car.root.position.x = car.position.x;
    car.root.position.z = car.position.z;
    car.root.rotation.y = car.heading + CAR_FORWARD_OFFSET;
  }
}
