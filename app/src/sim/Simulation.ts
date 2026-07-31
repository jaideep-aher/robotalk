/**
 * Top-level simulation: builds the scene, drives the robotaxi, wires the UI to
 * the backend, and runs the render loop. Tier 1 lives here end to end; Tier 2
 * ambient life is attached through optional hooks kept isolated below.
 */

import * as THREE from "three";
import { checkHealth, parseCommand } from "../api";
import { AssetLibrary } from "../assets";
import { GRID_BLOCKS } from "../config";
import type { ActorRole, Backend } from "../types";
import { mulberry32 } from "../util/rng";
import { CameraManager, ViewMode } from "../scene/Cameras";
import { CityGrid } from "../scene/CityGrid";
import { Robotaxi } from "../scene/Robotaxi";
import { SceneManager } from "../scene/SceneManager";
import { NpcTraffic } from "../scene/NpcTraffic";
import { Pedestrians } from "../scene/Pedestrians";
import { CharacterSelect } from "../ui/CharacterSelect";
import { Overlay } from "../ui/Overlay";
import { speak, SpeechRecognizer } from "../ui/speech";
import { actionDescription } from "./commands";

/**
 * Owns and coordinates every part of the running simulator.
 */
export class Simulation {
  private readonly scene: SceneManager;
  private readonly assets = new AssetLibrary();
  private readonly city: CityGrid;
  private readonly cameras: CameraManager;
  private readonly recognizer = new SpeechRecognizer();
  private readonly clock = new THREE.Clock();
  private readonly rng = mulberry32(0xc0ffee);

  private car!: Robotaxi;
  private overlay!: Overlay;
  private traffic: NpcTraffic | null = null;
  private pedestrians: Pedestrians | null = null;

  private actorRole: ActorRole = "passenger";
  private viewMode: ViewMode = "passenger";
  private backend: Backend = "base";
  private started = false;

  /**
   * @param container - The root element to mount the canvas and UI into.
   */
  constructor(private readonly container: HTMLElement) {
    this.scene = new SceneManager(container);
    this.city = new CityGrid(this.assets);
    this.cameras = new CameraManager(this.scene.aspect);
    window.addEventListener("resize", () => {
      this.cameras.setAspect(this.scene.aspect);
    });
  }

  /**
   * Build the world and show the character-select screen.
   */
  async init(): Promise<void> {
    await this.city.build();
    this.scene.scene.add(this.city.root);

    const mid = Math.floor(GRID_BLOCKS / 2);
    const startNode = `${mid},${mid}`;
    this.car = new Robotaxi(this.city.graph, this.rng);
    await this.car.load(this.assets, startNode);
    this.scene.scene.add(this.car.root);

    this.positionPedestrianCorner();
    this.buildOverlay();

    void checkHealth().then((h) => this.overlay.setFinetunedAvailable(h.finetunedAvailable));

    new CharacterSelect(this.container, (mode) => this.onCharacterChosen(mode));

    // Development-only handle for inspecting the scene from the console.
    if (import.meta.env.DEV) {
      (window as unknown as { __rt: unknown }).__rt = {
        scene: this.scene,
        cameras: this.cameras,
        getCar: () => this.car,
      };
    }
    this.loop();

    // Tier 2 ambient life loads in the background once Tier 1 is interactive.
    void this.loadAmbientLife();
  }

  /** Anchor the pedestrian camera at a corner of a central intersection. */
  private positionPedestrianCorner(): void {
    const corner = this.city.graph.node("1,1")!;
    const offset = this.city.tileSize * 0.42;
    this.cameras.setPedestrianAnchor(
      new THREE.Vector3(corner.pos.x + offset, 1.6, corner.pos.z + offset)
    );
  }

  /** Construct the overlay and connect its handlers. */
  private buildOverlay(): void {
    this.overlay = new Overlay(this.container, {
      onSubmit: (text) => void this.handleUtterance(text),
      onMic: () => this.startDictation(),
      onBackendChange: (backend) => {
        this.backend = backend;
      },
    });
    this.overlay.setMicSupported(this.recognizer.supported);
  }

  /**
   * React to the character choice: set view mode and actor role.
   *
   * @param mode - The chosen viewpoint.
   */
  private onCharacterChosen(mode: ViewMode): void {
    this.viewMode = mode;
    this.actorRole = mode === "passenger" ? "passenger" : "external";
    this.cameras.setMode(mode);
    this.started = true;
    if (mode === "pedestrian" && this.pedestrians) {
      this.attachPedestrianCamera();
    }
  }

  /** Begin a one-shot dictation, feeding the transcript through the pipeline. */
  private startDictation(): void {
    if (!this.recognizer.supported) return;
    this.overlay.setMicActive(true);
    this.recognizer.listenOnce(
      (text) => void this.handleUtterance(text),
      () => this.overlay.setMicActive(false)
    );
  }

  /**
   * Run one utterance through parse, display, drive, and speak.
   *
   * @param utterance - The raw spoken or typed text.
   */
  private async handleUtterance(utterance: string): Promise<void> {
    this.overlay.showPending(utterance);
    const response = await parseCommand(utterance, this.actorRole, this.backend);
    if (response.ok && response.command) {
      this.overlay.showResult(response, actionDescription(response.command));
      this.car.applyCommand(response.command);
      speak(response.command.response_speech);
    } else {
      this.overlay.showResult(response, response.error ?? "no action");
    }
  }

  /** Load Tier 2 NPC cars and pedestrians without blocking Tier 1. */
  private async loadAmbientLife(): Promise<void> {
    try {
      this.traffic = new NpcTraffic(this.city.graph, this.assets, this.rng);
      await this.traffic.load();
      this.scene.scene.add(this.traffic.root);

      this.pedestrians = new Pedestrians(this.city.graph, this.assets, this.rng);
      await this.pedestrians.load();
      this.scene.scene.add(this.pedestrians.root);

      if (this.viewMode === "pedestrian") {
        this.attachPedestrianCamera();
      }
    } catch (err) {
      // Ambient life is decorative; Tier 1 must not fail if it cannot load.
      console.warn("Ambient life failed to load:", err);
    }
  }

  /** Attach the pedestrian camera to a walking NPC at a corner, if available. */
  private attachPedestrianCamera(): void {
    const anchor = this.pedestrians?.cornerObserver();
    if (anchor) {
      this.cameras.setPedestrianAnchor(anchor);
    }
  }

  /** The main render loop. */
  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.started) {
      this.car.update(dt);
      this.traffic?.update(dt);
      this.pedestrians?.update(dt);
      if (this.viewMode === "pedestrian") {
        this.attachPedestrianCamera();
      }
      this.cameras.update(this.car);
    }
    this.scene.render(this.cameras.camera);
  };
}
