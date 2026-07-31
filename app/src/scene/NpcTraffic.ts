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

/** Yaw offset aligning the car model's forward face to +Z heading. */
const CAR_FORWARD_OFFSET = Math.PI;
const NPC_SPEED = 5.0; // metres per second
const FOLLOW_DISTANCE = 7.5; // stop if a car is this close ahead
const NODE_PAUSE = 0.6; // seconds paused at each intersection

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
    private readonly rng: () => number
  ) {}

  /**
   * Load and place the NPC cars on distinct starting edges.
   *
   * @param count - How many NPC cars to spawn (clamped to 4-6).
   */
  async load(count = 5): Promise<void> {
    const n = Math.max(4, Math.min(6, count));
    const nodeIds = [...this.graph.nodes.keys()];
    for (let i = 0; i < n; i++) {
      const model = NPC_CAR_MODELS[i % NPC_CAR_MODELS.length];
      const mesh = await this.assets.instance(`${ASSETS.cars}/${model}.glb`);
      this.scaleCar(mesh);

      const startId = nodeIds[Math.floor(this.rng() * nodeIds.length)];
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
      };
      this.settle(car);
      this.root.add(group);
      this.cars.push(car);
    }
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
   */
  update(dt: number): void {
    for (const car of this.cars) {
      if (car.pauseTimer > 0) {
        car.pauseTimer -= dt;
        this.applyTransform(car);
        continue;
      }
      if (this.blockedAhead(car)) {
        this.applyTransform(car);
        continue;
      }
      this.advance(car, dt);
      this.applyTransform(car);
    }
  }

  /**
   * Whether another car is close ahead on the same directed edge.
   *
   * @param car - The car to test.
   * @returns True if the car should hold for the one in front.
   */
  private blockedAhead(car: NpcCar): boolean {
    for (const other of this.cars) {
      if (other === car) continue;
      const sameEdge =
        other.lastNodeId === car.lastNodeId &&
        other.targetNodeId === car.targetNodeId;
      if (!sameEdge) continue;
      const gap = other.progress - car.progress;
      if (gap > 0 && gap < FOLLOW_DISTANCE) {
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
  private advance(car: NpcCar, dt: number): void {
    const target = this.graph.node(car.targetNodeId)!;
    const toTarget = new THREE.Vector3().subVectors(target.pos, car.position);
    const distance = toTarget.length();
    const step = NPC_SPEED * dt;

    if (distance <= step || distance < 0.05) {
      car.position.copy(target.pos);
      const previous = car.lastNodeId;
      car.lastNodeId = car.targetNodeId;
      car.targetNodeId = this.pickNext(car.targetNodeId, previous);
      car.progress = 0;
      car.pauseTimer = NODE_PAUSE;
      return;
    }
    toTarget.normalize();
    car.position.addScaledVector(toTarget, step);
    car.progress += step;
    const desired = Math.atan2(toTarget.x, toTarget.z);
    car.heading = this.steer(car.heading, desired, dt);
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
