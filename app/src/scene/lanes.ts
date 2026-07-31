/**
 * Two-lane road geometry.
 *
 * Every vehicle used to drive down the middle of the road, so two cars heading
 * in opposite directions met nose to nose and both stopped, which is what made
 * traffic seize up. Vehicles now keep to the right of the centreline, so
 * opposing traffic passes cleanly and only a car in the same lane ahead is
 * something to slow for.
 */

import * as THREE from "three";

/** How far a lane centre sits from the road centreline, in metres. */
export const LANE_OFFSET = 1.3;

/**
 * Half the width of a lane, used to decide whether another vehicle is in the
 * same lane or the oncoming one. Below this counts as the same lane.
 */
export const LANE_HALF_WIDTH = 1.9;

/**
 * The rightward direction for a heading, looking down on the map.
 *
 * @param heading - Travel direction as atan2(dx, dz).
 * @param out - Optional vector to write into.
 * @returns The unit vector pointing right of travel.
 */
export function rightOf(heading: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.cos(heading), 0, -Math.sin(heading));
}

/**
 * Shift a centreline point into the right-hand lane for a direction of travel.
 *
 * @param point - A point on the road centreline.
 * @param heading - The direction of travel through it.
 * @param out - Optional vector to write into.
 * @returns The lane position.
 */
export function toLane(
  point: THREE.Vector3,
  heading: number,
  out = new THREE.Vector3()
): THREE.Vector3 {
  const right = rightOf(heading);
  return out.copy(point).addScaledVector(right, LANE_OFFSET);
}

/**
 * Heading from one point to another.
 *
 * @param from - Start point.
 * @param to - End point.
 * @returns The heading in radians.
 */
export function headingTo(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/**
 * Whether another vehicle is close ahead in the same lane.
 *
 * The relative position is split into a component along the direction of travel
 * and one across it. Only something in front, and within a lane width to the
 * side, is a reason to slow down. A car in the oncoming lane is roughly two
 * lane offsets across and is correctly ignored.
 *
 * @param position - This vehicle's position.
 * @param heading - This vehicle's heading.
 * @param other - The other vehicle's position.
 * @param followDistance - How far ahead counts as too close.
 * @returns True if the other vehicle blocks this one.
 */
export function blocksAhead(
  position: THREE.Vector3,
  heading: number,
  other: THREE.Vector3,
  followDistance: number
): boolean {
  const dx = other.x - position.x;
  const dz = other.z - position.z;
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);

  const along = dx * forwardX + dz * forwardZ;
  if (along <= 0 || along > followDistance) return false;

  // Right-hand component of the offset, which is the across-road distance.
  const across = dx * Math.cos(heading) - dz * Math.sin(heading);
  return Math.abs(across) < LANE_HALF_WIDTH;
}
