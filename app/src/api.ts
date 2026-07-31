/**
 * Thin client for the backend `/parse` endpoint. The browser never sees the
 * OpenAI key; it only posts the utterance and actor role and receives a
 * validated command.
 */

import type { ActorRole, Backend, ParseResponse } from "./types";

/**
 * Parse an utterance into a command via the backend.
 *
 * @param utterance - The spoken text.
 * @param actorRole - The speaker role from character select.
 * @param backend - Which model to use, base or finetuned.
 * @returns The parse response envelope. Network failures are converted into an
 *   `ok: false` envelope so callers have a single error path.
 */
export async function parseCommand(
  utterance: string,
  actorRole: ActorRole,
  backend: Backend
): Promise<ParseResponse> {
  try {
    const response = await fetch(`/parse?backend=${encodeURIComponent(backend)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ utterance, actor_role: actorRole }),
    });
    if (!response.ok) {
      return {
        ok: false,
        backend,
        error: `backend HTTP ${response.status}`,
      };
    }
    return (await response.json()) as ParseResponse;
  } catch (err) {
    return {
      ok: false,
      backend,
      error: `network error: ${String(err)}`,
    };
  }
}

/**
 * Check backend health and whether the fine-tuned model is available.
 *
 * @returns An object with `finetunedAvailable`, defaulting to false on error.
 */
export async function checkHealth(): Promise<{ finetunedAvailable: boolean }> {
  try {
    const response = await fetch("/health");
    const data = await response.json();
    return { finetunedAvailable: Boolean(data.finetuned_available) };
  } catch {
    return { finetunedAvailable: false };
  }
}
