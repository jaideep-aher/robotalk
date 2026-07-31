/**
 * Maps a validated command to a short human-readable description of the action
 * the simulator will take, for the overlay's "action" line. The mapping mirrors
 * the behaviour in {@link Robotaxi.applyCommand}.
 */

import type { Command } from "../types";
import { DRIVE } from "../config";

/**
 * Describe the sim action for a command, honouring the safety gate.
 *
 * @param command - The validated command.
 * @returns A short description such as "Creeping forward 3 m".
 */
export function actionDescription(command: Command): string {
  if (command.safety_gate === "reject") {
    return "No motion (rejected)";
  }
  if (command.safety_gate === "clarify") {
    return "No motion (awaiting clarification)";
  }
  switch (command.intent) {
    case "creep_forward":
      return `Creeping forward ${command.parameters.distance_m ?? DRIVE.creepDefaultMeters} m`;
    case "back_up":
      return `Reversing ${command.parameters.distance_m ?? DRIVE.backupDefaultMeters} m`;
    case "pull_over":
      return "Pulling over to the curb";
    case "stop":
      return "Stopping";
    case "wait":
      return `Waiting ${command.parameters.duration_s ?? 3} s`;
    case "resume":
      return "Resuming the route";
    case "change_destination":
      return "Re-routing to a new destination";
    case "unlock_doors":
      return "Unlocking and opening the doors";
    case "none":
      return "No action";
  }
}
