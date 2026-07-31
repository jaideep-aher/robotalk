/**
 * Floating 3D name labels for the city's landmarks.
 *
 * Each label is a canvas-drawn sprite hovering above its intersection, so the
 * player can see where they are and name a destination out loud ("take me to
 * the Grand Hotel"). Sprites always face the camera, so no orientation work is
 * needed per frame.
 */

import * as THREE from "three";
import { PLACES, type Place } from "../places";
import type { WaypointGraph } from "./WaypointGraph";

const LABEL_HEIGHT = 7.5; // metres above the road

/**
 * Builds and owns the landmark label sprites.
 */
export class PlaceLabels {
  readonly root = new THREE.Group();

  /**
   * @param graph - The waypoint graph, for node positions.
   */
  constructor(private readonly graph: WaypointGraph) {}

  /** Create one sprite per place. */
  build(): void {
    for (const place of PLACES) {
      const node = this.graph.node(`${place.gx},${place.gy}`);
      if (!node) continue;
      const sprite = this.makeSprite(place);
      sprite.position.set(node.pos.x, LABEL_HEIGHT, node.pos.z);
      this.root.add(sprite);
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
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;

    // Rounded translucent plate.
    ctx.fillStyle = "rgba(24, 21, 38, 0.82)";
    this.roundRect(ctx, 6, 6, canvas.width - 12, canvas.height - 12, 26);
    ctx.fill();
    ctx.strokeStyle = "rgba(20, 184, 166, 0.9)";
    ctx.lineWidth = 4;
    this.roundRect(ctx, 6, 6, canvas.width - 12, canvas.height - 12, 26);
    ctx.stroke();

    ctx.font = "bold 54px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#f2ecff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(place.name, canvas.width / 2, canvas.height / 2 + 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(11, 2.75, 1);
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
