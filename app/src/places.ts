/**
 * Named destinations the robotaxi can drive to.
 *
 * Each place is pinned to an intersection node (by grid coordinates) so the
 * waypoint router can route there, and carries a display name shown on a 3D
 * label and in the destinations list. Keeping the list here lets the UI, the
 * labels, and the command resolver all agree on the same set of places.
 */

import { WaypointGraph } from "./scene/WaypointGraph";

/** A named place on the map. */
export interface Place {
  /** Display name. */
  name: string;
  /** Grid coordinates of the intersection node it sits on. */
  gx: number;
  gy: number;
}

/**
 * San Francisco landmarks, one on every intersection of the lattice so there
 * is always somewhere named to be sent, and a label in view wherever you are.
 */
export const PLACES: Place[] = [
  { name: "Golden Gate Bridge", gx: 0, gy: 0 },
  { name: "Palace of Fine Arts", gx: 1, gy: 0 },
  { name: "Y Combinator", gx: 2, gy: 0 },
  { name: "Lombard Street", gx: 3, gy: 0 },
  { name: "Corgi Cafe", gx: 4, gy: 0 },

  { name: "Presidio", gx: 0, gy: 1 },
  { name: "Painted Ladies", gx: 1, gy: 1 },
  { name: "Coit Tower", gx: 2, gy: 1 },
  { name: "Chinatown Gate", gx: 3, gy: 1 },
  { name: "North Beach", gx: 4, gy: 1 },

  { name: "Mission Dolores", gx: 0, gy: 2 },
  { name: "Castro Theatre", gx: 1, gy: 2 },
  { name: "Union Square", gx: 2, gy: 2 },
  { name: "Transamerica Pyramid", gx: 3, gy: 2 },
  { name: "Salesforce Tower", gx: 4, gy: 2 },

  { name: "Haight and Ashbury", gx: 0, gy: 3 },
  { name: "Twin Peaks", gx: 1, gy: 3 },
  { name: "Dolores Park", gx: 2, gy: 3 },
  { name: "Moscone Center", gx: 3, gy: 3 },
  { name: "Embarcadero", gx: 4, gy: 3 },

  { name: "Ferry Building", gx: 0, gy: 4 },
  { name: "Sutro Baths", gx: 1, gy: 4 },
  { name: "Oracle Park", gx: 2, gy: 4 },
  { name: "Ghirardelli Square", gx: 3, gy: 4 },
  { name: "Fisherman's Wharf", gx: 4, gy: 4 },
];

/**
 * The node id a place sits on.
 *
 * @param place - The place.
 * @returns The waypoint node id.
 */
export function placeNodeId(place: Place): string {
  return WaypointGraph.idOf(place.gx, place.gy);
}

/**
 * Resolve free text (a model's destination_node, or the raw utterance) to a
 * place by case-insensitive name match, falling back to a deterministic pick.
 *
 * @param text - The destination text or utterance to match.
 * @param fallbackIndex - Index used to pick a place when nothing matches.
 * @returns The resolved place and whether it was an explicit name match.
 */
export function resolvePlace(
  text: string | null | undefined,
  fallbackIndex: number
): { place: Place; matched: boolean } {
  const haystack = (text ?? "").toLowerCase();
  for (const place of PLACES) {
    if (haystack.includes(place.name.toLowerCase())) {
      return { place, matched: true };
    }
  }
  const place = PLACES[Math.abs(fallbackIndex) % PLACES.length];
  return { place, matched: false };
}
