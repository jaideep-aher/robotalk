/**
 * glTF asset loading and caching for the simulator.
 *
 * Kenney kits ship one GLB per model. This module loads them once, caches the
 * parsed scene, and hands out fresh clones so many instances can share a single
 * network fetch. It also applies the dusk look: warm emissive windows and a
 * teal override for the hero robotaxi.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PALETTE } from "./config";

/** A loaded model plus its measured bounding box. */
export interface LoadedModel {
  scene: THREE.Group;
  size: THREE.Vector3;
  center: THREE.Vector3;
}

/**
 * Loads and caches glTF models, returning clones on demand.
 */
export class AssetLibrary {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<LoadedModel>>();

  /**
   * Load a model by URL, caching the result.
   *
   * @param url - Absolute URL of the GLB, served from `public`.
   * @returns The loaded model wrapper (shared, do not mutate; clone instead).
   */
  load(url: string): Promise<LoadedModel> {
    const cached = this.cache.get(url);
    if (cached) {
      return cached;
    }
    const promise = new Promise<LoadedModel>((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const scene = gltf.scene;
          scene.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });
          const box = new THREE.Box3().setFromObject(scene);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);
          resolve({ scene, size, center });
        },
        undefined,
        (err) => reject(err)
      );
    });
    this.cache.set(url, promise);
    return promise;
  }

  /**
   * Load a model and return a fresh, independently transformable clone.
   *
   * @param url - Absolute URL of the GLB.
   * @returns A clone of the model's scene graph.
   */
  async instance(url: string): Promise<THREE.Group> {
    const model = await this.load(url);
    return cloneWithMaterials(model.scene);
  }
}

/**
 * Deep-clone a scene while giving each mesh its own material instance, so
 * per-instance tweaks (emissive windows, a teal hero) do not leak across
 * clones that share a cached source.
 *
 * @param source - The source group to clone.
 * @returns The cloned group with cloned materials.
 */
export function cloneWithMaterials(source: THREE.Group): THREE.Group {
  const clone = source.clone(true);
  clone.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => m.clone());
      } else {
        mesh.material = mesh.material.clone();
      }
    }
  });
  return clone;
}

/**
 * Give a building a warm dusk self-glow.
 *
 * Kenney buildings are a single mesh textured from a shared palette atlas, so
 * individual windows cannot be isolated by material. Instead the whole surface
 * is made subtly emissive through its own colour map, which makes the brighter
 * texels (window strips and lit faces) read as glowing at dusk.
 *
 * @param building - The building group to light up.
 */
export function lightWindows(building: THREE.Group): void {
  building.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (!("emissive" in standard)) continue;
      standard.emissive = new THREE.Color(PALETTE.emissiveWindow);
      standard.emissiveMap = standard.map ?? null;
      standard.emissiveIntensity = 0.45;
      standard.needsUpdate = true;
    }
  });
}

/**
 * Recolour the hero robotaxi to a solid teal.
 *
 * Kenney cars are one mesh with one palette-textured material, so the body
 * cannot be recoloured without also touching wheels and glass. The hero is
 * therefore given a clean flat teal material, which reads unmistakably as the
 * hero vehicle against the textured NPC cars.
 *
 * @param car - The car group to tint.
 * @param color - The target body colour.
 */
export function tintCarBody(car: THREE.Group, color: number): void {
  const teal = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.35,
    emissive: new THREE.Color(color).multiplyScalar(0.12),
  });
  car.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.material = teal;
    }
  });
}
