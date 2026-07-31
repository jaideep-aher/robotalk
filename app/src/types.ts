/**
 * TypeScript mirror of the Pydantic command schema served by the backend.
 *
 * These types describe exactly what `/parse` returns so the simulator can act
 * on a command without re-parsing. They must stay in step with
 * `scripts/schema.py`.
 */

/** The discrete action the robotaxi may be asked to take. */
export type Intent =
  | "creep_forward"
  | "stop"
  | "pull_over"
  | "back_up"
  | "resume"
  | "change_destination"
  | "unlock_doors"
  | "wait"
  | "none";

/** Who is speaking to the car. */
export type ActorRole = "passenger" | "external";

/** Verdict of the safety gate. */
export type SafetyGate = "pass" | "reject" | "clarify";

/** Which backend produced a parse. */
export type Backend = "base" | "finetuned";

/** Optional numeric and symbolic arguments attached to an intent. */
export interface Parameters {
  distance_m: number | null;
  destination_node: string | null;
  duration_s: number | null;
}

/** A single fully-formed robotaxi command. */
export interface Command {
  intent: Intent;
  parameters: Parameters;
  actor_role: ActorRole;
  safety_gate: SafetyGate;
  gate_reason: string | null;
  clarification_question: string | null;
  response_speech: string;
}

/** The envelope returned by the `/parse` endpoint. */
export interface ParseResponse {
  ok: boolean;
  backend: Backend;
  model_id?: string;
  command?: Command;
  raw?: string;
  error?: string;
}
