/**
 * The persistent control-and-inspection overlay.
 *
 * It carries the text box, the mic button, the base/fine-tuned backend toggle,
 * and the pipeline readout that makes the parser legible: utterance, the raw
 * model JSON, the colour-coded gate decision, and the action the car took.
 */

import type { Backend, ParseResponse } from "../types";

/** Callbacks the overlay reports user intent through. */
export interface OverlayHandlers {
  onSubmit: (utterance: string) => void;
  onMic: () => void;
  onBackendChange: (backend: Backend) => void;
}

/**
 * Builds and updates the on-screen control panel.
 */
export class Overlay {
  private backendValue: Backend = "base";
  private readonly input: HTMLInputElement;
  private readonly micButton: HTMLButtonElement;
  private readonly backendToggle: HTMLButtonElement;
  private readonly utteranceEl: HTMLElement;
  private readonly jsonEl: HTMLElement;
  private readonly gateEl: HTMLElement;
  private readonly actionEl: HTMLElement;
  private readonly speechEl: HTMLElement;
  private finetunedAvailable = false;

  /**
   * @param container - Element to mount into.
   * @param handlers - User-intent callbacks.
   */
  constructor(container: HTMLElement, private readonly handlers: OverlayHandlers) {
    const panel = document.createElement("div");
    panel.className = "overlay";
    panel.innerHTML = `
      <div class="ov-row ov-controls">
        <button class="ov-backend" title="Toggle model backend">Base</button>
        <input class="ov-input" type="text" placeholder="Tell the robotaxi what to do..." />
        <button class="ov-mic" title="Speak">🎙️</button>
        <button class="ov-send">Send</button>
      </div>
      <div class="ov-pipeline">
        <div class="ov-stage"><span class="ov-label">utterance</span><div class="ov-utterance">—</div></div>
        <div class="ov-stage"><span class="ov-label">model JSON</span><pre class="ov-json">—</pre></div>
        <div class="ov-stage"><span class="ov-label">gate</span><div class="ov-gate">—</div></div>
        <div class="ov-stage"><span class="ov-label">action</span><div class="ov-action">—</div></div>
        <div class="ov-stage"><span class="ov-label">car says</span><div class="ov-speech">—</div></div>
      </div>
    `;
    container.appendChild(panel);

    this.input = panel.querySelector(".ov-input")!;
    this.micButton = panel.querySelector(".ov-mic")!;
    this.backendToggle = panel.querySelector(".ov-backend")!;
    this.utteranceEl = panel.querySelector(".ov-utterance")!;
    this.jsonEl = panel.querySelector(".ov-json")!;
    this.gateEl = panel.querySelector(".ov-gate")!;
    this.actionEl = panel.querySelector(".ov-action")!;
    this.speechEl = panel.querySelector(".ov-speech")!;

    const send = panel.querySelector<HTMLButtonElement>(".ov-send")!;
    send.addEventListener("click", () => this.submit());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.submit();
    });
    this.micButton.addEventListener("click", () => this.handlers.onMic());
    this.backendToggle.addEventListener("click", () => this.toggleBackend());
  }

  /** Read the input, fire the submit handler, and clear the field. */
  private submit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.handlers.onSubmit(text);
    this.input.value = "";
  }

  /** Flip the active backend between base and fine-tuned. */
  private toggleBackend(): void {
    if (this.backendValue === "base") {
      if (!this.finetunedAvailable) {
        this.backendToggle.classList.add("ov-shake");
        window.setTimeout(() => this.backendToggle.classList.remove("ov-shake"), 400);
        return;
      }
      this.backendValue = "finetuned";
      this.backendToggle.textContent = "Fine-tuned";
    } else {
      this.backendValue = "base";
      this.backendToggle.textContent = "Base";
    }
    this.backendToggle.dataset.backend = this.backendValue;
    this.handlers.onBackendChange(this.backendValue);
  }

  /** The currently selected backend. */
  get backend(): Backend {
    return this.backendValue;
  }

  /**
   * Record whether the fine-tuned model is ready, adjusting the toggle hint.
   *
   * @param available - True if `models/model_id.txt` exists on the server.
   */
  setFinetunedAvailable(available: boolean): void {
    this.finetunedAvailable = available;
    this.backendToggle.title = available
      ? "Toggle model backend (base / fine-tuned)"
      : "Fine-tuned model not ready yet";
  }

  /**
   * Reflect mic availability by disabling the button when unsupported.
   *
   * @param supported - Whether Web Speech recognition is available.
   */
  setMicSupported(supported: boolean): void {
    if (!supported) {
      this.micButton.disabled = true;
      this.micButton.title = "Voice input not supported in this browser; type instead";
    }
  }

  /** Toggle the mic button's active (listening) styling. */
  setMicActive(active: boolean): void {
    this.micButton.classList.toggle("ov-mic-active", active);
  }

  /**
   * Show that a request is in flight for an utterance.
   *
   * @param utterance - The text being parsed.
   */
  showPending(utterance: string): void {
    this.utteranceEl.textContent = utterance;
    this.jsonEl.textContent = "parsing...";
    this.gateEl.textContent = "…";
    this.gateEl.className = "ov-gate";
    this.actionEl.textContent = "—";
    this.speechEl.textContent = "—";
  }

  /**
   * Render a completed parse plus the action the simulator took.
   *
   * @param response - The `/parse` envelope.
   * @param actionText - Human-readable description of the sim action.
   */
  showResult(response: ParseResponse, actionText: string): void {
    if (!response.ok || !response.command) {
      this.jsonEl.textContent = response.raw ?? JSON.stringify(response, null, 2);
      this.gateEl.textContent = "error";
      this.gateEl.className = "ov-gate ov-gate-reject";
      this.actionEl.textContent = response.error ?? "no action";
      this.speechEl.textContent = "—";
      return;
    }
    const command = response.command;
    this.jsonEl.textContent = JSON.stringify(command, null, 2);
    this.gateEl.textContent = `${command.safety_gate}${
      command.gate_reason ? `: ${command.gate_reason}` : ""
    }${command.clarification_question ? `: ${command.clarification_question}` : ""}`;
    this.gateEl.className = `ov-gate ov-gate-${command.safety_gate}`;
    this.actionEl.textContent = actionText;
    this.speechEl.textContent = command.response_speech;
  }
}
