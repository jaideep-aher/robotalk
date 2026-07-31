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
