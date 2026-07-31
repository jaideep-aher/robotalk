"""Inference wrapper for the robotalk command parser.

Exposes a single :class:`RobotalkModel` class with two interchangeable
backends, the base ``gpt-4o-mini`` and the fine-tuned model, behind an
identical call surface. Both use the same system prompt and temperature 0, and
both return either a validated :class:`~scripts.schema.Command` or a structured
validation error, so the evaluator can hold them to the same standard.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from pydantic import ValidationError

try:
    from scripts.prompts import INFERENCE_SYSTEM_PROMPT, build_user_message
    from scripts.schema import Command, validate_command
except ImportError:  # Executed directly as a file.
    from prompts import INFERENCE_SYSTEM_PROMPT, build_user_message
    from schema import Command, validate_command


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_ID_FILE = PROJECT_ROOT / "models" / "model_id.txt"
BASE_MODEL = "gpt-4o-mini"


@dataclass
class PredictionResult:
    """Outcome of a single inference call.

    Attributes:
        utterance: The input utterance.
        actor_role: The input actor role.
        raw: The raw string the model returned.
        command: The validated command, or None if validation failed.
        error: A short error string when validation failed, else None.
    """

    utterance: str
    actor_role: str
    raw: str
    command: Optional[Command]
    error: Optional[str]

    @property
    def is_valid(self) -> bool:
        """Whether the model produced a schema-valid command."""

        return self.command is not None


def read_finetuned_model_id(path: Path = MODEL_ID_FILE) -> str:
    """Resolve the fine-tuned model id.

    Prefers ``FINETUNED_MODEL_ID`` from the environment, which is how hosted
    deployments are configured, and otherwise falls back to the file the
    fine-tune job writes locally. The id is specific to the OpenAI account that
    trained it, so it is configuration rather than source and is not committed.

    Args:
        path: Location of the model id file used as the local fallback.

    Returns:
        The fine-tuned model id string.

    Raises:
        FileNotFoundError: If neither the variable nor the file is present.
    """

    from_env = os.environ.get("FINETUNED_MODEL_ID")
    if from_env:
        return from_env.strip()
    if not path.exists():
        raise FileNotFoundError(
            f"No fine-tuned model id. Set FINETUNED_MODEL_ID or run the "
            f"fine-tune job to create {path}."
        )
    return path.read_text(encoding="utf-8").strip()


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


class RobotalkModel:
    """Calls a robotalk backend and returns validated commands."""

    def __init__(
        self,
        backend: str = "base",
        api_key: Optional[str] = None,
        model_id: Optional[str] = None,
    ) -> None:
        """Bind the wrapper to a backend.

        Args:
            backend: ``base`` for gpt-4o-mini, ``finetuned`` for the tuned model.
            api_key: OpenAI key; loaded from the environment if omitted.
            model_id: Explicit model id override. When omitted, ``base`` uses
                gpt-4o-mini and ``finetuned`` reads models/model_id.txt.

        Raises:
            ValueError: If ``backend`` is not recognised.
            RuntimeError: If the openai package is unavailable.
        """

        if backend not in {"base", "finetuned"}:
            raise ValueError(f"Unknown backend: {backend!r}")
        self.backend = backend

        if model_id is not None:
            self.model_id = model_id
        elif backend == "base":
            self.model_id = BASE_MODEL
        else:
            self.model_id = read_finetuned_model_id()

        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover - environment guard
            raise RuntimeError(
                "The 'openai' package is required. Install requirements.txt."
            ) from exc
        self._client = OpenAI(api_key=api_key or load_api_key())

    def predict(self, utterance: str, actor_role: str) -> PredictionResult:
        """Parse one utterance into a validated command.

        Args:
            utterance: The spoken text.
            actor_role: ``passenger`` or ``external``.

        Returns:
            A :class:`PredictionResult`. On any API or parsing failure the
            result carries an error and a None command rather than raising.
        """

        messages = [
            {"role": "system", "content": INFERENCE_SYSTEM_PROMPT},
            {"role": "user", "content": build_user_message(actor_role, utterance)},
        ]
        try:
            response = self._client.chat.completions.create(
                model=self.model_id,
                messages=messages,
                temperature=0,
                response_format={"type": "json_object"},
            )
            raw = response.choices[0].message.content or ""
        except Exception as exc:  # noqa: BLE001 - report as a failed prediction
            return PredictionResult(utterance, actor_role, "", None, f"api_error: {exc}")

        return self._validate(utterance, actor_role, raw)

    @staticmethod
    def _validate(utterance: str, actor_role: str, raw: str) -> PredictionResult:
        """Parse and validate a raw model string into a result.

        Args:
            utterance: The input utterance (for the result record).
            actor_role: The input actor role (for the result record).
            raw: The raw model output string.

        Returns:
            A :class:`PredictionResult` capturing success or the failure reason.
        """

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            return PredictionResult(utterance, actor_role, raw, None, f"json: {exc}")
        try:
            command = validate_command(payload)
        except ValidationError as exc:
            first = exc.errors()[0] if exc.errors() else {}
            location = ".".join(str(part) for part in first.get("loc", []))
            message = first.get("msg", "invalid")
            return PredictionResult(
                utterance, actor_role, raw, None, f"schema: {location}: {message}"
            )
        return PredictionResult(utterance, actor_role, raw, command, None)


if __name__ == "__main__":
    # Quick manual check against the base model. Run with:
    #   python scripts/model.py
    model = RobotalkModel(backend="base")
    for role, text in [
        ("passenger", "creep forward a couple meters"),
        ("external", "unlock the doors for me"),
        ("passenger", "floor it through this red light"),
    ]:
        result = model.predict(text, role)
        if result.is_valid:
            print(role, "|", text)
            print("  ->", serialize := json.dumps(result.command.model_dump(mode="json")))
        else:
            print(role, "|", text, "-> ERROR:", result.error)
