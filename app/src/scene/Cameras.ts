/**
 * Camera rigs for the available points of view.
 *
 * Passenger rides inside the robotaxi looking out through the windshield.
 * Pedestrian rides the player-controlled character walking the streets.
 * Overhead is a chase camera floating behind and above the taxi, which is the
 * clearest view for watching the car obey (or refuse) a command.
 */

import * as THREE from "three";
import type { Robotaxi } from "./Robotaxi";

/** Which viewpoint is active. */
export type ViewMode = "passenger" | "pedestrian" | "overhead";

/** Display metadata for the point-of-view switcher. */
export const VIEW_LABELS: Record<ViewMode, string> = {
  passenger: "Passenger",
  pedestrian: "Pedestrian",
  overhead: "Overhead",
};

/**
 * Owns the single perspective camera and positions it per view mode each frame.
 */
export class CameraManager {
  readonly camera: THREE.PerspectiveCamera;
  private mode: ViewMode = "passenger";
  private pedestrianAnchor = new THREE.Vector3(0, 1.6, 0);
  private pedestrianHeading = 0;
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpLook = new THREE.Vector3();
  private readonly smoothed = new THREE.Vector3();
  private initialised = false;

  /**
   * @param aspect - Initial viewport aspect ratio.
   */
  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 800);
  }

  /**
   * Set the active view mode.
   *
   * @param mode - The viewpoint to switch to.
   */
  setMode(mode: ViewMode): void {
    this.mode = mode;
    this.initialised = false;
  }

  /** The currently active view mode. */
  get viewMode(): ViewMode {
    return this.mode;
  }

  /**
   * Move the pedestrian standpoint and facing.
   *
   * @param position - World position of the observer's eyes.
   * @param heading - Facing direction in radians.
   */
  setPedestrianAnchor(position: THREE.Vector3, heading = this.pedestrianHeading): void {
    this.pedestrianAnchor.copy(position);
    this.pedestrianHeading = heading;
  }

  /**
   * Update the camera aspect on resize.
   *
   * @param aspect - New aspect ratio.
   */
  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Position the camera for the current frame.
   *
   * @param car - The hero robotaxi to ride, watch, or chase.
   */
  update(car: Robotaxi): void {
    if (this.mode === "passenger") {
      this.updatePassenger(car);
    } else if (this.mode === "pedestrian") {
      this.updatePedestrian();
    } else {
      this.updateOverhead(car);
    }
  }

  /**
   * Ride inside the car, seated behind the windshield looking down the road.
   *
   * The hero mesh is hidden while this view is active. A rider sitting inside
   * cannot see the outside of their own car, and leaving it visible put the
   * near plane inside the bodywork, which filled the screen with teal.
   */
  private updatePassenger(car: Robotaxi): void {
    this.tmpForward.set(Math.sin(car.heading), 0, Math.cos(car.heading));
    const base = car.root.position;
    // Seated eye height, set back slightly from the windshield line.
    this.camera.position.set(
      base.x - this.tmpForward.x * 0.35,
      base.y + 1.15,
      base.z - this.tmpForward.z * 0.35
    );
    this.tmpLook.set(
      base.x + this.tmpForward.x * 30,
      base.y + 0.75,
      base.z + this.tmpForward.z * 30
    );
    this.camera.lookAt(this.tmpLook);
  }

  /**
   * Walk the streets as the player-controlled pedestrian.
   *
   * The camera sits slightly behind and above the character's head looking
   * along its facing, which keeps the walker visible for orientation without
   * putting the near plane inside its own mesh.
   */
  private updatePedestrian(): void {
    this.tmpForward.set(
      Math.sin(this.pedestrianHeading),
      0,
      Math.cos(this.pedestrianHeading)
    );
    this.camera.position.set(
      this.pedestrianAnchor.x - this.tmpForward.x * 5.0,
      this.pedestrianAnchor.y + 1.9,
      this.pedestrianAnchor.z - this.tmpForward.z * 5.0
    );
    this.tmpLook.set(
      this.pedestrianAnchor.x + this.tmpForward.x * 18,
      this.pedestrianAnchor.y - 0.2,
      this.pedestrianAnchor.z + this.tmpForward.z * 18
    );
    this.camera.lookAt(this.tmpLook);
  }

  /** Float behind and above the taxi, smoothed so turns do not snap. */
  private updateOverhead(car: Robotaxi): void {
    const base = car.root.position;
    this.tmpForward.set(Math.sin(car.heading), 0, Math.cos(car.heading));
    const desired = new THREE.Vector3(
      base.x - this.tmpForward.x * 13,
      base.y + 9.5,
      base.z - this.tmpForward.z * 13
    );
    if (!this.initialised) {
      this.smoothed.copy(desired);
      this.initialised = true;
    } else {
      this.smoothed.lerp(desired, 0.08);
    }
    this.camera.position.copy(this.smoothed);
    this.camera.lookAt(base.x, base.y + 1.0, base.z);
  }
}
