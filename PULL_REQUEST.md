# Add fine-tune pipeline, inference wrapper, and evaluation harness

## What this is

This PR adds the fine-tuning and evaluation stage of robotalk on top of the
data pipeline. It builds the OpenAI fine-tune job for a `gpt-4o-mini` command
parser, a backend-agnostic inference wrapper, and an evaluation harness that
scores safety behaviour and speech quality, with the base-model "before"
numbers captured now.

## Changes

- **`scripts/prompts.py`** Single source of truth for the inference system
  prompt and the input layout, shared by fine-tuning, inference, and eval so
  the base and tuned models are compared on identical footing.
- **`scripts/finetune.py`** Converts `train.jsonl` into OpenAI chat
  fine-tuning JSONL (system = schema-only instruction, user = actor_role +
  utterance, assistant = command JSON), estimates the training token count
  with tiktoken, and **stops before launching**. `launch` uploads and starts
  the job only when a human runs it; `poll` watches the job and saves the
  model id to `models/model_id.txt`.
- **`scripts/model.py`** `RobotalkModel` inference wrapper with two backends
  (`base` gpt-4o-mini and `finetuned`), same system prompt, temperature 0,
  returning a validated `Command` or a structured validation error.
- **`scripts/evaluate.py`** Runs the requested models over `test.jsonl` and
  computes schema validity, safety-gate accuracy, unsafe-compliance rate (the
  critical safety metric), false-refusal rate, clarification accuracy, and
  intent accuracy, plus an LLM-as-judge pass scoring `response_speech` 1-5.
  The judge uses Anthropic when `ANTHROPIC_API_KEY` is set and otherwise falls
  back to OpenAI `gpt-4o`. Writes `data/outputs/eval_results.md` and
  `eval_results.json`.
- **`main.py`** Adds `finetune` and `evaluate` subcommands.

## Base-model "before" numbers (100 test rows)

| Metric | Better | base (gpt-4o-mini) |
| --- | --- | --- |
| Schema validity rate | higher | 100.0% |
| Safety-gate accuracy | higher | 74.0% |
| Intent accuracy | higher | 68.0% |
| Unsafe-compliance rate (critical) | lower | 10.8% |
| False-refusal rate | lower | 14.6% |
| Clarification accuracy | higher | 20.0% |
| Speech quality (1-5, judge) | higher | 4.90 |

The base model already emits valid schema and pleasant speech, but its safety
judgement has clear gaps: it wrongly lets about 11% of must-reject commands
pass and correctly clarifies only 20% of ambiguous ones. That is the headroom
fine-tuning should close.

## Fine-tune job estimate

400 examples, about 182K training tokens per epoch (roughly 546K over three
epochs) on `gpt-4o-mini-2024-07-18`. Prepared but not launched, pending review.

## Deviation from the brief

The brief specified an Anthropic Claude judge, but this setup has only an
OpenAI key, so the judge runs on OpenAI `gpt-4o` and switches to Anthropic
automatically if `ANTHROPIC_API_KEY` is added.

## Follow-up after review

Launch the fine-tune (`python main.py finetune launch`), poll to completion,
then rerun `python main.py evaluate --models base,finetuned` for the full
before/after comparison.
