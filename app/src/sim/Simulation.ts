/**
 * Top-level simulation: builds the scene, drives the robotaxi, wires the UI to
 * the backend, and runs the render loop.
 *
 * The UI and render loop come up first so the player never faces a blank
 * screen; the city, the hero taxi, and the ambient life stream in behind a
 * readiness flag.
 */

import * as THREE from "three";
import { checkHealth, parseCommand } from "../api";
import { AssetLibrary } from "../assets";
import { GRID_BLOCKS } from "../config";
import { PLACES, placeNodeId, resolvePlace } from "../places";
import type { ActorRole, Backend, Command } from "../types";
import { mulberry32 } from "../util/rng";
import { CameraManager, ViewMode } from "../scene/Cameras";
import { CityGrid } from "../scene/CityGrid";
import { PlaceLabels } from "../scene/PlaceLabels";
import { PlayerPedestrian } from "../scene/PlayerPedestrian";
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
  private player: PlayerPedestrian | null = null;
  private labels: PlaceLabels | null = null;
  private traffic: NpcTraffic | null = null;
  private pedestrians: Pedestrians | null = null;

  private actorRole: ActorRole = "passenger";
  private viewMode: ViewMode = "passenger";
  private backend: Backend = "base";
  private started = false;
  private worldReady = false;
  private destinationCounter = 0;
  private heroStartNodeId = "";

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
   * Show the UI and start rendering immediately, then load the world in the
   * background so the user never faces a blank screen while assets download.
   */
  async init(): Promise<void> {
    this.buildOverlay();
    void checkHealth().then((h) => this.overlay.setFinetunedAvailable(h.finetunedAvailable));
    new CharacterSelect(this.container, (mode) => this.onCharacterChosen(mode));

    if (import.meta.env.DEV) {
      (window as unknown as { __rt: unknown }).__rt = {
        scene: this.scene,
        cameras: this.cameras,
        getCar: () => this.car,
        getTraffic: () => this.traffic,
        /**
         * Step the vehicle systems without rendering, so traffic behaviour can
         * be stress-tested far faster than real time.
         */
        step: (dt: number) => {
          const positions = this.traffic?.positions() ?? [];
          this.car.update(dt, positions);
          this.traffic?.update(dt, this.car.worldPosition);
        },
      };
    }
    this.loop();

    await this.city.build();
    this.scene.scene.add(this.city.root);

    this.labels = new PlaceLabels(this.city.graph);
    this.labels.build();
    this.scene.scene.add(this.labels.root);

    const mid = Math.floor(GRID_BLOCKS / 2);
    this.heroStartNodeId = `${mid},${mid}`;
    this.car = new Robotaxi(this.city.graph, this.rng);
    await this.car.load(this.assets, this.heroStartNodeId);
    this.scene.scene.add(this.car.root);

    await this.spawnPlayer();
    this.worldReady = true;

    void this.loadAmbientLife();
  }

  /** Create the player-controlled pedestrian near a central corner. */
  private async spawnPlayer(): Promise<void> {
    const corner = this.city.graph.node("1,1")!;
    const offset = this.city.tileSize * 0.4;
    this.player = new PlayerPedestrian();
    await this.player.load(
      new THREE.Vector3(corner.pos.x + offset, 0, corner.pos.z + offset)
    );
    this.scene.scene.add(this.player.root);
  }

  /** Construct the overlay and connect its handlers. */
  private buildOverlay(): void {
    this.overlay = new Overlay(this.container, {
      onSubmit: (text) => void this.handleUtterance(text),
      onMic: () => this.startDictation(),
      onBackendChange: (backend) => {
        this.backend = backend;
      },
      onViewChange: (mode) => this.setViewMode(mode),
      onHail: () => this.hailRobotaxi(),
      onResume: () => this.resumeCruising(),
      onPickPlace: (name) => void this.handleUtterance(`take me to ${name}`),
    });
    this.overlay.setMicSupported(this.recognizer.supported);
    this.overlay.setViewMode(this.viewMode);
  }

  /**
   * React to the character choice: set view mode and actor role.
   *
   * @param mode - The chosen viewpoint.
   */
  private onCharacterChosen(mode: ViewMode): void {
    this.setViewMode(mode);
    this.started = true;
  }

  /**
   * Switch the point of view at any time. The actor role follows the view,
   * since who you are is what the safety gate reasons about: riding inside
   * makes you the passenger, standing on the street makes you an outsider.
   *
   * @param mode - The viewpoint to switch to.
   */
  private setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.actorRole = mode === "pedestrian" ? "external" : "passenger";
    this.cameras.setMode(mode);
    this.overlay.setViewMode(mode);
  }

  /** Send the taxi to pick the player up wherever they are standing. */
  private hailRobotaxi(): void {
    if (!this.worldReady || !this.car) return;
    const rider = this.player?.root.position ?? new THREE.Vector3();
    this.car.hailTo(rider);
    this.overlay.setStatus("Robotaxi is on its way to you.");
    speak("On my way to pick you up.");
  }

  /** Send the taxi back out cruising after it has stopped or arrived. */
  private resumeCruising(): void {
    if (!this.worldReady || !this.car) return;
    this.car.resumeFreeRoam();
    this.overlay.setStatus("Cruising the city.");
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
    if (!response.ok || !response.command) {
      this.overlay.showResult(response, response.error ?? "no action");
      return;
    }

    const command = response.command;
    let action = actionDescription(command);

    if (command.safety_gate === "pass") {
      action = this.applyPassedCommand(command, utterance) ?? action;
    }

    this.overlay.showResult(response, action);
    speak(command.response_speech);
  }

  /**
   * Apply a command the gate let through, resolving named destinations.
   *
   * @param command - The validated command.
   * @param utterance - The original text, used to name a destination.
   * @returns An overriding action description, or null to keep the default.
   */
  private applyPassedCommand(command: Command, utterance: string): string | null {
    if (command.intent === "change_destination") {
      const { place } = resolvePlace(
        command.parameters.destination_node ?? utterance,
        this.destinationCounter++
      );
      this.car?.routeTo(placeNodeId(place), place.name);
      this.overlay.setStatus(`Heading to ${place.name}.`);
      return `Routing to ${place.name}`;
    }
    this.car?.applyCommand(command);
    if (command.intent === "stop" || command.intent === "pull_over") {
      this.overlay.setStatus("Stopped.");
    }
    return null;
  }

  /** Load Tier 2 NPC cars and pedestrians without blocking Tier 1. */
  private async loadAmbientLife(): Promise<void> {
    try {
      this.traffic = new NpcTraffic(
        this.city.graph,
        this.assets,
        this.rng,
        this.heroStartNodeId
      );
      await this.traffic.load();
      this.scene.scene.add(this.traffic.root);

      this.pedestrians = new Pedestrians(this.city.graph, this.assets, this.rng);
      await this.pedestrians.load();
      this.scene.scene.add(this.pedestrians.root);
    } catch (err) {
      // Ambient life is decorative; Tier 1 must not fail if it cannot load.
      console.warn("Ambient life failed to load:", err);
    }
  }

  /** The main render loop. */
  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.started && this.worldReady && this.car) {
      const traffic = this.traffic?.positions() ?? [];
      this.car.update(dt, traffic);
      this.traffic?.update(dt, this.car.worldPosition);
      this.pedestrians?.update(dt);

      this.player?.update(dt);
      if (this.viewMode === "pedestrian" && this.player) {
        this.cameras.setPedestrianAnchor(this.player.eyePosition, this.player.heading);
      }

      if (this.car.arrived) {
        this.car.arrived = false;
        const name = this.car.destinationName ?? "your destination";
        this.overlay.setStatus(`Arrived at ${name}.`);
        speak(`We have arrived at ${name}.`);
      }

      this.cameras.update(this.car);
      this.labels?.update(this.cameras.camera.position);
    }
    this.scene.render(this.cameras.camera);
  };
}

/** Names of the landmarks, re-exported for convenience in the UI. */
export const PLACE_NAMES = PLACES.map((p) => p.name);
