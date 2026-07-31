/**
 * Camera rigs for the two points of view.
 *
 * Passenger rides inside the robotaxi looking out through the windshield.
 * Pedestrian stands at a street corner and watches the taxi go by. The
 * pedestrian anchor can be moved (Tier 2 attaches it to a walking NPC).
 */

import * as THREE from "three";
import type { Robotaxi } from "./Robotaxi";

/** Which viewpoint is active. */
export type ViewMode = "passenger" | "pedestrian";

/**
 * Owns the single perspective camera and positions it per view mode each frame.
 */
export class CameraManager {
  readonly camera: THREE.PerspectiveCamera;
  private mode: ViewMode = "passenger";
  private pedestrianAnchor = new THREE.Vector3(0, 1.6, 0);
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpLook = new THREE.Vector3();

  /**
   * @param aspect - Initial viewport aspect ratio.
   */
  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 600);
  }

  /**
   * Set the active view mode.
   *
   * @param mode - The viewpoint to switch to.
   */
  setMode(mode: ViewMode): void {
    this.mode = mode;
  }

  /**
   * Move the pedestrian standpoint (used by the character select and Tier 2).
   *
   * @param position - World position of the observer's eyes.
   */
  setPedestrianAnchor(position: THREE.Vector3): void {
    this.pedestrianAnchor.copy(position);
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
   * @param car - The hero robotaxi to ride in or watch.
   */
  update(car: Robotaxi): void {
    if (this.mode === "passenger") {
      this.updatePassenger(car);
    } else {
      this.updatePedestrian(car);
    }
  }

  /** Ride inside the car, eyes just behind the windshield, looking ahead. */
  private updatePassenger(car: Robotaxi): void {
    this.tmpForward.set(Math.sin(car.heading), 0, Math.cos(car.heading));
    const base = car.root.position;
    this.camera.position.set(
      base.x + this.tmpForward.x * 0.4,
      base.y + 1.5,
      base.z + this.tmpForward.z * 0.4
    );
    this.tmpLook.set(
      base.x + this.tmpForward.x * 24,
      base.y + 1.1,
      base.z + this.tmpForward.z * 24
    );
    this.camera.lookAt(this.tmpLook);
  }

  /** Stand at the corner and follow the taxi with your gaze. */
  private updatePedestrian(car: Robotaxi): void {
    this.camera.position.copy(this.pedestrianAnchor);
    this.camera.lookAt(car.root.position.x, 0.8, car.root.position.z);
  }
}
