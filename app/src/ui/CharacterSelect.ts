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
      <div class="cs-doc">
        <div class="cs-masthead">
          <span class="cs-wordmark">robotalk</span>
        </div>
        <p class="cs-eyebrow">Choose a point of view</p>
        <h1 class="cs-title">Who is speaking to the car?</h1>
        <p class="cs-lede">
          The same sentence gets a different answer depending on the answer to
          that question. You can switch at any time once you are in.
        </p>
        <div class="cs-cards">
          <button class="cs-card" data-mode="passenger">
            <span class="cs-card-title">Passenger</span>
            <span class="cs-card-desc">
              You are riding inside, so you have authority over the trip.
              Destinations, doors and stops all pass.
            </span>
            <span class="cs-role">actor_role = passenger</span>
          </button>
          <button class="cs-card" data-mode="pedestrian">
            <span class="cs-card-title">Pedestrian</span>
            <span class="cs-card-desc">
              You are on the street, walking with W A S D. The car grants
              reasonable courtesy moves and refuses door and trip control.
            </span>
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
