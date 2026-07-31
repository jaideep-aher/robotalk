/**
 * Building signage for the city's landmarks.
 *
 * Each label is mounted just above the roof of the building it names, so it
 * reads as a sign belonging to that building rather than text floating over the
 * street. Sprites always face the camera, so no per-frame orientation work is
 * needed.
 */

import * as THREE from "three";
import { PLACES, type Place } from "../places";
import type { WaypointGraph } from "./WaypointGraph";

/** Clearance between a building's roof and its sign, in metres. */
const ROOF_CLEARANCE = 1.1;
/** Hide a sign closer than this, so it never fills a street-level view. */
const HIDE_WITHIN = 9;
/** Sign width in metres; the height follows the canvas aspect ratio. */
const SIGN_WIDTH = 6.4;

/** A building a sign can be mounted on. */
export interface LabelSite {
  position: THREE.Vector3;
  top: number;
}

/**
 * Builds and owns the landmark signs.
 */
export class PlaceLabels {
  readonly root = new THREE.Group();

  /**
   * @param graph - The waypoint graph, used to find each place's location.
   */
  constructor(private readonly graph: WaypointGraph) {}

  /**
   * Mount one sign per place, on the building nearest that place's node.
   *
   * Each building takes at most one sign, so two landmarks never end up
   * stacked on the same roof.
   *
   * @param sites - The buildings available to mount signs on.
   */
  build(sites: LabelSite[]): void {
    const taken = new Set<number>();

    for (const place of PLACES) {
      const node = this.graph.node(`${place.gx},${place.gy}`);
      if (!node) continue;

      let bestIndex = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < sites.length; i += 1) {
        if (taken.has(i)) continue;
        const distance = sites[i].position.distanceToSquared(node.pos);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }
      if (bestIndex === -1) continue;
      taken.add(bestIndex);

      const site = sites[bestIndex];
      const sprite = this.makeSprite(place);
      sprite.position.set(
        site.position.x,
        site.top + ROOF_CLEARANCE,
        site.position.z
      );
      this.root.add(sprite);
    }
  }

  /**
   * Fade out signs the camera is standing under, so they never blot out a
   * street-level view.
   *
   * @param cameraPosition - Current camera world position.
   */
  update(cameraPosition: THREE.Vector3): void {
    for (const sprite of this.root.children) {
      sprite.visible = sprite.position.distanceTo(cameraPosition) > HIDE_WITHIN;
    }
  }

  /**
   * Draw a place name onto a canvas and wrap it in a camera-facing sprite.
   *
   * @param place - The place to label.
   * @returns The configured sprite.
   */
  private makeSprite(place: Place): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 112;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "rgba(20, 18, 31, 0.9)";
    this.roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 232, 157, 0.85)";
    ctx.lineWidth = 3;
    this.roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 18);
    ctx.stroke();

    // Shrink the type until the longest names still fit the plate.
    let fontSize = 46;
    do {
      ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
      fontSize -= 2;
    } while (ctx.measureText(place.name).width > canvas.width - 48 && fontSize > 18);

    ctx.fillStyle = "#f5f7fa";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(place.name, canvas.width / 2, canvas.height / 2 + 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        // Scene fog would darken these into slabs at a distance.
        fog: false,
      })
    );
    sprite.scale.set(SIGN_WIDTH, SIGN_WIDTH * (canvas.height / canvas.width), 1);
    sprite.renderOrder = 2;
    return sprite;
  }

  /**
   * Trace a rounded rectangle path.
   *
   * @param ctx - Canvas 2D context.
   * @param x - Left edge.
   * @param y - Top edge.
   * @param w - Width.
   * @param h - Height.
   * @param r - Corner radius.
   */
  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
