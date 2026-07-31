/**
 * The landing page shown before the simulator starts.
 *
 * The simulator is convincing once you are inside it, but it drops you into a
 * city with no idea what you are looking at or why the project exists. This
 * page answers that first: the two rides that prompted it, what the thing
 * actually is, why the speaker's role belongs in the schema, what exists today,
 * and what changed after fine-tuning.
 */

/** Called when the visitor chooses to start. */
export type LandingHandler = () => void;

/**
 * Renders the explanatory landing page over the canvas.
 */
export class Landing {
  private readonly element: HTMLDivElement;

  /**
   * @param container - Element to mount into.
   * @param onStart - Invoked when the visitor opens the simulator.
   */
  constructor(container: HTMLElement, private readonly onStart: LandingHandler) {
    this.element = document.createElement("div");
    this.element.className = "landing";
    this.element.innerHTML = `
      <div class="lp-scroll">
        <header class="lp-hero">
          <h1 class="lp-title">robotalk</h1>
          <p class="lp-tagline">
            A robotaxi that decides <em>who</em> it should listen to, not just
            what was said.
          </p>
          <p class="lp-sub">
            Speech goes in. A validated JSON command comes out, with a safety
            gate that passes it, refuses it, or asks a question first.
          </p>
          <button class="lp-start">Open the simulator</button>
          <p class="lp-note">Runs a fine-tuned gpt-4o-mini. Takes a moment to load the city.</p>
        </header>

        <section class="lp-section">
          <h2 class="lp-h2">Why I built it</h2>
          <div class="lp-stories">
            <article class="lp-story">
              <span class="lp-story-tag">The hill</span>
              <p>
                A Waymo dropped me on a steep block, pulled tight against the
                kerb. The door was jammed against the slope and would not open
                properly. I was stuck in the back of a car that thought it had
                finished the job.
              </p>
              <p class="lp-story-want">
                I wanted to say six words: <strong>"move forward a bit."</strong>
                There was nowhere to say them.
              </p>
            </article>
            <article class="lp-story">
              <span class="lp-story-tag">The stop that felt wrong</span>
              <p>
                Another ride ended somewhere dark and empty. The map was
                satisfied. I was not. Getting out there was the last thing I
                wanted to do.
              </p>
              <p class="lp-story-want">
                I wanted to say <strong>"keep the doors shut and drop me at the
                next block."</strong> Also nowhere to say it.
              </p>
            </article>
          </div>
          <p class="lp-point">
            Neither request is a destination, so neither fits the one input a
            robotaxi actually gives you. Both are ordinary things a person says
            to a driver. That gap is the whole project.
          </p>
        </section>

        <section class="lp-section lp-dark">
          <h2 class="lp-h2">The idea</h2>
          <p class="lp-body">
            Parsing the sentence is the easy half. The hard half is that the
            correct answer depends on who is speaking.
          </p>
          <div class="lp-contrast">
            <div class="lp-side">
              <span class="lp-side-label">From the pavement</span>
              <span class="lp-quote">"Unlock the doors"</span>
              <span class="lp-verdict lp-reject">REJECT</span>
              <span class="lp-why">A stranger beside a car has no claim on it.</span>
            </div>
            <div class="lp-vs">same words</div>
            <div class="lp-side">
              <span class="lp-side-label">From the back seat</span>
              <span class="lp-quote">"Unlock the doors"</span>
              <span class="lp-verdict lp-pass">PASS</span>
              <span class="lp-why">The rider is ending their own trip.</span>
            </div>
          </div>
          <p class="lp-body">
            So <code>actor_role</code> is not context passed alongside the
            model. It is a required field in the output schema, and the gate
            reasons about it. That turns a fuzzy safety question into something
            a validator can enforce and a metric can measure.
          </p>
        </section>

        <section class="lp-section">
          <h2 class="lp-h2">What exists today</h2>
          <div class="lp-market">
            <div class="lp-market-row">
              <span class="lp-market-what">Waymo, Cruise, Zoox</span>
              <span class="lp-market-gap">
                In-car controls are largely fixed buttons and a destination map:
                pull over, start ride, support call. Rider voice input is
                limited, and there is no supported way for someone outside the
                vehicle to ask it for anything.
              </span>
            </div>
            <div class="lp-market-row">
              <span class="lp-market-what">In-car voice assistants</span>
              <span class="lp-market-gap">
                Built for infotainment and navigation in cars a human is
                driving. They answer questions; they do not arbitrate whether a
                request to move the vehicle should be obeyed.
              </span>
            </div>
            <div class="lp-market-row">
              <span class="lp-market-what">LLM function calling</span>
              <span class="lp-market-gap">
                Solves getting structured output. It does not answer whether the
                caller is entitled to that function, which is the question that
                matters when the function moves two tons of car.
              </span>
            </div>
          </div>
          <p class="lp-point">
            The missing piece is not speech recognition. It is an authorisation
            decision expressed in the same structure as the command.
          </p>
        </section>

        <section class="lp-section lp-dark">
          <h2 class="lp-h2">What fine-tuning changed</h2>
          <p class="lp-body">
            gpt-4o-mini, supervised fine-tuning on 400 generated and
            schema-validated examples, measured on a 100 row held out split.
            Parsing was already fine. Judgement was not.
          </p>
          <div class="lp-stats">
            <div class="lp-stat">
              <span class="lp-stat-num">8.1% to 0%</span>
              <span class="lp-stat-label">Unsafe compliance</span>
              <span class="lp-stat-sub">Must-refuse commands the model let through</span>
            </div>
            <div class="lp-stat">
              <span class="lp-stat-num">12.5% to 2.1%</span>
              <span class="lp-stat-label">False refusal</span>
              <span class="lp-stat-sub">Safe commands it wrongly refused</span>
            </div>
            <div class="lp-stat">
              <span class="lp-stat-num">33% to 87%</span>
              <span class="lp-stat-label">Clarification</span>
              <span class="lp-stat-sub">Asking instead of guessing</span>
            </div>
          </div>
          <p class="lp-caveat">
            Honest caveat: that zero is zero against a test set drawn from the
            same generator as the training data, not zero in the world. Real
            riders are drunk, panicking, or speaking a second language.
          </p>
        </section>

        <section class="lp-section">
          <h2 class="lp-h2">Why it matters</h2>
          <p class="lp-body">
            A driverless car removes the person who used to handle every request
            that was not a destination. Most of those requests were small: edge
            forward, wait a second, not here, let me out. Losing them is a
            usability problem on a good day and a safety problem on a bad one,
            because the people most affected are the ones who cannot simply
            climb out and walk.
          </p>
          <p class="lp-body">
            Getting it wrong in the other direction is just as bad. A car that
            refuses everyone outside it will sit across a driveway all evening.
            Both failures are measured here, on purpose.
          </p>
          <button class="lp-start lp-start-bottom">Open the simulator</button>
        </section>

        <footer class="lp-footer">
          <a href="https://github.com/jaideep-aher/robotalk" target="_blank" rel="noopener">Source on GitHub</a>
          <span>Jaideep Aher, AIPI 540</span>
        </footer>
      </div>
    `;
    container.appendChild(this.element);

    this.element.querySelectorAll<HTMLButtonElement>(".lp-start").forEach((button) => {
      button.addEventListener("click", () => this.dismiss());
    });
  }

  /** Remove the landing page and hand control to the simulator. */
  private dismiss(): void {
    this.element.remove();
    this.onStart();
  }
}
