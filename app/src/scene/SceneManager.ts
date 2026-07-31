/**
 * Owns the renderer, the scene, and the dusk lighting rig.
 *
 * The look is a single cohesive dusk: a warm-to-cool gradient sky dome, matching
 * fog for depth, a low warm key light, and gentle fill so the emissive building
 * windows read against the dimming sky.
 */

import * as THREE from "three";
import { FOG, PALETTE } from "../config";

/**
 * Sets up and holds the Three.js renderer, scene, and lights.
 */
export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;

  /**
   * @param container - The DOM element to mount the canvas into.
   */
  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.Fog(PALETTE.fog, FOG.near, FOG.far);
    this.addSky();
    this.addLights();

    window.addEventListener("resize", () => this.onResize());
  }

  /** Add a gradient sky dome that also tints the horizon warm. */
  private addSky(): void {
    const uniforms = {
      topColor: { value: new THREE.Color(PALETTE.skyTop) },
      bottomColor: { value: new THREE.Color(PALETTE.skyBottom) },
      offset: { value: 8 },
      exponent: { value: 0.7 },
    };
    const skyGeo = new THREE.SphereGeometry(400, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          float t = max(pow(max(h, 0.0), exponent), 0.0);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
  }

  /** Add the dusk lighting rig: hemisphere fill, warm key, soft ambient. */
  private addLights(): void {
    const hemi = new THREE.HemisphereLight(0xffd3a0, PALETTE.ground, 1.05);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(PALETTE.ambient, 0.55);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(PALETTE.sun, 2.6);
    sun.position.set(-30, 26, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    const extent = 60;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  /** Current drawing-buffer aspect ratio. */
  get aspect(): number {
    return this.container.clientWidth / this.container.clientHeight;
  }

  /**
   * Render one frame with the given camera.
   *
   * @param camera - The active camera.
   */
  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

  /** Resize the renderer to the container and notify listeners via cameras. */
  private onResize(): void {
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }
}
