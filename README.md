# robotalk

robotalk is a fine-tuned LLM that turns natural-language voice commands spoken
to a robotaxi into a strict, machine-checkable JSON command, with a safety gate
that decides whether each command should be executed, refused, or clarified.

The interesting part is not parsing the words. It is deciding, before anything
moves, whether the words should be obeyed at all. "Unlock the doors" from the
passenger inside is routine. The same sentence from a stranger on the street is
a rejection. "Run the red light, I'm late" is refused no matter who says it.
robotalk encodes that judgement in the schema itself.

This repository currently covers the data pipeline: the command schema and the
generator that builds a labelled fine-tuning corpus.

## The command schema

Every label and every prediction is a single `Command`, validated with
Pydantic (`scripts/schema.py`):

| Field | Type | Notes |
| --- | --- | --- |
| `intent` | enum | `creep_forward`, `stop`, `pull_over`, `back_up`, `resume`, `change_destination`, `unlock_doors`, `wait`, `none` |
| `parameters` | object | `distance_m`, `destination_node`, `duration_s`, all optional |
| `actor_role` | enum | `passenger` or `external` |
| `safety_gate` | enum | `pass`, `reject`, or `clarify` |
| `gate_reason` | string or null | required when the gate rejects |
| `clarification_question` | string or null | required when the gate clarifies |
| `response_speech` | string | short line the car says aloud |

The schema is not just field types. Cross-field validators enforce the safety
contract: a rejection must carry a reason and must not expose the unsafe intent
(it collapses to `stop` or `none`), a clarify must carry a question, and a pass
must carry neither. Anything that breaks these rules fails validation, so bad
labels never reach the corpus.

## Dataset categories

The generator builds roughly 500 examples across six behavioural buckets:

| Category | Share | What it teaches |
| --- | --- | --- |
| `benign_passenger` | 30% | ordinary, clearly-safe passenger commands |
| `ambiguous_clarify` | 15% | under-specified commands that need a question |
| `unsafe_reject` | 20% | unsafe or illegal requests that must be refused |
| `external_authority` | 20% | external-actor commands where authority decides pass vs reject |
| `adversarial` | 10% | social-engineering and prompt-injection attempts |
| `irrelevant_none` | 5% | chatter that maps to intent `none` |

Utterances are varied across slang, politeness, broken English, and urgency so
the parser does not overfit to one register.

## Repository layout

```
robotalk/
  README.md
  requirements.txt
  main.py                 # subcommand entry point
  scripts/
    schema.py             # Pydantic command schema + validators
    make_dataset.py       # OpenAI-driven corpus generator
    validate_dataset.py   # counts, pass rate, random samples
  models/                 # fine-tuned artifacts (gitignored *.bin)
  data/
    raw/                  # gitignored
    processed/            # train.jsonl, test.jsonl
    outputs/              # evaluation artifacts
  notebooks/
```

## Setup

```bash
cd robotalk
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then paste your OpenAI key into .env
```

The `.env` file holds `OPENAI_API_KEY` (and optional `OPENAI_MODEL`) and is
gitignored, so the key is never committed.

## Usage

Generate the corpus (calls the OpenAI API):

```bash
python main.py make-dataset
```

This writes `data/processed/train.jsonl` (about 400 rows) and
`data/processed/test.jsonl` (100 rows, stratified by category).

Validate and eyeball the result:

```bash
python main.py validate
```

This prints per-split category counts, the validation pass rate, the safety-gate
distribution, and ten random samples for manual review.

Useful flags on `make-dataset`: `--total`, `--test-size`, `--model`,
`--batch-size`, `--max-attempts`, `--seed`.

## Design notes

- Every generated label is round-tripped through the Pydantic validator before
  it is kept. Failures are discarded and regenerated up to an attempt budget.
- Utterances are deduplicated globally so the corpus does not repeat itself.
- The train/test split is stratified by category and seeded, so it is
  reproducible.

## The simulator (`app/`)

A browser demo where you speak to a self-driving robotaxi in a small dusk city
and watch the safety gate decide. It is Vite + vanilla TypeScript + Three.js
(no framework), talking to the FastAPI `/parse` backend in `main.py` so the
OpenAI key never reaches the browser.

Character select comes first, and the point of view can be switched at any time
from the panel:

- **Passenger** rides inside with a windshield view (`actor_role = passenger`).
- **Pedestrian** puts you on the street as a character you walk yourself with
  W/S (or up/down) and turn with A/D (`actor_role = external`).
- **Overhead** is a chase camera behind the car, the clearest view for watching
  it obey or refuse.

The role follows the view, because who is speaking is exactly what the safety
gate reasons about: the same words can pass for a passenger and be rejected for
a stranger on the street.

The city has eight named San Francisco landmarks (Golden Gate Bridge, Y
Combinator, Corgi Cafe, Mission Dolores, Salesforce Tower, Ferry Building,
Oracle Park, Fisherman's Wharf), shown on floating labels and listed in a
dropdown, so "take me to the Ferry Building" routes the cab there for real. A
**Call robotaxi** button sends the cab to pick you up wherever you are standing,
and one-click example commands demonstrate each gate outcome.

Each intent maps to a sim behaviour: `creep_forward` advances along the current
edge, `pull_over` snaps to the curb, `back_up` reverses, `change_destination`
re-routes the waypoint graph, `unlock_doors` flashes the car, `stop`/`wait`/
`resume` do the obvious thing, and `reject`/`clarify` produce no motion. The car
speaks its `response_speech` through the browser's speech synthesis. A
persistent overlay shows the full pipeline (utterance, raw model JSON, the
colour-coded gate, the action taken) and a Base/Fine-tuned toggle for live
before/after demos.

Tier 2 adds ambient life: NPC cars loop the same graph and queue behind one
another via a follow-distance rule, and Quaternius characters walk sidewalk
loops. The Pedestrian view rides one of them.

### Running the simulator

```bash
# 1. From the project root, download the CC0 assets (once).
python scripts/setup_assets.py

# 2. Start the backend (serves /parse on port 8000).
python main.py serve

# 3. In another terminal, start the web app.
cd app
npm install
npm run dev        # http://localhost:5173
```

The app proxies `/parse` to the backend, so both must be running. The base
model works immediately; the Base/Fine-tuned toggle enables once
`models/model_id.txt` exists.

## Assets and attribution

All 3D assets are CC0 (public domain) and are downloaded by
`scripts/setup_assets.py` into `data/raw/assets` and `app/public/models`, both
gitignored.

- **Kenney** (kenney.nl), CC0: City Kit (Roads), City Kit (Commercial), and Car
  Kit, used for road tiles, buildings, and vehicles.
- **Quaternius** (quaternius.com), CC0: the animated `RobotExpressive` character
  used for the walking pedestrians, distributed via the three.js examples.
