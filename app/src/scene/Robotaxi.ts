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
import { blocksAhead, headingTo, toLane } from "./lanes";
import type { TrafficSignals } from "./TrafficSignals";

/**
 * Stop this far short of a vehicle sitting directly ahead. Kept well under the
 * 8 m tile spacing so a car parked at the next intersection does not freeze
 * this one, and comfortably above the 4.6 m car length so they never overlap.
 */
const YIELD_DISTANCE = 6.0;
/** After waiting this long behind traffic while free-roaming, turn elsewhere. */
const REROUTE_AFTER = 2.0;
/** Hard floor on the gap between vehicle centres, above the 4.6 m car length. */
/**
 * Hard floor on the gap between vehicle centres. Kept below the 2.83 m that
 * separates perpendicular lane entries at an intersection, so cars crossing
 * from different streets are not permanently frozen by each other, while still
 * being wide enough that bodies never visibly intersect.
 */
const MIN_SEPARATION = 2.4;
/**
 * How often the taxi carries straight on through a junction when it could turn.
 * Choosing uniformly made it turn at nearly every corner, which looks aimless.
 */
const STRAIGHT_ON_BIAS = 0.72;
/** How long the doors stay open before shutting themselves again. */
const DOOR_HOLD_SECONDS = 12;

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
  /** Hinges for the two door panels, animated on unlock. */
  private readonly doorHinges: THREE.Group[] = [];
  /** How far the doors are open, 0 shut to 1 fully open. */
  private doorOpenAmount = 0;
  /** Whether the doors are currently commanded open. */
  private doorsOpen = false;
  /** Seconds left before the doors shut themselves again. */
  private doorHoldTimer = 0;
  private yielding = false;
  private yieldTimer = 0;
  /** Positions of other vehicles this frame, used for separation checks. */
  private nearby: THREE.Vector3[] = [];
  /** Junction signals to obey, once they exist. */
  private signals: TrafficSignals | null = null;

  /**
   * Give the taxi a set of signals to obey.
   *
   * @param signals - The junction signal system.
   */
  useSignals(signals: TrafficSignals | null): void {
    this.signals = signals;
  }

  /**
   * Whether a red or amber is holding the taxi at the junction ahead.
   *
   * A car already inside the junction carries on, because stopping across it
   * is worse than clearing it.
   *
   * @returns True if the taxi should wait at the line.
   */
  private heldAtSignal(): boolean {
    if (!this.signals || this.goalNodeId === this.targetNodeId) return false;
    const target = this.graph.node(this.targetNodeId);
    if (!target) return false;
    const distance = Math.hypot(
      target.pos.x - this.position.x,
      target.pos.z - this.position.z
    );
    const atLine = distance < WORLD.tileMeters * 0.55 && distance > WORLD.tileMeters * 0.34;
    if (!atLine) return false;
    return this.signals.phaseFor(target.id, this.heading) !== "green";
  }
  /** Set for one read when the taxi reaches its requested destination. */
  arrived = false;
  /** Node the taxi is currently routing to, if a destination was set. */
  private goalNodeId: string | null = null;
  /** Human-readable name of the current destination, for the UI. */
  destinationName: string | null = null;

  private bodyMaterials: THREE.MeshStandardMaterial[] = [];
  /** Parts visible only from the driver's seat: bonnet, dash and pillars. */
  private readonly interior = new THREE.Group();
  /** The roof sign, hidden when the camera is inside the cabin. */
  private roofSign: THREE.Mesh | null = null;
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
    this.addRoofSign();
    this.addDoors();
    this.addInterior();
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
    this.lastNodeId = startNodeId;
    this.targetNodeId = this.pickNextNode(startNodeId, startNodeId);
    const target = this.graph.node(this.targetNodeId)!;
    this.heading = headingTo(start.pos, target.pos);
    toLane(start.pos, this.heading, this.position);
    this.syncTransform();
  }

  /**
   * Build the bit of the car a rider actually sees from inside.
   *
   * The exterior shell is hidden in the passenger view, because sitting inside
   * a car you cannot see its outside. That left the view floating in mid air
   * with no sense of being in a vehicle at all, so this adds the parts you
   * would really see over the dashboard: the bonnet ahead, a dark dash below,
   * and the window pillars at the edges of vision.
   */
  private addInterior(): void {
    const box = new THREE.Box3().setFromObject(this.mesh);
    const size = new THREE.Vector3();
    box.getSize(size);

    const bodyPaint = new THREE.MeshStandardMaterial({
      color: PALETTE.hero,
      roughness: 0.5,
      metalness: 0.3,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: 0x1b1f28,
      roughness: 0.85,
      metalness: 0.05,
    });

    // Everything here is sized against the seated eye point at about 1.15 m.
    // Only the bonnet and a shallow dash are modelled: pillars close enough to
    // frame the view are also close enough to block most of it, so they are
    // left out rather than dominating the windscreen.
    const halfWidth = size.x * 0.46;

    const bonnet = new THREE.Mesh(
      new THREE.BoxGeometry(halfWidth * 1.85, 0.07, 1.9),
      bodyPaint
    );
    bonnet.position.set(0, 0.58, 2.5);
    bonnet.rotation.x = -0.04;
    this.interior.add(bonnet);

    const dash = new THREE.Mesh(
      new THREE.BoxGeometry(halfWidth * 1.8, 0.13, 0.38),
      trim
    );
    dash.position.set(0, 0.68, 1.2);
    dash.rotation.x = 0.14;
    this.interior.add(dash);

    this.interior.visible = false;
    this.root.add(this.interior);
  }

  /**
   * Show either the outside of the car or the inside of it, never both.
   *
   * @param inside - True when the camera is riding in the cabin.
   */
  setInteriorView(inside: boolean): void {
    this.mesh.visible = !inside;
    this.interior.visible = inside;
    for (const hinge of this.doorHinges) hinge.visible = !inside;
    if (this.roofSign) this.roofSign.visible = !inside;
  }

  /**
   * Put a lit "ROBOTAXI" sign on the roof.
   *
   * Without it the hero reads as nothing more than a green car among the other
   * traffic, which loses the point that this is the driverless one you are
   * talking to.
   */
  private addRoofSign(): void {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#07201c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 74px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#7ff0de";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ROBOTAXI", canvas.width / 2, canvas.height / 2 + 4);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const faces = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: new THREE.Color(0x7ff0de),
      emissiveMap: texture,
      emissiveIntensity: 1.1,
    });
    const sides = new THREE.MeshStandardMaterial({ color: 0x07201c });

    const box = new THREE.Box3().setFromObject(this.mesh);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.42, 0.32),
      [sides, sides, sides, sides, faces, faces]
    );
    sign.position.set(0, box.max.y + 0.2, 0);
    sign.castShadow = true;
    this.roofSign = sign;
    this.root.add(sign);
  }

  /**
   * Add two thin door panels that can swing open.
   *
   * The Kenney taxi is a single body mesh with no separate door geometry, so
   * unlocking had nothing to show beyond a colour flash. These panels give the
   * unlock_doors intent real, visible motion.
   */
  private addDoors(): void {
    const box = new THREE.Box3().setFromObject(this.mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const material = new THREE.MeshStandardMaterial({
      color: PALETTE.hero,
      roughness: 0.45,
      metalness: 0.35,
    });

    for (const side of [-1, 1]) {
      // A hinge at the front edge of the door, so the panel swings outward.
      const hinge = new THREE.Group();
      hinge.position.set(side * (size.x * 0.5), size.y * 0.42, size.z * 0.12);

      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, size.y * 0.42, size.z * 0.38),
        material.clone()
      );
      // Offset so the panel hangs off the hinge rather than straddling it.
      panel.position.set(0, 0, -size.z * 0.19);
      panel.castShadow = true;
      hinge.add(panel);

      this.root.add(hinge);
      this.doorHinges.push(hinge);
    }
  }

  /**
   * Choose the next node to head to, avoiding an immediate U-turn when possible.
   *
   * @param fromId - The node just arrived at.
   * @param cameFromId - The node departed from (to avoid backtracking).
   * @returns The chosen next node id.
   */
  private pickNextNode(fromId: string, cameFromId: string): string {
    const neighbours = this.graph.neighbors(fromId);
    const forward = neighbours.filter((id) => id !== cameFromId);
    if (forward.length === 0) return neighbours[0];

    // Prefer carrying straight on. Choosing uniformly at random meant a turn at
    // roughly every junction, which reads as an indecisive car rather than one
    // going somewhere.
    const from = this.graph.node(fromId)!;
    const came = this.graph.node(cameFromId);
    if (came && came !== from) {
      const arrivalHeading = headingTo(came.pos, from.pos);
      const straight = forward.find((id) => {
        const next = this.graph.node(id)!;
        let delta = headingTo(from.pos, next.pos) - arrivalHeading;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        return Math.abs(delta) < 0.3;
      });
      if (straight && this.rng() < STRAIGHT_ON_BIAS) return straight;
    }
    return forward[Math.floor(this.rng() * forward.length)];
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
    this.updateDoors(dt);

    // Always yield to whatever is directly ahead. The taxi never drives
    // through another vehicle; if the wait drags on while free-roaming it
    // turns down a different street instead.
    this.yielding = this.shouldYield(traffic) || this.heldAtSignal();
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
    for (const other of traffic) {
      if (blocksAhead(this.position, this.heading, other, YIELD_DISTANCE)) {
        return true;
      }
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
      const next = Math.hypot(candidate.x - other.x, candidate.z - other.z);
      if (next >= MIN_SEPARATION) continue;
      // Only refuse steps that close the gap, so the taxi can always move out
      // of a tight spot rather than being frozen by a car already beside it.
      const now = Math.hypot(this.position.x - other.x, this.position.z - other.z);
      if (next < now) return true;
    }
    return false;
  }

  /** Drive toward the current target node at cruise speed. */
  private drive(dt: number): void {
    const target = this.graph.node(this.targetNodeId)!;
    const from = this.graph.node(this.lastNodeId)!;
    // Keep right, so oncoming traffic passes instead of meeting nose to nose.
    const edgeHeading = headingTo(from.pos, target.pos);
    const laneTarget = toLane(target.pos, edgeHeading);
    const toTarget = new THREE.Vector3().subVectors(laneTarget, this.position);
    const distance = toTarget.length();
    const step = DRIVE.speed * dt;

    if (distance <= step || distance < 0.05) {
      if (this.wouldCollide(laneTarget)) return;
      this.position.copy(laneTarget);
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
    this.heading = headingTo(node.pos, facing.pos);
    toLane(node.pos, this.heading, this.position);
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
    // Turn back along the road already being travelled. Aiming at a different
    // neighbour of the node behind would cut a straight line across the block.
    const cameFrom = this.lastNodeId;
    this.lastNodeId = this.targetNodeId;
    this.targetNodeId = cameFrom;
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
        this.doorsOpen = false;
        this.mode = "driving";
        break;
      case "creep_forward":
        this.doorsOpen = false;
        this.creepRemaining = command.parameters.distance_m ?? DRIVE.creepDefaultMeters;
        this.mode = "creeping";
        break;
      case "back_up":
        this.doorsOpen = false;
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
    this.doorsOpen = false;
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

  /** Unlock and swing the doors open, with a short highlight flash. */
  private flashDoors(): void {
    this.doorFlashTimer = 1.6;
    this.doorsOpen = true;
    this.doorHoldTimer = DOOR_HOLD_SECONDS;
  }

  /** Close the doors again, used once a rider has climbed in. */
  closeDoors(): void {
    this.doorsOpen = false;
  }

  /** Whether the doors are open far enough to climb through. */
  get doorsAreOpen(): boolean {
    return this.doorOpenAmount > 0.6;
  }

  /**
   * Ease the door panels towards their commanded position.
   *
   * @param dt - Delta time in seconds.
   */
  private updateDoors(dt: number): void {
    // A car that is moving must not be holding its doors open, and doors left
    // open with nobody boarding should shut themselves rather than stay ajar.
    if (this.doorsOpen) {
      if (this.isMoving) {
        this.doorsOpen = false;
      } else {
        this.doorHoldTimer -= dt;
        if (this.doorHoldTimer <= 0) this.doorsOpen = false;
      }
    }

    const target = this.doorsOpen ? 1 : 0;
    const speed = 2.6;
    if (this.doorOpenAmount < target) {
      this.doorOpenAmount = Math.min(target, this.doorOpenAmount + speed * dt);
    } else if (this.doorOpenAmount > target) {
      this.doorOpenAmount = Math.max(target, this.doorOpenAmount - speed * dt);
    }
    const angle = this.doorOpenAmount * (Math.PI / 2.6);
    this.doorHinges.forEach((hinge, index) => {
      // Left and right doors swing in opposite directions.
      hinge.rotation.y = index === 0 ? angle : -angle;
    });
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

  /** Whether the car is under way, in any of its moving modes. */
  private get isMoving(): boolean {
    return (
      this.mode === "driving" ||
      this.mode === "creeping" ||
      this.mode === "backing" ||
      this.mode === "paused"
    );
  }

  /** Human-readable label describing what the car is currently doing. */
  get statusLabel(): string {
    return this.mode;
  }
}
