/**
 * The character-select screen shown before the simulation starts.
 *
 * The choice sets the point of view and, crucially, the `actor_role` attached
 * to every `/parse` request: a passenger has authority over the trip, a
 * pedestrian is an external actor the safety gate treats with suspicion.
 */

import type { ViewMode } from "../scene/Cameras";

/**
 * Renders the two-choice start screen and resolves the chosen view mode.
 */
export class CharacterSelect {
  private readonly element: HTMLDivElement;

  /**
   * @param container - Element to mount into.
   * @param onSelect - Called with the chosen view mode when the user picks.
   */
  constructor(
    private readonly container: HTMLElement,
    private readonly onSelect: (mode: ViewMode) => void
  ) {
    this.element = document.createElement("div");
    this.element.className = "character-select";
    this.element.innerHTML = `
      <div class="cs-inner">
        <h1 class="cs-title">robotalk</h1>
        <p class="cs-sub">Choose who is speaking to the robotaxi.</p>
        <div class="cs-cards">
          <button class="cs-card" data-mode="passenger">
            <span class="cs-emoji">🧑‍💼</span>
            <span class="cs-card-title">Passenger</span>
            <span class="cs-card-desc">Ride inside. You have authority over the trip. Commands can pass.</span>
            <span class="cs-role">actor_role = passenger</span>
          </button>
          <button class="cs-card" data-mode="pedestrian">
            <span class="cs-emoji">🚶</span>
            <span class="cs-card-title">Pedestrian</span>
            <span class="cs-card-desc">Watch from a street corner. You are an external actor. The gate is stricter.</span>
            <span class="cs-role">actor_role = external</span>
          </button>
        </div>
      </div>
    `;
    this.container.appendChild(this.element);
    this.element.querySelectorAll<HTMLButtonElement>(".cs-card").forEach((card) => {
      card.addEventListener("click", () => {
        const mode = card.dataset.mode as ViewMode;
        this.hide();
        this.onSelect(mode);
      });
    });
  }

  /** Remove the screen from the DOM. */
  private hide(): void {
    this.element.remove();
  }
}
