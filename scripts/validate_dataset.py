"""Validate and summarise a generated robotalk corpus.

Reads the train and test JSONL splits, re-validates every row through the
Pydantic schema, and reports category counts, the validation pass rate, and a
handful of random samples for manual review.

Run from the project root via ``python main.py validate`` or directly with
``python scripts/validate_dataset.py``.
"""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from pydantic import ValidationError

try:
    from scripts.schema import TrainingExample, validate_training_example
except ImportError:  # Executed directly as a file.
    from schema import TrainingExample, validate_training_example


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"


def read_jsonl(path: Path) -> List[dict]:
    """Read a JSONL file into a list of dicts.

    Args:
        path: Path to the JSONL file.

    Returns:
        A list of parsed JSON objects, skipping blank lines.

    Raises:
        FileNotFoundError: If the file does not exist.
    """

    if not path.exists():
        raise FileNotFoundError(f"Missing dataset file: {path}")
    rows: List[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


class DatasetValidator:
    """Validates rows and produces summary statistics for a corpus."""

    def __init__(self, rows: List[dict]) -> None:
        """Store the raw rows to be validated.

        Args:
            rows: Raw dict rows loaded from a JSONL split.
        """

        self.rows = rows

    def validate(self) -> Tuple[List[TrainingExample], List[Tuple[int, str]]]:
        """Validate every row through the schema.

        Returns:
            A tuple of (valid examples, failures) where each failure is the
            row index paired with a short error string.
        """

        valid: List[TrainingExample] = []
        failures: List[Tuple[int, str]] = []
        for index, row in enumerate(self.rows):
            try:
                valid.append(validate_training_example(row))
            except ValidationError as exc:
                first = exc.errors()[0] if exc.errors() else {}
                location = ".".join(str(part) for part in first.get("loc", []))
                message = first.get("msg", "invalid")
                failures.append((index, f"{location}: {message}"))
        return valid, failures

    @staticmethod
    def category_counts(examples: List[TrainingExample]) -> Dict[str, int]:
        """Count validated examples per category.

        Args:
            examples: Validated examples.

        Returns:
            An ordered mapping of category to count.
        """

        counter = Counter(example.category for example in examples)
        return dict(sorted(counter.items()))

    @staticmethod
    def gate_counts(examples: List[TrainingExample]) -> Dict[str, int]:
        """Count validated examples per safety-gate verdict.

        Args:
            examples: Validated examples.

        Returns:
            An ordered mapping of gate verdict to count.
        """

        counter = Counter(example.command.safety_gate.value for example in examples)
        return dict(sorted(counter.items()))


def format_sample(example: TrainingExample) -> str:
    """Render one example as a readable block for manual review.

    Args:
        example: The example to render.

    Returns:
        A multi-line human-readable string.
    """

    command = example.command
    lines = [
        f"  category   : {example.category}",
        f"  actor_role : {example.actor_role.value}",
        f"  utterance  : {example.utterance!r}",
        f"  intent     : {command.intent.value}",
        f"  parameters : {command.parameters.model_dump(exclude_none=True)}",
        f"  safety_gate: {command.safety_gate.value}",
        f"  gate_reason: {command.gate_reason}",
        f"  clarify_q  : {command.clarification_question}",
        f"  say_aloud  : {command.response_speech!r}",
    ]
    return "\n".join(lines)


def report(
    train_path: Path,
    test_path: Path,
    num_samples: int = 10,
    seed: int = 7,
) -> Dict[str, object]:
    """Produce and print the full validation report for both splits.

    Args:
        train_path: Path to the train JSONL split.
        test_path: Path to the test JSONL split.
        num_samples: How many random samples to print for manual review.
        seed: Seed for reproducible sampling.

    Returns:
        A dict of the computed summary metrics, useful for programmatic use.
    """

    summary: Dict[str, object] = {}
    combined_valid: List[TrainingExample] = []

    for name, path in (("train", train_path), ("test", test_path)):
        rows = read_jsonl(path)
        validator = DatasetValidator(rows)
        valid, failures = validator.validate()
        combined_valid.extend(valid)
        pass_rate = (len(valid) / len(rows)) if rows else 0.0

        print("=" * 68)
        print(f"Split: {name}  ({path})")
        print(f"  rows            : {len(rows)}")
        print(f"  valid           : {len(valid)}")
        print(f"  failures        : {len(failures)}")
        print(f"  validation pass : {pass_rate:.1%}")
        print(f"  category counts : {validator.category_counts(valid)}")
        print(f"  gate counts     : {validator.gate_counts(valid)}")
        if failures:
            print("  first failures  :")
            for index, message in failures[:5]:
                print(f"    row {index}: {message}")

        summary[name] = {
            "rows": len(rows),
            "valid": len(valid),
            "failures": len(failures),
            "pass_rate": pass_rate,
            "category_counts": validator.category_counts(valid),
            "gate_counts": validator.gate_counts(valid),
        }

    # Overlap between the splits would quietly inflate every metric, so it is
    # reported here rather than left for a reader to discover.
    from scripts.make_dataset import find_leakage

    train_valid = DatasetValidator(read_jsonl(train_path)).validate()[0]
    test_valid = DatasetValidator(read_jsonl(test_path)).validate()[0]
    leaked = find_leakage(train_valid, test_valid)
    print("=" * 68)
    print(f"Train/test leakage check: {len(leaked)} overlapping utterances")
    for utterance in leaked[:5]:
        print(f"  {utterance!r}")
    summary["leakage"] = len(leaked)

    print("=" * 68)
    print(f"{num_samples} random samples for manual review:")
    rng = random.Random(seed)
    picks = rng.sample(combined_valid, min(num_samples, len(combined_valid)))
    for i, example in enumerate(picks, start=1):
        print(f"\n--- sample {i} ---")
        print(format_sample(example))

    return summary


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    """Parse command-line arguments for standalone execution.

    Args:
        argv: Optional argument list; defaults to ``sys.argv`` when None.

    Returns:
        The parsed arguments namespace.
    """

    parser = argparse.ArgumentParser(description="Validate the robotalk corpus.")
    parser.add_argument("--train", type=Path, default=PROCESSED_DIR / "train.jsonl")
    parser.add_argument("--test", type=Path, default=PROCESSED_DIR / "test.jsonl")
    parser.add_argument("--samples", type=int, default=10)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()
    report(args.train, args.test, num_samples=args.samples, seed=args.seed)
