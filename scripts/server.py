"""FastAPI backend for the robotalk simulator.

Exposes a single ``/parse`` endpoint that the browser calls. It runs the
inference wrapper server-side so the OpenAI key never reaches the client, and
returns the validated command schema as JSON. A ``backend`` query parameter
selects the base or fine-tuned model for live before/after demos.

The app object is created by :func:`create_app` and re-exported from
``main`` so it can be served with ``uvicorn main:app``.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import BaseModel, Field

try:
    from scripts.model import RobotalkModel
except ImportError:  # Executed with scripts/ on the path.
    from model import RobotalkModel


class ParseRequest(BaseModel):
    """Body of a ``/parse`` request.

    Attributes:
        utterance: The spoken text to parse.
        actor_role: The speaker role set by the character-select screen.
    """

    utterance: str = Field(min_length=1)
    actor_role: str = Field(pattern="^(passenger|external)$")


@lru_cache(maxsize=2)
def _get_model(backend: str) -> RobotalkModel:
    """Return a cached inference wrapper for a backend.

    Args:
        backend: ``base`` or ``finetuned``.

    Returns:
        A cached :class:`RobotalkModel`.
    """

    return RobotalkModel(backend=backend)


def create_app():
    """Build and configure the FastAPI application.

    Returns:
        The configured FastAPI app instance.
    """

    from fastapi import FastAPI

    app = FastAPI(title="robotalk", version="0.1.0")

    @app.get("/health")
    def health() -> dict:
        """Report liveness and which backends are ready.

        Returns:
            A dict with service status and fine-tuned-model availability.
        """

        from pathlib import Path

        model_id_file = Path(__file__).resolve().parents[1] / "models" / "model_id.txt"
        return {
            "status": "ok",
            "finetuned_available": model_id_file.exists(),
        }

    @app.post("/parse")
    def parse(request: ParseRequest, backend: str = "base") -> dict:
        """Parse an utterance into a validated command.

        Args:
            request: The utterance and actor role.
            backend: ``base`` or ``finetuned`` (query parameter).

        Returns:
            A dict with ``ok``, the selected ``backend`` and ``model_id``, the
            validated ``command`` on success, or an ``error`` string on
            failure. Always HTTP 200 so the browser can render either outcome.
        """

        if backend not in {"base", "finetuned"}:
            return {"ok": False, "backend": backend, "error": "unknown backend"}

        try:
            model = _get_model(backend)
        except FileNotFoundError:
            return {
                "ok": False,
                "backend": backend,
                "error": "fine-tuned model not ready yet (models/model_id.txt missing)",
            }
        except Exception as exc:  # noqa: BLE001 - surface config errors to the UI
            return {"ok": False, "backend": backend, "error": str(exc)}

        result = model.predict(request.utterance, request.actor_role)
        if not result.is_valid:
            return {
                "ok": False,
                "backend": backend,
                "model_id": model.model_id,
                "raw": result.raw,
                "error": result.error,
            }
        return {
            "ok": True,
            "backend": backend,
            "model_id": model.model_id,
            "command": result.command.model_dump(mode="json"),
        }

    return app


def serve(host: str = "127.0.0.1", port: int = 8000, reload: bool = False) -> None:
    """Run the backend with uvicorn.

    Args:
        host: Bind host.
        port: Bind port.
        reload: Whether to enable autoreload (development only).
    """

    import uvicorn

    uvicorn.run("main:app", host=host, port=port, reload=reload)


# Optional standalone entry: ``python scripts/server.py`` for a quick smoke run.
if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=8000)
