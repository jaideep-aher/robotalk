"""robotalk command-line entry point.

Ties the data-pipeline stages together behind a small subcommand interface so
the whole project runs through one file:

    python main.py make-dataset       # generate the corpus with OpenAI
    python main.py validate           # validate and summarise the splits

Each subcommand delegates to a function in :mod:`scripts`. No work happens at
import time; everything runs under ``main()`` guarded by ``__main__``.
"""

from __future__ import annotations

import argparse
from typing import List, Optional

from scripts import make_dataset, validate_dataset


def _add_make_dataset_parser(subparsers: argparse._SubParsersAction) -> None:
    """Register the ``make-dataset`` subcommand.

    Args:
        subparsers: The subparser registry to add to.
    """

    parser = subparsers.add_parser(
        "make-dataset", help="Generate the training/test corpus with OpenAI."
    )
    parser.add_argument("--total", type=int, default=make_dataset.DEFAULT_TOTAL)
    parser.add_argument("--test-size", type=int, default=make_dataset.DEFAULT_TEST_SIZE)
    parser.add_argument("--model", type=str, default=make_dataset.DEFAULT_MODEL)
    parser.add_argument("--batch-size", type=int, default=make_dataset.DEFAULT_BATCH_SIZE)
    parser.add_argument(
        "--max-attempts", type=int, default=make_dataset.DEFAULT_MAX_ATTEMPTS
    )
    parser.add_argument("--seed", type=int, default=13)


def _add_validate_parser(subparsers: argparse._SubParsersAction) -> None:
    """Register the ``validate`` subcommand.

    Args:
        subparsers: The subparser registry to add to.
    """

    parser = subparsers.add_parser(
        "validate", help="Validate the corpus and print samples for review."
    )
    parser.add_argument(
        "--train", type=str, default=str(make_dataset.PROCESSED_DIR / "train.jsonl")
    )
    parser.add_argument(
        "--test", type=str, default=str(make_dataset.PROCESSED_DIR / "test.jsonl")
    )
    parser.add_argument("--samples", type=int, default=10)
    parser.add_argument("--seed", type=int, default=7)


def build_parser() -> argparse.ArgumentParser:
    """Build the top-level argument parser with all subcommands.

    Returns:
        The configured argument parser.
    """

    parser = argparse.ArgumentParser(prog="robotalk", description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    _add_make_dataset_parser(subparsers)
    _add_validate_parser(subparsers)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    """Parse arguments and dispatch to the requested subcommand.

    Args:
        argv: Optional argument list; defaults to ``sys.argv`` when None.

    Returns:
        A process exit code (0 on success).
    """

    from pathlib import Path

    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "make-dataset":
        make_dataset.run(
            total=args.total,
            test_size=args.test_size,
            model=args.model,
            batch_size=args.batch_size,
            max_attempts=args.max_attempts,
            seed=args.seed,
        )
        return 0

    if args.command == "validate":
        validate_dataset.report(
            Path(args.train),
            Path(args.test),
            num_samples=args.samples,
            seed=args.seed,
        )
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
