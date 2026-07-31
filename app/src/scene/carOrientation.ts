/**
 * Shared car orientation constant.
 *
 * Headings in this project are yaw angles measured as `atan2(dx, dz)`, so a
 * heading of 0 points along +Z. The Kenney car models are authored facing -Z,
 * so their meshes need a half turn to line the nose up with the direction of
 * travel. Getting this wrong makes vehicles appear to drive backwards, so it
 * lives in one place that the hero taxi and the NPC traffic both import.
 */

/** Yaw offset added to a heading before it is written to a car's transform. */
export const CAR_FORWARD_OFFSET = 0;
