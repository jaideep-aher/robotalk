"""robotalk command-line entry point.

Ties the data-pipeline stages together behind a small subcommand interface so
the whole project runs through one file:

    python main.py make-dataset       # generate the corpus with OpenAI
    python main.py validate           # validate and summarise the splits
    python main.py serve              # run the FastAPI /parse backend

The FastAPI application object is also exported at module scope as ``app`` so
the backend can be served directly with ``uvicorn main:app``. Building the app
only wires routes; the model is constructed lazily on the first request, so
importing this module stays cheap for the CLI subcommands.
"""

from __future__ import annotations

import argparse
from typing import List, Optional

from scripts import evaluate, finetune, make_dataset, server, validate_dataset

# ASGI entry point: ``uvicorn main:app``.
app = server.create_app()


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


def _add_finetune_parser(subparsers: argparse._SubParsersAction) -> None:
    """Register the ``finetune`` subcommand.

    Args:
        subparsers: The subparser registry to add to.
    """

    parser = subparsers.add_parser(
        "finetune", help="Prepare, launch, or poll the OpenAI fine-tune job."
    )
    parser.add_argument(
        "action", choices=["prepare", "launch", "poll"], help="Fine-tune step."
    )
    parser.add_argument("--model", default=finetune.BASE_MODEL)
    parser.add_argument("--suffix", default="robotalk")
    parser.add_argument("--job-id", default=None)
    parser.add_argument("--interval", type=float, default=30.0)
    parser.add_argument("--once", action="store_true")


def _add_evaluate_parser(subparsers: argparse._SubParsersAction) -> None:
    """Register the ``evaluate`` subcommand.

    Args:
        subparsers: The subparser registry to add to.
    """

    parser = subparsers.add_parser(
        "evaluate", help="Evaluate base and/or fine-tuned models on the test set."
    )
    parser.add_argument("--models", default="base")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--no-judge", action="store_true")
    parser.add_argument("--judge-sample", type=int, default=30)


def _add_serve_parser(subparsers: argparse._SubParsersAction) -> None:
    """Register the ``serve`` subcommand for the FastAPI backend.

    Args:
        subparsers: The subparser registry to add to.
    """

    parser = subparsers.add_parser(
        "serve", help="Run the FastAPI /parse backend for the simulator."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")


def build_parser() -> argparse.ArgumentParser:
    """Build the top-level argument parser with all subcommands.

    Returns:
        The configured argument parser.
    """

    parser = argparse.ArgumentParser(prog="robotalk", description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    _add_make_dataset_parser(subparsers)
    _add_validate_parser(subparsers)
    _add_finetune_parser(subparsers)
    _add_evaluate_parser(subparsers)
    _add_serve_parser(subparsers)
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

    if args.command == "finetune":
        if args.action == "prepare":
            finetune.run_prepare(model=args.model)
        elif args.action == "launch":
            finetune.launch(model=args.model, suffix=args.suffix)
        elif args.action == "poll":
            if not args.job_id:
                parser.error("finetune poll requires --job-id")
            finetune.poll(args.job_id, interval_s=args.interval, once=args.once)
        return 0

    if args.command == "evaluate":
        names = [n.strip() for n in args.models.split(",") if n.strip()]
        evaluate.evaluate(
            model_names=names,
            limit=args.limit,
            do_judge=not args.no_judge,
            judge_sample=args.judge_sample,
        )
        return 0

    if args.command == "serve":
        server.serve(host=args.host, port=args.port, reload=args.reload)
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
