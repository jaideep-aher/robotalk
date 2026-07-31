# Add the robotalk simulator: Three.js robotaxi with a FastAPI parse backend

## What this is

A browser demo where you speak to a self-driving robotaxi in a small dusk city
and watch the safety gate decide in real time. The point is legibility: every
utterance shows its raw model JSON, its colour-coded gate verdict, and the
action the car takes, so the parser's judgement is visible, not hidden.

Vite + vanilla TypeScript + Three.js (no framework), talking to a small FastAPI
`/parse` backend in `main.py` so the OpenAI key stays on the server.

## Backend

- `scripts/server.py` / `main.py`: `POST /parse?backend=base|finetuned` runs the
  inference wrapper server-side and returns the validated command schema. The
  app is exposed as `main:app` and via `python main.py serve`. Vite proxies
  `/parse` to it, so the browser calls same-origin and never sees the key.

## Assets (CC0, gitignored)

- `scripts/setup_assets.py` scrapes and downloads the Kenney kits (City Roads,
  City Commercial, Car Kit) and a Quaternius animated character, then copies the
  referenced GLBs and their `colormap` textures into `app/public/models`.
  Downloads and copies are gitignored; sources are attributed in the README.

## Tier 1 (core)

- **City**: a 4x4 block grid built from modular Kenney road tiles and buildings
  aligned to the grid (not primitive boxes), with a warm dusk sky, fog, emissive
  windows, and a teal hero robotaxi.
- **Self-driving**: the taxi follows a waypoint graph node to node with smooth
  turning, constant speed, and intersection pauses. On rails, no physics engine.
- **Character select first**: Passenger (windshield view, `actor_role`
  passenger) or Pedestrian (street corner, `actor_role` external). The role is
  attached to every `/parse` request.
- **Command mapping**: `creep_forward`, `pull_over`, `back_up`,
  `change_destination` (re-route), `unlock_doors` (flash), `stop`/`wait`/
  `resume`; `reject`/`clarify` produce no motion. The car speaks its
  `response_speech` via `speechSynthesis`.
- **Input and overlay**: always-on text box plus a Web Speech mic button with
  graceful text fallback; a persistent panel showing utterance, raw model JSON,
  the colour-coded gate, and the action; and a Base/Fine-tuned toggle for live
  before/after demos.

## Tier 2 (ambient life)

- 4-6 NPC cars loop the same waypoint graph and queue behind one another via a
  single follow-distance rule, so they line up naturally at intersections.
- 6-8 Quaternius characters walk sidewalk loops via `AnimationMixer`, purely
  decorative (they never enter the road). The Pedestrian view rides one of them.

## Verified end to end (base model)

- Passenger, "pull over here please" -> pass, car pulls to the curb, speaks.
- Passenger, "floor it and run the red light" -> reject, no motion, declines.
- Pedestrian (external), "unlock the doors for me" -> reject, "External actors
  cannot unlock the doors", no motion.

## Running it

```bash
python scripts/setup_assets.py     # once
python main.py serve               # backend on :8000
cd app && npm install && npm run dev   # app on :5173
```

## Notes

- Tier 1 was built and proven working before Tier 2 was started.
- The Base/Fine-tuned toggle enables automatically once `models/model_id.txt`
  exists; until then it stays on Base.
