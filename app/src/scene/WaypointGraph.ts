/**
 * The waypoint graph the robotaxi and NPC cars drive on.
 *
 * Nodes sit at road intersections, laid out as a (B+1) x (B+1) lattice for a
 * B-block city. Edges connect orthogonally adjacent intersections and follow
 * road centrelines. Everything downstream (driving, routing, re-routing) works
 * purely in terms of node ids, so there is no physics and no free movement.
 */

import * as THREE from "three";
import { GRID_BLOCKS, GRID_TILES } from "../config";

/** A single intersection node. */
export interface WaypointNode {
  id: string;
  /** Grid coordinates in [0, GRID_BLOCKS]. */
  gx: number;
  gy: number;
  /** World-space position at the road surface. */
  pos: THREE.Vector3;
}

/**
 * Builds and queries the intersection lattice.
 */
export class WaypointGraph {
  readonly nodes = new Map<string, WaypointNode>();
  private readonly adjacency = new Map<string, string[]>();

  /**
   * Construct the lattice for the configured block grid.
   *
   * @param tileSize - World size of one road tile, used to space nodes.
   */
  constructor(private readonly tileSize: number) {
    this.build();
  }

  /**
   * Compose a node id from grid coordinates.
   *
   * @param gx - Grid x in [0, GRID_BLOCKS].
   * @param gy - Grid y in [0, GRID_BLOCKS].
   * @returns The canonical node id.
   */
  static idOf(gx: number, gy: number): string {
    return `${gx},${gy}`;
  }

  /**
   * World position of the tile at tile-grid coordinates, centred on the origin.
   *
   * @param tileX - Tile column in [0, GRID_TILES).
   * @param tileZ - Tile row in [0, GRID_TILES).
   * @returns The world position at ground level.
   */
  worldOfTile(tileX: number, tileZ: number): THREE.Vector3 {
    const half = (GRID_TILES - 1) / 2;
    return new THREE.Vector3(
      (tileX - half) * this.tileSize,
      0,
      (tileZ - half) * this.tileSize
    );
  }

  /** Build all nodes and their orthogonal adjacency. */
  private build(): void {
    for (let gx = 0; gx <= GRID_BLOCKS; gx++) {
      for (let gy = 0; gy <= GRID_BLOCKS; gy++) {
        const id = WaypointGraph.idOf(gx, gy);
        this.nodes.set(id, { id, gx, gy, pos: this.worldOfTile(gx * 2, gy * 2) });
        this.adjacency.set(id, []);
      }
    }
    for (const node of this.nodes.values()) {
      const candidates = [
        [node.gx + 1, node.gy],
        [node.gx - 1, node.gy],
        [node.gx, node.gy + 1],
        [node.gx, node.gy - 1],
      ];
      for (const [nx, ny] of candidates) {
        const neighborId = WaypointGraph.idOf(nx, ny);
        if (this.nodes.has(neighborId)) {
          this.adjacency.get(node.id)!.push(neighborId);
        }
      }
    }
  }

  /**
   * Neighbour node ids for a node.
   *
   * @param id - The node id.
   * @returns Adjacent node ids (empty if unknown).
   */
  neighbors(id: string): string[] {
    return this.adjacency.get(id) ?? [];
  }

  /**
   * Look up a node by id.
   *
   * @param id - The node id.
   * @returns The node, or undefined if absent.
   */
  node(id: string): WaypointNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Pick a random node, optionally excluding one.
   *
   * @param rng - A function returning a float in [0, 1).
   * @param exclude - An id to avoid, if possible.
   * @returns A node id.
   */
  randomNode(rng: () => number, exclude?: string): string {
    const ids = [...this.nodes.keys()].filter((id) => id !== exclude);
    return ids[Math.floor(rng() * ids.length)];
  }

  /**
   * Shortest node path between two nodes via breadth-first search.
   *
   * @param from - Start node id.
   * @param to - Goal node id.
   * @returns A list of node ids from `from` to `to` inclusive, or an empty list
   *   if unreachable.
   */
  route(from: string, to: string): string[] {
    if (from === to) return [from];
    const queue: string[] = [from];
    const cameFrom = new Map<string, string | null>([[from, null]]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of this.neighbors(current)) {
        if (!cameFrom.has(next)) {
          cameFrom.set(next, current);
          if (next === to) {
            return this.reconstruct(cameFrom, to);
          }
          queue.push(next);
        }
      }
    }
    return [];
  }

  /**
   * Rebuild a path from the BFS predecessor map.
   *
   * @param cameFrom - Predecessor map.
   * @param to - Goal node id.
   * @returns The ordered path from start to goal.
   */
  private reconstruct(cameFrom: Map<string, string | null>, to: string): string[] {
    const path: string[] = [];
    let current: string | null = to;
    while (current) {
      path.unshift(current);
      current = cameFrom.get(current) ?? null;
    }
    return path;
  }

  /**
   * Find the node nearest to a world point.
   *
   * @param point - The world-space point.
   * @returns The nearest node.
   */
  nearestNode(point: THREE.Vector3): WaypointNode {
    let best: WaypointNode | undefined;
    let bestDist = Infinity;
    for (const node of this.nodes.values()) {
      const dist = node.pos.distanceToSquared(point);
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
    return best!;
  }
}
