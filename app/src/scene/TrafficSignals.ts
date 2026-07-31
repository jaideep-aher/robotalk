/**
 * Traffic signals at every intersection.
 *
 * Each junction runs one shared cycle rather than four independent heads: the
 * two road axes alternate, with an amber gap between them so nobody is given a
 * green while somebody else still has one. Junctions are offset from each other
 * in the cycle, which keeps the city from blinking in unison and gives the
 * traffic somewhere to build up and clear.
 *
 * Vehicles read the signal for the axis they are travelling on. A car already
 * inside the junction is allowed to finish its turn on amber, since stopping
 * across a junction is worse than clearing it.
 */

import * as THREE from "three";
import { WORLD } from "../config";
import type { WaypointGraph, WaypointNode } from "./WaypointGraph";

/** Signal colours, in the order the cycle runs. */
export type SignalPhase = "green" | "amber" | "red";

/** Which pair of approaches a signal governs. */
export type Axis = "northSouth" | "eastWest";

const GREEN_SECONDS = 9;
const AMBER_SECONDS = 2.2;
/** Both axes are red briefly between phases, so the junction always clears. */
const ALL_RED_SECONDS = 1.2;
const CYCLE_SECONDS = (GREEN_SECONDS + AMBER_SECONDS + ALL_RED_SECONDS) * 2;

/** Lamp colours, bright enough to read against the dusk sky. */
const LAMP_COLOURS: Record<SignalPhase, number> = {
  green: 0x2ee06a,
  amber: 0xffb020,
  red: 0xff3b30,
};

/** One junction's signal head and its place in the cycle. */
interface Junction {
  node: WaypointNode;
  /** Seconds this junction is shifted through the shared cycle. */
  offset: number;
  lamps: Record<Axis, THREE.Mesh[]>;
}

/**
 * Owns the signal heads and the phase each junction is showing.
 */
export class TrafficSignals {
  readonly root = new THREE.Group();
  private readonly junctions: Junction[] = [];
  private elapsed = 0;

  /**
   * @param graph - The intersection lattice to put signals on.
   * @param rng - Seeded RNG, used to stagger junctions through the cycle.
   */
  constructor(
    private readonly graph: WaypointGraph,
    private readonly rng: () => number
  ) {}

  /** Build a signal head on every intersection. */
  build(): void {
    for (const node of this.graph.nodes.values()) {
      const lamps: Record<Axis, THREE.Mesh[]> = { northSouth: [], eastWest: [] };
      const reach = WORLD.tileMeters * 0.42;

      // One head per approach, set back on the corner it faces.
      const heads: { axis: Axis; x: number; z: number }[] = [
        { axis: "northSouth", x: reach, z: reach },
        { axis: "northSouth", x: -reach, z: -reach },
        { axis: "eastWest", x: -reach, z: reach },
        { axis: "eastWest", x: reach, z: -reach },
      ];

      for (const head of heads) {
        const group = new THREE.Group();
        group.position.set(node.pos.x + head.x, 0, node.pos.z + head.z);

        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8),
          new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.8 })
        );
        post.position.y = 1.7;
        group.add(post);

        const housing = new THREE.Mesh(
          new THREE.BoxGeometry(0.42, 1.05, 0.3),
          new THREE.MeshStandardMaterial({ color: 0x191c22, roughness: 0.9 })
        );
        housing.position.y = 3.65;
        group.add(housing);

        // Three lamps, dark until the phase lights one of them.
        const order: SignalPhase[] = ["red", "amber", "green"];
        order.forEach((phase, index) => {
          const lamp = new THREE.Mesh(
            new THREE.SphereGeometry(0.13, 12, 12),
            new THREE.MeshStandardMaterial({
              color: LAMP_COLOURS[phase],
              emissive: new THREE.Color(LAMP_COLOURS[phase]),
              emissiveIntensity: 0,
            })
          );
          lamp.position.set(0, 4.0 - index * 0.32, 0.17);
          lamp.userData.phase = phase;
          group.add(lamp);
          lamps[head.axis].push(lamp);
        });

        this.root.add(group);
      }

      this.junctions.push({
        node,
        offset: this.rng() * CYCLE_SECONDS,
        lamps,
      });
    }
    this.update(0);
  }

  /**
   * Work out the phase an axis is showing at a point in the cycle.
   *
   * @param time - Seconds into this junction's own cycle.
   * @param axis - Which axis to report.
   * @returns The phase that axis is currently showing.
   */
  private phaseAt(time: number, axis: Axis): SignalPhase {
    const t = time % CYCLE_SECONDS;
    const half = CYCLE_SECONDS / 2;
    // North-south leads the first half of the cycle, east-west the second.
    const isFirstHalf = t < half;
    const local = isFirstHalf ? t : t - half;
    const leading = isFirstHalf ? "northSouth" : "eastWest";

    if (axis !== leading) return "red";
    if (local < GREEN_SECONDS) return "green";
    if (local < GREEN_SECONDS + AMBER_SECONDS) return "amber";
    return "red";
  }

  /**
   * The phase a vehicle approaching a junction on a heading should obey.
   *
   * @param nodeId - The junction being approached.
   * @param heading - The vehicle's travel direction.
   * @returns The phase for that approach, defaulting to green if unknown.
   */
  phaseFor(nodeId: string, heading: number): SignalPhase {
    const junction = this.junctions.find((j) => j.node.id === nodeId);
    if (!junction) return "green";
    return this.phaseAt(this.elapsed + junction.offset, axisOf(heading));
  }

  /**
   * Advance the cycle and light the correct lamp on every head.
   *
   * @param dt - Delta time in seconds.
   */
  update(dt: number): void {
    this.elapsed += dt;
    for (const junction of this.junctions) {
      const time = this.elapsed + junction.offset;
      for (const axis of ["northSouth", "eastWest"] as Axis[]) {
        const active = this.phaseAt(time, axis);
        for (const lamp of junction.lamps[axis]) {
          const material = lamp.material as THREE.MeshStandardMaterial;
          material.emissiveIntensity = lamp.userData.phase === active ? 1.6 : 0;
          material.color.setHex(
            lamp.userData.phase === active
              ? LAMP_COLOURS[lamp.userData.phase as SignalPhase]
              : 0x2a2d33
          );
        }
      }
    }
  }
}

/**
 * Which road axis a heading belongs to.
 *
 * @param heading - Travel direction as atan2(dx, dz).
 * @returns The axis that heading runs along.
 */
export function axisOf(heading: number): Axis {
  // Headings near 0 or pi run along z, which is the north-south axis.
  const alongZ = Math.abs(Math.cos(heading)) > Math.abs(Math.sin(heading));
  return alongZ ? "northSouth" : "eastWest";
}
