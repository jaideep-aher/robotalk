/**
 * Tier 2 ambient traffic.
 *
 * Each NPC drives a fixed circuit around one city block, always in the same
 * rotational direction, keeping to the right-hand lane. This is deliberately
 * simpler than letting cars roam and negotiate at every junction. A roaming
 * model kept producing standoffs where two cars each waited for the other, both
 * gave up at the same moment, and met again in the same conflict, which left
 * traffic frozen for minutes at a time. Fixed circuits cannot deadlock, because
 * no car is ever waiting on a decision another car has to make.
 *
 * Cars still slow for the vehicle in front on their own circuit, and a
 * separation check keeps bodies from overlapping where circuits share a corner.
 */

import * as THREE from "three";
import { AssetLibrary } from "../assets";
import { ASSETS, GRID_BLOCKS, NPC_CAR_MODELS, WORLD } from "../config";
import { CAR_FORWARD_OFFSET } from "./carOrientation";
import { blocksAhead, cornerPoint, headingTo, isTurn, toLane } from "./lanes";
import type { TrafficSignals } from "./TrafficSignals";
import { WaypointGraph } from "./WaypointGraph";

const NPC_SPEED = 5.0; // metres per second
/** Slow for a car this close ahead on the same circuit. */
const FOLLOW_DISTANCE = 7.0;
/** Pause on reaching a corner, so turns read as deliberate. */
const CORNER_PAUSE = 0.45;
/**
 * Hard floor on the gap between vehicle centres. Below the 2.6 m between
 * opposing lanes so passing traffic is not blocked, and above the car width so
 * bodies never visibly intersect.
 */
const MIN_SEPARATION = 2.4;

/** One NPC vehicle driving a fixed circuit. */
interface NpcCar {
  root: THREE.Group;
  position: THREE.Vector3;
  heading: number;
  /** Node ids of the circuit, in order of travel. */
  circuit: string[];
  /** Index in `circuit` of the corner being driven away from. */
  legIndex: number;
  pauseTimer: number;
  /** Which circuit this car belongs to, so it only follows its own traffic. */
  loopId: number;
  /** Set while sweeping a corner, cleared once the turn completes. */
  turn: {
    entry: THREE.Vector3;
    corner: THREE.Vector3;
    exit: THREE.Vector3;
    exitHeading: number;
    progress: number;
    length: number;
  } | null;
}

/**
 * Spawns and updates the NPC cars.
 */
export class NpcTraffic {
  readonly root = new THREE.Group();
  private readonly cars: NpcCar[] = [];
  /** Signals to obey, once the junction heads have been built. */
  private signals: TrafficSignals | null = null;

  /**
   * Give the traffic a set of signals to obey.
   *
   * @param signals - The junction signal system.
   */
  useSignals(signals: TrafficSignals): void {
    this.signals = signals;
  }

  /**
   * @param graph - The shared waypoint graph.
   * @param assets - The shared asset library.
   * @param rng - Seeded RNG for model and circuit choices.
   * @param heroStartNodeId - Node the hero occupies, avoided when spawning.
   */
  constructor(
    private readonly graph: WaypointGraph,
    private readonly assets: AssetLibrary,
    private readonly rng: () => number,
    private readonly heroStartNodeId = ""
  ) {}

  /**
   * Build the set of block circuits available to drive.
   *
   * Each interior block is bounded by four intersections. Listing them in a
   * consistent rotational order gives a closed right-hand loop around it.
   *
   * @returns A shuffled list of circuits, each a list of four node ids.
   */
  private buildCircuits(): string[][] {
    const circuits: string[][] = [];
    for (let gx = 0; gx < GRID_BLOCKS; gx += 1) {
      for (let gy = 0; gy < GRID_BLOCKS; gy += 1) {
        circuits.push([
          WaypointGraph.idOf(gx, gy),
          WaypointGraph.idOf(gx, gy + 1),
          WaypointGraph.idOf(gx + 1, gy + 1),
          WaypointGraph.idOf(gx + 1, gy),
        ]);
      }
    }
    for (let i = circuits.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng() * (i + 1));
      [circuits[i], circuits[j]] = [circuits[j], circuits[i]];
    }
    return circuits;
  }

  /**
   * Load the NPC cars and place each on its own circuit.
   *
   * @param count - How many NPC cars to spawn, clamped to 4 to 6.
   */
  async load(count = 6): Promise<void> {
    const wanted = Math.max(4, Math.min(6, count));
    const circuits = this.buildCircuits()
      .filter((circuit) => !circuit.includes(this.heroStartNodeId))
      .slice(0, wanted);

    for (let index = 0; index < circuits.length; index += 1) {
      const model = NPC_CAR_MODELS[index % NPC_CAR_MODELS.length];
      const mesh = await this.assets.instance(`${ASSETS.cars}/${model}.glb`);
      this.scaleCar(mesh);

      const group = new THREE.Group();
      group.add(mesh);

      const circuit = circuits[index];
      const car: NpcCar = {
        root: group,
        position: new THREE.Vector3(),
        heading: 0,
        circuit,
        // Start part way round, so cars are not all at a corner together.
        legIndex: Math.floor(this.rng() * circuit.length),
        pauseTimer: this.rng() * CORNER_PAUSE,
        loopId: index,
        turn: null,
      };
      this.seatOnLeg(car);
      this.settle(car);

      this.root.add(group);
      this.cars.push(car);
    }
  }

  /**
   * Place a car at the start of its current leg, in the correct lane.
   *
   * @param car - The car to seat.
   */
  private seatOnLeg(car: NpcCar): void {
    const from = this.graph.node(car.circuit[car.legIndex])!;
    const to = this.graph.node(this.nextNodeId(car))!;
    car.heading = headingTo(from.pos, to.pos);
    toLane(from.pos, car.heading, car.position);
  }

  /**
   * The node this car is currently driving towards.
   *
   * @param car - The car to query.
   * @returns The node id at the end of the current leg.
   */
  private nextNodeId(car: NpcCar): string {
    return car.circuit[(car.legIndex + 1) % car.circuit.length];
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
   * Advance every NPC car along its circuit.
   *
   * @param dt - Delta time in seconds.
   * @param heroPosition - Where the hero robotaxi is, so NPCs give way to it.
   */
  update(dt: number, heroPosition?: THREE.Vector3): void {
    for (const car of this.cars) {
      if (car.pauseTimer > 0) {
        car.pauseTimer -= dt;
        this.applyTransform(car);
        continue;
      }
      if (this.blockedAhead(car, heroPosition) || this.heldAtSignal(car)) {
        this.applyTransform(car);
        continue;
      }
      this.advance(car, dt, heroPosition);
      this.applyTransform(car);
    }
  }

  /**
   * Whether this car should hold for something in front of it.
   *
   * Only the hero and cars on the same circuit count. Cars on other circuits
   * are kept apart by the separation check instead, which is what stops two
   * circuits sharing a corner from locking each other up.
   *
   * @param car - The car to test.
   * @param heroPosition - The hero robotaxi's position, if known.
   * @returns True if the car should wait.
   */
  private blockedAhead(car: NpcCar, heroPosition?: THREE.Vector3): boolean {
    if (
      heroPosition &&
      blocksAhead(car.position, car.heading, heroPosition, FOLLOW_DISTANCE)
    ) {
      return true;
    }
    for (const other of this.cars) {
      if (other === car || other.loopId !== car.loopId) continue;
      if (blocksAhead(car.position, car.heading, other.position, FOLLOW_DISTANCE)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether a red or amber signal is holding this car at the junction ahead.
   *
   * Only applies close to the stop line. A car already crossing is left to
   * clear the junction, because stopping halfway across is worse than
   * finishing the manoeuvre.
   *
   * @param car - The car to test.
   * @returns True if it must wait at the line.
   */
  private heldAtSignal(car: NpcCar): boolean {
    if (!this.signals) return false;
    const target = this.graph.node(this.nextNodeId(car))!;
    const distance = Math.hypot(
      target.pos.x - car.position.x,
      target.pos.z - car.position.z
    );
    // Stop line sits about a car length back from the junction centre.
    const atLine = distance < WORLD.tileMeters * 0.55 && distance > WORLD.tileMeters * 0.34;
    if (!atLine) return false;
    return this.signals.phaseFor(target.id, car.heading) !== "green";
  }

  /**
   * Move a car along its current leg, turning the corner on arrival.
   *
   * @param car - The car to move.
   * @param dt - Delta time in seconds.
   * @param heroPosition - The hero robotaxi's position, if known.
   */
  private advance(car: NpcCar, dt: number, heroPosition?: THREE.Vector3): void {
    const step = NPC_SPEED * dt;

    // Sweeping the corner: follow the curve rather than the straight line to
    // the next lane point, so the body traces the turn instead of sliding
    // sideways across the junction.
    if (car.turn) {
      car.turn.progress += step / car.turn.length;
      if (car.turn.progress >= 1) {
        car.position.copy(car.turn.exit);
        car.heading = car.turn.exitHeading;
        car.turn = null;
        return;
      }
      const next = cornerPoint(
        car.turn.entry,
        car.turn.corner,
        car.turn.exit,
        car.turn.progress
      );
      if (this.wouldCollide(car, next, heroPosition)) {
        car.turn.progress -= step / car.turn.length;
        return;
      }
      // Heading comes from the direction actually travelled along the curve.
      car.heading = Math.atan2(next.x - car.position.x, next.z - car.position.z);
      car.position.copy(next);
      return;
    }

    const from = this.graph.node(car.circuit[car.legIndex])!;
    const to = this.graph.node(this.nextNodeId(car))!;
    const legHeading = headingTo(from.pos, to.pos);
    const laneTarget = toLane(to.pos, legHeading);

    const toTarget = new THREE.Vector3().subVectors(laneTarget, car.position);
    const distance = toTarget.length();

    if (distance <= step || distance < 0.05) {
      // Arrived at the junction. Set up the swept corner onto the next leg.
      const afterIndex = (car.legIndex + 1) % car.circuit.length;
      const after = this.graph.node(
        car.circuit[(afterIndex + 1) % car.circuit.length]
      )!;
      const nextHeading = headingTo(to.pos, after.pos);

      car.legIndex = afterIndex;

      if (isTurn(legHeading, nextHeading)) {
        const exit = toLane(to.pos, nextHeading).addScaledVector(
          new THREE.Vector3(Math.sin(nextHeading), 0, Math.cos(nextHeading)),
          WORLD.tileMeters * 0.5
        );
        const entry = car.position.clone();
        car.turn = {
          entry,
          corner: to.pos.clone(),
          exit,
          exitHeading: nextHeading,
          progress: 0,
          // Rough curve length, good enough to keep the sweep at cruise speed.
          length: entry.distanceTo(to.pos) + to.pos.distanceTo(exit),
        };
      } else {
        car.position.copy(laneTarget);
      }
      return;
    }

    toTarget.normalize();
    const tentative = car.position.clone().addScaledVector(toTarget, step);
    if (this.wouldCollide(car, tentative, heroPosition)) return;

    car.position.copy(tentative);
    car.heading = this.steer(car.heading, Math.atan2(toTarget.x, toTarget.z), dt);
  }

  /**
   * Whether a step would close inside another vehicle.
   *
   * Only steps that reduce an already-too-small gap are refused, so a car that
   * has ended up beside another can still move apart rather than being frozen
   * in every direction at once.
   *
   * @param car - The car being moved.
   * @param candidate - The position it wants to occupy.
   * @param heroPosition - The hero robotaxi's position, if known.
   * @returns True if the step must be refused.
   */
  private wouldCollide(
    car: NpcCar,
    candidate: THREE.Vector3,
    heroPosition?: THREE.Vector3
  ): boolean {
    const others = this.cars
      .filter((other) => other !== car)
      .map((other) => other.position)
      .concat(heroPosition ? [heroPosition] : []);

    for (const other of others) {
      const next = Math.hypot(candidate.x - other.x, candidate.z - other.z);
      if (next >= MIN_SEPARATION) continue;
      const now = Math.hypot(car.position.x - other.x, car.position.z - other.z);
      if (next < now) return true;
    }
    return false;
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
    return heading + THREE.MathUtils.clamp(delta, -3.0 * dt, 3.0 * dt);
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
