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

/** Yaw offset aligning the car model's forward face to +Z heading. */
const CAR_FORWARD_OFFSET = Math.PI;

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
   */
  update(dt: number): void {
    this.updateDoorFlash(dt);

    switch (this.mode) {
      case "driving":
        this.drive(dt);
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
        this.creepRemaining -= this.advance(DRIVE.speed * 0.6 * dt);
        if (this.creepRemaining <= 0) this.mode = "stopped";
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

  /** Drive toward the current target node at cruise speed. */
  private drive(dt: number): void {
    const target = this.graph.node(this.targetNodeId)!;
    const toTarget = new THREE.Vector3().subVectors(target.pos, this.position);
    const distance = toTarget.length();
    const step = DRIVE.speed * dt;

    if (distance <= step || distance < 0.05) {
      this.position.copy(target.pos);
      const previous = this.lastNodeId;
      this.lastNodeId = this.targetNodeId;
      this.targetNodeId = this.pickNextNode(this.targetNodeId, previous);
      this.mode = "paused";
      this.pauseTimer = DRIVE.nodePauseSeconds;
      return;
    }
    toTarget.normalize();
    this.position.addScaledVector(toTarget, step);
    this.steerToward(Math.atan2(toTarget.x, toTarget.z), dt);
  }

  /**
   * Move along the current heading by a signed distance.
   *
   * @param signedStep - Positive to move forward, negative to reverse.
   * @returns The absolute distance moved (for remaining-distance bookkeeping).
   */
  private advance(signedStep: number): number {
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.position.addScaledVector(forward, signedStep);
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
        this.changeDestination(command.parameters.destination_node);
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
   * Re-route to a new destination node and resume driving.
   *
   * @param destinationNode - A node id like "gx,gy" if resolvable, else a new
   *   random node is chosen to demonstrate re-routing.
   */
  private changeDestination(destinationNode: string | null): void {
    let goal = destinationNode && this.graph.node(destinationNode)
      ? destinationNode
      : this.graph.randomNode(this.rng, this.lastNodeId);
    const path = this.graph.route(this.lastNodeId, goal);
    if (path.length >= 2) {
      this.targetNodeId = path[1];
    } else {
      this.targetNodeId = this.pickNextNode(this.lastNodeId, this.lastNodeId);
    }
    this.mode = "driving";
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
