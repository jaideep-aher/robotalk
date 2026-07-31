/**
 * The hero robotaxi: an on-rails vehicle that autopilots the waypoint graph and
 * obeys parsed commands. There is no physics; motion is pure kinematics along
 * road centrelines with smooth heading interpolation and intersection pauses.
 */

import * as THREE from "three";
import { AssetLibrary, tintCarBody } from "../assets";
import { ASSETS, DRIVE, PALETTE, WORLD } from "../config";
import type { Command } from "../types";
import { WaypointGraph } from "./WaypointGraph";

/** Behaviour states of the robotaxi. */
type Mode =
  | "driving"
  | "paused"
  | "stopped"
  | "waiting"
  | "creeping"
  | "backing"
  | "pulled_over";

import { CAR_FORWARD_OFFSET } from "./carOrientation";

/**
 * Stop this far short of a vehicle sitting directly ahead. Kept well under the
 * 8 m tile spacing so a car parked at the next intersection does not freeze
 * this one, and comfortably above the 4.6 m car length so they never overlap.
 */
const YIELD_DISTANCE = 6.0;
/** Cosine of the half-angle counted as "ahead" when yielding. */
const YIELD_CONE = 0.75;
/** After waiting this long behind traffic while free-roaming, turn elsewhere. */
const REROUTE_AFTER = 2.0;
/** Hard floor on the gap between vehicle centres, above the 4.6 m car length. */
const MIN_SEPARATION = 5.2;

/**
 * The hero vehicle. Construct with {@link load}, then drive with {@link update}
 * and steer behaviour with {@link applyCommand}.
 */
export class Robotaxi {
  readonly root = new THREE.Group();
  position = new THREE.Vector3();
  heading = 0; // radians; travel direction as atan2(dx, dz)

  private mode: Mode = "driving";
  private lastNodeId = "";
  private targetNodeId = "";
  private pauseTimer = 0;
  private waitTimer = 0;
  private creepRemaining = 0;
  private backRemaining = 0;
  private doorFlashTimer = 0;
  private yielding = false;
  private yieldTimer = 0;
  /** Positions of other vehicles this frame, used for separation checks. */
  private nearby: THREE.Vector3[] = [];
  /** Set for one read when the taxi reaches its requested destination. */
  arrived = false;
  /** Node the taxi is currently routing to, if a destination was set. */
  private goalNodeId: string | null = null;
  /** Human-readable name of the current destination, for the UI. */
  destinationName: string | null = null;

  private bodyMaterials: THREE.MeshStandardMaterial[] = [];
  private mesh!: THREE.Group;

  /**
   * @param graph - The waypoint graph to drive on.
   * @param rng - Seeded RNG for route choices.
   */
  constructor(
    private readonly graph: WaypointGraph,
    private readonly rng: () => number
  ) {}

  /**
   * Load the taxi model, tint it teal, and place it at a starting node.
   *
   * @param assets - The shared asset library.
   * @param startNodeId - Node to spawn at.
   */
  async load(assets: AssetLibrary, startNodeId: string): Promise<void> {
    this.mesh = await assets.instance(`${ASSETS.cars}/taxi.glb`);
    // Scale the car to a realistic length in metre units.
    const rawBox = new THREE.Box3().setFromObject(this.mesh);
    const rawSize = new THREE.Vector3();
    rawBox.getSize(rawSize);
    const rawLength = Math.max(rawSize.x, rawSize.z) || 1;
    this.mesh.scale.setScalar(WORLD.carLengthMeters / rawLength);
    tintCarBody(this.mesh, PALETTE.hero);
    this.mesh.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const std = mat as THREE.MeshStandardMaterial;
          if (std.color) this.bodyMaterials.push(std);
        }
      }
    });
    this.root.add(this.mesh);

    const start = this.graph.node(startNodeId)!;
    this.position.copy(start.pos);
    this.lastNodeId = startNodeId;
    this.targetNodeId = this.pickNextNode(startNodeId, startNodeId);
    const target = this.graph.node(this.targetNodeId)!;
    this.heading = Math.atan2(target.pos.x - start.pos.x, target.pos.z - start.pos.z);
    this.syncTransform();
  }

  /**
   * Choose the next node to head to, avoiding an immediate U-turn when possible.
   *
   * @param fromId - The node just arrived at.
   * @param cameFromId - The node departed from (to avoid backtracking).
   * @returns The chosen next node id.
   */
  private pickNextNode(fromId: string, cameFromId: string): string {
    const neighbors = this.graph.neighbors(fromId);
    const forward = neighbors.filter((n) => n !== cameFromId);
    const choices = forward.length > 0 ? forward : neighbors;
    return choices[Math.floor(this.rng() * choices.length)];
  }

  /**
   * Advance the simulation by one frame.
   *
   * @param dt - Delta time in seconds.
   * @param traffic - Positions of other vehicles, so the taxi holds instead of
   *   driving through them.
   */
  update(dt: number, traffic: THREE.Vector3[] = []): void {
    this.nearby = traffic;
    this.updateDoorFlash(dt);

    // Always yield to whatever is directly ahead. The taxi never drives
    // through another vehicle; if the wait drags on while free-roaming it
    // turns down a different street instead.
    this.yielding = this.shouldYield(traffic);
    if (this.yielding) {
      this.yieldTimer += dt;
      if (this.yieldTimer > REROUTE_AFTER && !this.goalNodeId) {
        this.yieldTimer = 0;
        this.turnAway();
      }
    } else {
      this.yieldTimer = 0;
    }

    switch (this.mode) {
      case "driving":
        if (!this.yielding) this.drive(dt);
        break;
      case "paused":
        this.pauseTimer -= dt;
        this.steerToward(this.targetDirection(), dt);
        if (this.pauseTimer <= 0) this.mode = "driving";
        break;
      case "waiting":
        this.waitTimer -= dt;
        if (this.waitTimer <= 0) this.mode = "driving";
        break;
      case "creeping":
        if (!this.yielding) {
          this.creepRemaining -= this.advance(DRIVE.speed * 0.6 * dt);
          if (this.creepRemaining <= 0) this.mode = "stopped";
        }
        break;
      case "backing":
        this.backRemaining -= this.advance(-DRIVE.reverseSpeed * dt);
        if (this.backRemaining <= 0) this.mode = "stopped";
        break;
      case "stopped":
      case "pulled_over":
        break;
    }
    this.syncTransform();
  }

  /**
   * Whether a vehicle sits close ahead, so the taxi should hold position.
   *
   * @param traffic - World positions of other vehicles.
   * @returns True if the taxi should wait rather than drive on.
   */
  private shouldYield(traffic: THREE.Vector3[]): boolean {
    if (traffic.length === 0) return false;
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    for (const other of traffic) {
      const toOther = new THREE.Vector3().subVectors(other, this.position);
      toOther.y = 0;
      const distance = toOther.length();
      if (distance < 0.001 || distance > YIELD_DISTANCE) continue;
      if (toOther.normalize().dot(forward) > YIELD_CONE) return true;
    }
    return false;
  }

  /**
   * Whether moving to a position would put the taxi inside another vehicle.
   *
   * @param candidate - The position it wants to occupy.
   * @returns True if the move must be refused.
   */
  private wouldCollide(candidate: THREE.Vector3): boolean {
    for (const other of this.nearby) {
      if (Math.hypot(candidate.x - other.x, candidate.z - other.z) < MIN_SEPARATION) {
        return true;
      }
    }
    return false;
  }

  /** Drive toward the current target node at cruise speed. */
  private drive(dt: number): void {
    const target = this.graph.node(this.targetNodeId)!;
    const toTarget = new THREE.Vector3().subVectors(target.pos, this.position);
    const distance = toTarget.length();
    const step = DRIVE.speed * dt;

    if (distance <= step || distance < 0.05) {
      if (this.wouldCollide(target.pos)) return;
      this.position.copy(target.pos);
      const previous = this.lastNodeId;
      this.lastNodeId = this.targetNodeId;

      // Arrived at the requested destination: park and announce it.
      if (this.goalNodeId && this.lastNodeId === this.goalNodeId) {
        this.goalNodeId = null;
        this.arrived = true;
        this.mode = "stopped";
        return;
      }
      this.targetNodeId = this.nextTowardGoal(this.targetNodeId, previous);
      this.mode = "paused";
      this.pauseTimer = DRIVE.nodePauseSeconds;
      return;
    }
    toTarget.normalize();
    const tentative = this.position.clone().addScaledVector(toTarget, step);
    if (this.wouldCollide(tentative)) return;
    this.position.copy(tentative);
    this.steerToward(Math.atan2(toTarget.x, toTarget.z), dt);
  }

  /**
   * Park the cab at a node facing another, for staging a scenario.
   *
   * @param nodeId - Node to sit on.
   * @param facingNodeId - Node to point towards.
   */
  placeAt(nodeId: string, facingNodeId: string): void {
    const node = this.graph.node(nodeId);
    const facing = this.graph.node(facingNodeId);
    if (!node || !facing) return;
    this.position.copy(node.pos);
    this.heading = Math.atan2(facing.pos.x - node.pos.x, facing.pos.z - node.pos.z);
    this.lastNodeId = nodeId;
    this.targetNodeId = facingNodeId;
    this.goalNodeId = null;
    this.destinationName = null;
    this.arrived = false;
    this.mode = "stopped";
    this.syncTransform();
  }

  /** Drop any destination and go back to cruising the grid. */
  resumeFreeRoam(): void {
    this.goalNodeId = null;
    this.destinationName = null;
    this.arrived = false;
    this.mode = "driving";
  }

  /** Head back the way it came, to escape traffic while free-roaming. */
  private turnAway(): void {
    const alternatives = this.graph
      .neighbors(this.lastNodeId)
      .filter((id) => id !== this.targetNodeId);
    if (alternatives.length === 0) return;
    const node = this.graph.node(this.lastNodeId)!;
    this.position.copy(node.pos);
    this.targetNodeId = alternatives[Math.floor(this.rng() * alternatives.length)];
    this.mode = "paused";
    this.pauseTimer = DRIVE.nodePauseSeconds;
  }

  /**
   * Next node to head for: the routed step toward the goal when one is set,
   * otherwise a free-roam choice.
   *
   * @param fromId - Node just reached.
   * @param cameFromId - Node departed from.
   * @returns The next node id.
   */
  private nextTowardGoal(fromId: string, cameFromId: string): string {
    if (this.goalNodeId) {
      const path = this.graph.route(fromId, this.goalNodeId);
      if (path.length >= 2) return path[1];
    }
    return this.pickNextNode(fromId, cameFromId);
  }

  /**
   * Move along the current heading by a signed distance.
   *
   * @param signedStep - Positive to move forward, negative to reverse.
   * @returns The absolute distance moved (for remaining-distance bookkeeping).
   */
  private advance(signedStep: number): number {
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const tentative = this.position.clone().addScaledVector(forward, signedStep);
    // Even an explicitly commanded creep or reverse stops short of traffic.
    if (this.wouldCollide(tentative)) return 0;
    this.position.copy(tentative);
    return Math.abs(signedStep);
  }

  /** Direction toward the current target node as a yaw angle. */
  private targetDirection(): number {
    const target = this.graph.node(this.targetNodeId)!;
    return Math.atan2(target.pos.x - this.position.x, target.pos.z - this.position.z);
  }

  /**
   * Rotate the heading toward a desired yaw at the configured turn rate.
   *
   * @param desired - Desired yaw in radians.
   * @param dt - Delta time in seconds.
   */
  private steerToward(desired: number, dt: number): void {
    let delta = desired - this.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const maxTurn = DRIVE.turnRate * dt;
    this.heading += THREE.MathUtils.clamp(delta, -maxTurn, maxTurn);
  }

  /** Write position and heading onto the mesh transform, settling on ground. */
  private syncTransform(): void {
    this.root.position.set(this.position.x, this.root.position.y, this.position.z);
    this.root.rotation.y = this.heading + CAR_FORWARD_OFFSET;
    if (this.root.position.y === 0) {
      const box = new THREE.Box3().setFromObject(this.mesh);
      this.root.position.y = -box.min.y + 0.02;
    }
  }

  /**
   * Apply a parsed command. Only commands the safety gate passed cause motion;
   * rejected or clarify verdicts leave the car as it is.
   *
   * @param command - The validated command from the backend.
   */
  applyCommand(command: Command): void {
    if (command.safety_gate !== "pass") {
      return;
    }
    switch (command.intent) {
      case "stop":
        this.mode = "stopped";
        break;
      case "wait":
        this.mode = "waiting";
        this.waitTimer = command.parameters.duration_s ?? 3;
        break;
      case "resume":
        this.mode = "driving";
        break;
      case "creep_forward":
        this.creepRemaining = command.parameters.distance_m ?? DRIVE.creepDefaultMeters;
        this.mode = "creeping";
        break;
      case "back_up":
        this.backRemaining = command.parameters.distance_m ?? DRIVE.backupDefaultMeters;
        this.mode = "backing";
        break;
      case "pull_over":
        this.pullOver();
        break;
      case "change_destination":
        // Destination resolution happens in the simulation, which knows the
        // place names; it calls routeTo directly.
        break;
      case "unlock_doors":
        this.flashDoors();
        break;
      case "none":
        break;
    }
  }

  /** Snap laterally to the nearest curb and stop. */
  private pullOver(): void {
    const right = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
    this.position.addScaledVector(right, DRIVE.curbOffset);
    this.mode = "pulled_over";
  }

  /**
   * Route to a named destination and start driving there.
   *
   * @param nodeId - The goal node id.
   * @param name - Display name of the destination, for the UI and speech.
   */
  routeTo(nodeId: string, name: string): void {
    if (!this.graph.node(nodeId)) return;
    this.goalNodeId = nodeId;
    this.destinationName = name;
    this.arrived = false;
    const path = this.graph.route(this.lastNodeId, nodeId);
    this.targetNodeId =
      path.length >= 2 ? path[1] : this.pickNextNode(this.lastNodeId, this.lastNodeId);
    this.mode = "driving";
  }

  /**
   * Drive to the intersection nearest a waiting rider and stop there.
   *
   * @param riderPosition - Where the rider is standing.
   * @returns The node id the taxi is heading to.
   */
  hailTo(riderPosition: THREE.Vector3): string {
    const pickup = this.graph.nearestNode(riderPosition);
    this.routeTo(pickup.id, "your pickup point");
    return pickup.id;
  }

  /** Current world position, for other systems to avoid driving through. */
  get worldPosition(): THREE.Vector3 {
    return this.position;
  }

  /** Begin a door-unlock highlight flash. */
  private flashDoors(): void {
    this.doorFlashTimer = 1.6;
  }

  /**
   * Pulse the body emissive while a door flash is active.
   *
   * @param dt - Delta time in seconds.
   */
  private updateDoorFlash(dt: number): void {
    if (this.doorFlashTimer <= 0) return;
    this.doorFlashTimer -= dt;
    const pulse = this.doorFlashTimer > 0 ? (Math.sin(this.doorFlashTimer * 18) + 1) / 2 : 0;
    for (const mat of this.bodyMaterials) {
      mat.emissive = new THREE.Color(0x8ef6e4);
      mat.emissiveIntensity = pulse * 1.4;
    }
  }

  /** Human-readable label describing what the car is currently doing. */
  get statusLabel(): string {
    return this.mode;
  }
}
