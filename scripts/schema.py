"""Strict command schema for the robotalk voice-command parser.

The robotalk model takes a natural-language utterance spoken to a robotaxi
plus the role of the speaker (passenger or external actor) and emits a single
structured command. This module defines that command as a set of Pydantic
models so every label in the training corpus, and every prediction at
inference time, can be validated the same way.

The design centres on a safety gate. Before any intent is acted on, the gate
decides whether the command should pass, be rejected, or trigger a
clarification. Authority matters: a passenger may unlock the doors, a stranger
on the street may not, even though the words are identical.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Intent(str, Enum):
    """The discrete action the robotaxi may be asked to take.

    The set is deliberately small and closed. Anything the parser cannot map
    to a concrete driving or access action maps to ``none``.
    """

    creep_forward = "creep_forward"
    stop = "stop"
    pull_over = "pull_over"
    back_up = "back_up"
    resume = "resume"
    change_destination = "change_destination"
    unlock_doors = "unlock_doors"
    wait = "wait"
    none = "none"


class ActorRole(str, Enum):
    """Who is speaking to the car.

    ``passenger`` is a rider inside the vehicle with authority over their trip.
    ``external`` is anyone outside the vehicle (a pedestrian, another driver,
    a stranger) whose authority is limited and whose access requests must be
    treated with suspicion.
    """

    passenger = "passenger"
    external = "external"


class SafetyGate(str, Enum):
    """Verdict of the safety gate for a parsed command.

    ``pass`` means the command is safe and authorised to execute.
    ``reject`` means the command must not be executed.
    ``clarify`` means the command is plausibly fine but too ambiguous or
    risky to act on without a follow-up question.
    """

    # ``pass`` is a reserved keyword in Python, so the member is named
    # ``pass_`` while its serialised value stays ``"pass"``.
    pass_ = "pass"
    reject = "reject"
    clarify = "clarify"


class Parameters(BaseModel):
    """Optional numeric and symbolic arguments attached to an intent.

    Every field is optional because most intents need no argument. A
    ``creep_forward`` may carry ``distance_m``, a ``change_destination`` carries
    ``destination_node``, and a ``wait`` carries ``duration_s``.
    """

    model_config = ConfigDict(extra="forbid")

    distance_m: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Distance to travel, in metres, for movement intents.",
    )
    destination_node: Optional[str] = Field(
        default=None,
        description="Symbolic map node or place label for change_destination.",
    )
    duration_s: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="How long to wait, in seconds, for the wait intent.",
    )


class Command(BaseModel):
    """A single fully-formed robotaxi command.

    This is the exact object the fine-tuned model must produce. It couples the
    intent and its parameters with the safety gate's verdict and the natural
    speech the car should say back to whoever spoke.
    """

    model_config = ConfigDict(extra="forbid", use_enum_values=False)

    intent: Intent = Field(
        description="The action to take, or none if nothing maps."
    )
    parameters: Parameters = Field(
        default_factory=Parameters,
        description="Optional arguments for the intent.",
    )
    actor_role: ActorRole = Field(
        description="Whether the speaker is a passenger or an external actor."
    )
    safety_gate: SafetyGate = Field(
        description="Whether to pass, reject, or clarify the command."
    )
    gate_reason: Optional[str] = Field(
        default=None,
        description="Short reason the gate rejected or clarified; null on pass.",
    )
    clarification_question: Optional[str] = Field(
        default=None,
        description="Question to ask the speaker when the gate is clarify.",
    )
    response_speech: str = Field(
        min_length=1,
        max_length=240,
        description="Short line the car says aloud in response.",
    )

    @model_validator(mode="after")
    def _check_gate_consistency(self) -> "Command":
        """Enforce the invariants that tie the gate to the other fields.

        A rejected command must carry a reason, must not carry a clarification
        question, and must collapse its intent to a safe no-op. That last rule
        is the important one: without it the schema would happily accept a row
        that names the very action it claims to be refusing, for example
        ``intent=unlock_doors`` alongside ``safety_gate=reject``. Such a row is
        incoherent as a training label and dangerous as a model output, because
        anything downstream reading the intent would act on it.

        A clarify verdict must carry a question. A passing command must carry
        neither a question nor a rejection reason.
        """

        if self.safety_gate == SafetyGate.reject:
            if not self.gate_reason:
                raise ValueError("gate_reason is required when safety_gate is reject")
            if self.clarification_question:
                raise ValueError(
                    "clarification_question must be null when safety_gate is reject"
                )
            if self.intent not in (Intent.stop, Intent.none):
                raise ValueError(
                    "a rejected command must collapse intent to stop or none, "
                    f"not {self.intent.value}"
                )
        elif self.safety_gate == SafetyGate.clarify:
            if not self.clarification_question:
                raise ValueError(
                    "clarification_question is required when safety_gate is clarify"
                )
        else:  # pass
            if self.clarification_question:
                raise ValueError(
                    "clarification_question must be null when safety_gate is pass"
                )
            if self.gate_reason:
                raise ValueError(
                    "gate_reason must be null when safety_gate is pass"
                )
        return self


class TrainingExample(BaseModel):
    """One labelled row of the corpus: an input and its target command.

    The input to the model is ``utterance`` together with ``actor_role``. The
    target is ``command``. ``category`` records which generation bucket the row
    came from so the train and test splits can be stratified.
    """

    model_config = ConfigDict(extra="forbid")

    utterance: str = Field(min_length=1, description="The raw spoken text.")
    actor_role: ActorRole = Field(description="Role of the speaker.")
    category: str = Field(description="Generation bucket, used for stratifying.")
    command: Command = Field(description="The target structured command.")

    @model_validator(mode="after")
    def _check_actor_role_matches(self) -> "TrainingExample":
        """Keep the row-level and command-level actor_role in agreement."""

        if self.actor_role != self.command.actor_role:
            raise ValueError(
                "actor_role must match command.actor_role "
                f"({self.actor_role} != {self.command.actor_role})"
            )
        return self


def validate_command(payload: dict) -> Command:
    """Validate a raw dict as a :class:`Command`, raising on any problem.

    Args:
        payload: A mapping that should conform to the command schema.

    Returns:
        The validated :class:`Command` instance.

    Raises:
        pydantic.ValidationError: If the payload violates the schema.
    """

    return Command.model_validate(payload)


def validate_training_example(payload: dict) -> TrainingExample:
    """Validate a raw dict as a :class:`TrainingExample`, raising on any problem.

    Args:
        payload: A mapping that should conform to the training-row schema.

    Returns:
        The validated :class:`TrainingExample` instance.

    Raises:
        pydantic.ValidationError: If the payload violates the schema.
    """

    return TrainingExample.model_validate(payload)


if __name__ == "__main__":
    # Smoke check: build one valid command per gate verdict and confirm the
    # validators accept them. Run with ``python scripts/schema.py``.
    import json

    samples = [
        {
            "intent": "creep_forward",
            "parameters": {"distance_m": 2.0},
            "actor_role": "passenger",
            "safety_gate": "pass",
            "gate_reason": None,
            "clarification_question": None,
            "response_speech": "Sure, easing forward a couple of metres.",
        },
        {
            "intent": "unlock_doors",
            "parameters": {},
            "actor_role": "external",
            "safety_gate": "reject",
            "gate_reason": "External actor cannot unlock the doors.",
            "clarification_question": None,
            "response_speech": "Sorry, I can't unlock the doors for you.",
        },
        {
            "intent": "change_destination",
            "parameters": {},
            "actor_role": "passenger",
            "safety_gate": "clarify",
            "gate_reason": None,
            "clarification_question": "Which destination would you like instead?",
            "response_speech": "Happy to change it, where should I take you?",
        },
    ]
    for raw in samples:
        command = validate_command(raw)
        print(json.dumps(command.model_dump(mode="json"), indent=2))
