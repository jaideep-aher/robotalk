/**
 * The player-controlled pedestrian.
 *
 * When the Pedestrian point of view is chosen, the camera rides this character
 * instead of an autopilot NPC, so the player can walk around with WASD (or the
 * arrow keys) and look with Q/E. Movement is deliberately simple: walk speed on
 * the ground plane, clamped to the city bounds, with the walk animation playing
 * only while actually moving.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GRID_TILES, WORLD } from "../config";

const CHARACTER_URL = "/models/characters/RobotExpressive.glb";
const WALK_SPEED = 4.2; // metres per second
const TURN_SPEED = 2.4; // radians per second
const EYE_HEIGHT = 1.55;
const TARGET_HEIGHT = 1.9;

/**
 * A walking character the player steers with the keyboard.
 */
export class PlayerPedestrian {
  readonly root = new THREE.Group();
  /** Facing direction in radians. */
  heading = 0;

  private mixer: THREE.AnimationMixer | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private readonly keys = new Set<string>();
  private moving = false;
  private loaded = false;

  /** Create the pedestrian and start listening for key input. */
  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  /**
   * Load the character model and place it at a starting position.
   *
   * @param start - World position to spawn at.
   */
  async load(start: THREE.Vector3): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(CHARACTER_URL);
    const model = gltf.scene;

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    model.scale.setScalar(size.y > 0 ? TARGET_HEIGHT / size.y : 1);
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });

    this.mixer = new THREE.AnimationMixer(model);
    const clip =
      gltf.animations.find((c) => /walk/i.test(c.name)) ?? gltf.animations[0];
    if (clip) {
      this.walkAction = this.mixer.clipAction(clip);
      this.walkAction.play();
      this.walkAction.paused = true;
    }

    this.root.add(model);
    this.root.position.copy(start);
    this.loaded = true;
  }

  /**
   * Record a pressed key, ignoring input aimed at the command text box.
   *
   * @param event - The keyboard event.
   */
  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }
    this.keys.add(event.key.toLowerCase());
  };

  /**
   * Clear a released key.
   *
   * @param event - The keyboard event.
   */
  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  /**
   * Whether any of the given keys is currently held.
   *
   * @param names - Key names to test.
   * @returns True if at least one is down.
   */
  private held(...names: string[]): boolean {
    return names.some((n) => this.keys.has(n));
  }

  /**
   * Advance movement, turning, and the walk animation.
   *
   * @param dt - Delta time in seconds.
   */
  update(dt: number): void {
    if (!this.loaded) return;

    // Turning: A/D and the left/right arrows, plus Q/E as explicit look keys.
    let turn = 0;
    if (this.held("a", "arrowleft", "q")) turn += 1;
    if (this.held("d", "arrowright", "e")) turn -= 1;
    this.heading += turn * TURN_SPEED * dt;

    // Walking: W/S and the up/down arrows.
    let drive = 0;
    if (this.held("w", "arrowup")) drive += 1;
    if (this.held("s", "arrowdown")) drive -= 1;

    this.moving = drive !== 0;
    if (this.moving) {
      const forward = new THREE.Vector3(
        Math.sin(this.heading),
        0,
        Math.cos(this.heading)
      );
      this.root.position.addScaledVector(forward, drive * WALK_SPEED * dt);
      this.clampToCity();
    }
    this.root.rotation.y = this.heading;

    if (this.walkAction) {
      this.walkAction.paused = !this.moving;
    }
    this.mixer?.update(dt);
  }

  /** Keep the player inside the city footprint. */
  private clampToCity(): void {
    const limit = ((GRID_TILES - 1) / 2) * WORLD.tileMeters + WORLD.tileMeters * 0.4;
    this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -limit, limit);
    this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -limit, limit);
  }

  /** Eye-level world position, for the camera to ride. */
  get eyePosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.root.position.x,
      this.root.position.y + EYE_HEIGHT,
      this.root.position.z
    );
  }

  /** Remove keyboard listeners. */
  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
