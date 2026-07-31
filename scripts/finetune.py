"""Prepare, launch, and poll an OpenAI fine-tune job for robotalk.

Pipeline:

1. Read ``data/processed/train.jsonl`` (validated training examples).
2. Convert each row to OpenAI chat fine-tuning format (system + user +
   assistant), writing ``data/processed/finetune_train.jsonl``.
3. Estimate the training token count and print it.
4. STOP. Launching the job actually spends money, so ``run_prepare`` never
   launches; a human must call ``launch`` (or run with ``--launch``) after
   reviewing the estimate.
5. ``poll`` reports job status and, on success, saves the model id to
   ``models/model_id.txt``.

Run ``python scripts/finetune.py prepare`` to build the file and see the token
estimate, then ``python scripts/finetune.py launch`` to start the job, then
``python scripts/finetune.py poll --job-id ftjob-...`` to watch it.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

try:
    from scripts.prompts import (
        INFERENCE_SYSTEM_PROMPT,
        build_user_message,
        serialize_command,
    )
    from scripts.schema import validate_training_example
except ImportError:  # Executed directly as a file.
    from prompts import INFERENCE_SYSTEM_PROMPT, build_user_message, serialize_command
    from schema import validate_training_example


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
MODELS_DIR = PROJECT_ROOT / "models"
TRAIN_PATH = PROCESSED_DIR / "train.jsonl"
FINETUNE_PATH = PROCESSED_DIR / "finetune_train.jsonl"
MODEL_ID_FILE = MODELS_DIR / "model_id.txt"

BASE_MODEL = "gpt-4o-mini-2024-07-18"


def load_api_key() -> str:
    """Load the OpenAI API key from the environment, honouring a .env file.

    Returns:
        The API key string.

    Raises:
        RuntimeError: If no key is found.
    """

    try:
        from dotenv import load_dotenv

        load_dotenv(PROJECT_ROOT / ".env")
    except ImportError:
        pass
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not set. Put it in robotalk/.env.")
    return key


def read_training_examples(path: Path = TRAIN_PATH) -> List[dict]:
    """Read and validate the training split.

    Args:
        path: Path to the train JSONL split.

    Returns:
        A list of the validated rows as plain dicts.

    Raises:
        FileNotFoundError: If the split is missing.
    """

    if not path.exists():
        raise FileNotFoundError(f"Missing training split: {path}")
    rows: List[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            example = validate_training_example(json.loads(line))
            rows.append(example.model_dump(mode="json"))
    return rows


def to_chat_example(row: dict) -> Dict[str, List[dict]]:
    """Convert one training row to an OpenAI chat fine-tuning example.

    Args:
        row: A validated training row (utterance, actor_role, command, ...).

    Returns:
        A dict with a ``messages`` list: system, user, assistant.
    """

    from scripts.schema import Command  # local import to avoid cycles at module load

    command = Command.model_validate(row["command"])
    return {
        "messages": [
            {"role": "system", "content": INFERENCE_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": build_user_message(row["actor_role"], row["utterance"]),
            },
            {"role": "assistant", "content": serialize_command(command)},
        ]
    }


def write_finetune_file(rows: List[dict], path: Path = FINETUNE_PATH) -> int:
    """Write chat-format fine-tuning examples to a JSONL file.

    Args:
        rows: Validated training rows.
        path: Output path.

    Returns:
        The number of examples written.
    """

    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(to_chat_example(row), ensure_ascii=False))
            handle.write("\n")
            count += 1
    return count


def estimate_tokens(path: Path = FINETUNE_PATH, model: str = "gpt-4o") -> int:
    """Estimate the total training token count for the fine-tune file.

    Uses ``tiktoken`` when available for an accurate count, otherwise falls back
    to a coarse characters/4 heuristic. Counts message content plus a small
    fixed per-message overhead, which is how OpenAI bills chat fine-tuning.

    Args:
        path: The fine-tuning JSONL file.
        model: Model name used to pick the tokenizer.

    Returns:
        Estimated total token count across all examples (one epoch).
    """

    try:
        import tiktoken

        try:
            encoding = tiktoken.encoding_for_model(model)
        except KeyError:
            encoding = tiktoken.get_encoding("o200k_base")

        def count(text: str) -> int:
            return len(encoding.encode(text))

    except ImportError:
        def count(text: str) -> int:
            return max(1, len(text) // 4)

    per_message_overhead = 3
    per_example_overhead = 3
    total = 0
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            example = json.loads(line)
            example_tokens = per_example_overhead
            for message in example["messages"]:
                example_tokens += per_message_overhead + count(message["content"])
            total += example_tokens
    return total


def run_prepare(model: str = BASE_MODEL) -> int:
    """Build the fine-tune file and print the token estimate, without launching.

    Args:
        model: The base model the job would tune (for the tokenizer and notice).

    Returns:
        The estimated one-epoch training token count.
    """

    rows = read_training_examples()
    written = write_finetune_file(rows)
    tokens = estimate_tokens()
    print(f"Wrote {written} chat examples to {FINETUNE_PATH}")
    print(f"Estimated training tokens (one epoch): {tokens:,}")
    print(
        "OpenAI runs multiple epochs by default (often 3), so billed tokens are "
        f"roughly {tokens * 3:,} across 3 epochs."
    )
    print(f"Base model for the job: {model}")
    print(
        "\nSTOP: this only prepared the file. Launching the job spends money. "
        "Review the estimate, then run 'launch' to start it."
    )
    return tokens


def launch(model: str = BASE_MODEL, suffix: str = "robotalk") -> str:
    """Upload the fine-tune file and start the fine-tune job.

    Args:
        model: Base model id to fine-tune.
        suffix: Suffix OpenAI appends to the resulting model name.

    Returns:
        The created fine-tune job id.

    Raises:
        FileNotFoundError: If the fine-tune file has not been prepared.
        RuntimeError: If the openai package is unavailable.
    """

    if not FINETUNE_PATH.exists():
        raise FileNotFoundError(
            f"{FINETUNE_PATH} not found. Run 'prepare' before 'launch'."
        )
    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("The 'openai' package is required.") from exc

    client = OpenAI(api_key=load_api_key())
    print(f"Uploading {FINETUNE_PATH} ...")
    with FINETUNE_PATH.open("rb") as handle:
        upload = client.files.create(file=handle, purpose="fine-tune")
    print(f"Uploaded file id: {upload.id}")

    job = client.fine_tuning.jobs.create(
        training_file=upload.id,
        model=model,
        suffix=suffix,
    )
    print(f"Launched fine-tune job: {job.id} (status: {job.status})")
    return job.id


def poll(job_id: str, interval_s: float = 30.0, once: bool = False) -> Optional[str]:
    """Poll a fine-tune job and save the model id when it succeeds.

    Args:
        job_id: The fine-tune job id to poll.
        interval_s: Seconds between polls when waiting.
        once: When True, check a single time and return without looping.

    Returns:
        The fine-tuned model id on success, otherwise None.

    Raises:
        RuntimeError: If the openai package is unavailable.
    """

    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("The 'openai' package is required.") from exc

    client = OpenAI(api_key=load_api_key())
    terminal = {"succeeded", "failed", "cancelled"}
    while True:
        job = client.fine_tuning.jobs.retrieve(job_id)
        print(f"[{job.status}] job {job_id}")
        if job.status == "succeeded" and job.fine_tuned_model:
            save_model_id(job.fine_tuned_model)
            print(f"Saved model id to {MODEL_ID_FILE}: {job.fine_tuned_model}")
            return job.fine_tuned_model
        if job.status in terminal or once:
            if job.status == "failed":
                print(f"Job failed: {getattr(job, 'error', None)}")
            return None
        time.sleep(interval_s)


def save_model_id(model_id: str, path: Path = MODEL_ID_FILE) -> None:
    """Persist the fine-tuned model id for the inference wrapper to read.

    Args:
        model_id: The fine-tuned model id.
        path: Destination file.
    """

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(model_id.strip() + "\n", encoding="utf-8")


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    """Parse command-line arguments for standalone execution.

    Args:
        argv: Optional argument list; defaults to ``sys.argv`` when None.

    Returns:
        The parsed arguments namespace.
    """

    parser = argparse.ArgumentParser(description="robotalk fine-tune helper.")
    sub = parser.add_subparsers(dest="action", required=True)

    prepare_parser = sub.add_parser("prepare", help="Build file and estimate tokens.")
    prepare_parser.add_argument("--model", default=BASE_MODEL)

    launch_parser = sub.add_parser("launch", help="Upload and start the job.")
    launch_parser.add_argument("--model", default=BASE_MODEL)
    launch_parser.add_argument("--suffix", default="robotalk")

    poll_parser = sub.add_parser("poll", help="Poll a job and save the model id.")
    poll_parser.add_argument("--job-id", required=True)
    poll_parser.add_argument("--interval", type=float, default=30.0)
    poll_parser.add_argument("--once", action="store_true")

    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()
    if args.action == "prepare":
        run_prepare(model=args.model)
    elif args.action == "launch":
        launch(model=args.model, suffix=args.suffix)
    elif args.action == "poll":
        poll(args.job_id, interval_s=args.interval, once=args.once)
