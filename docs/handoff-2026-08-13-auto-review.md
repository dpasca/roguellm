# RogueLLM handoff — 2026-08-13 — Auto Review

This is the newest handoff. It continues
[`handoff-2026-08-11-social-auth.md`](handoff-2026-08-11-social-auth.md) and
adds a spectator workflow for judging a full game without manually playing it.

## Outcome

Every reusable World in the lobby now has a **Watch Auto Review** action in its
details sheet. It starts a real game session and directs it through the existing
WebSocket API. The review is not a mocked slideshow: movement, item pickup and
equipment, a story choice, combat, objective progress, and the final run report
all use the same state and UI as normal play.

At the default speed a representative run is intended to take roughly three to
five minutes. The director deliberately holds story choices and outcomes long
enough to read them. The viewer can pause or switch between 1x, 1.5x, and 2x.
Five chapter indicators make it obvious whether the run has demonstrated:

- exploration;
- an item or equipment change;
- a story choice;
- combat;
- an ending.

The director uses the actual persisted World snapshot. Its route is selected
from map state rather than from coordinates hard-coded for one showcase. It
prioritizes useful equipment, a safe story outcome, distinct regions, and every
enemy required by the objective. If the player is hurt and has a restorative
item, it uses it before continuing combat.

## Product guardrails

Auto Review is explicitly marked as a spectator session by the server.

- It requires an existing World; it cannot spend credits to forge a new one.
- It uses a stable seed for repeatable reviews of the same World and language.
- It does not increment play, completion, or popularity metrics.
- It cannot grant completion credits or creator rewards.
- Normal play sessions keep their existing random seeds and reward behavior.

The server, rather than the URL alone, confirms spectator mode. Adding
`?spectate=1` to an ordinary session therefore cannot convert it into a
reward-free or deterministic run.

## Local review workflow

Seed the deterministic, model-free Piedone showcase into the local database:

```bash
venv/bin/python tools/seed_spectator_showcase.py
```

Start the app with the World library and debug seeds enabled, then open the
lobby. In Little Control Room this must be a managed runtime rather than a
standalone background process.

```bash
ENABLE_WORLD_LIBRARY=1 ENABLE_DEBUG_SEED=1 \
  venv/bin/uvicorn main:app --host 127.0.0.1 --port 8765
```

Open `http://127.0.0.1:8765/?lang=en`, choose **Piedone a Tokyo**, and press
**Watch Auto Review**. The seeded snapshot is a compact 10x8 World with four
visually distinct regions, three useful items, a readable story opportunity,
and three progressively harder enemies. It needs no model call and is suitable
for browser regression checks.

## Validation completed

- A full embedded-browser run reached the real victory report at 96/100 HP,
  with 3/3 enemies defeated, 51 XP, and 27 explored tiles.
- All five review chapters completed.
- The choice, pause/resume, and speed controls were exercised on a 390x844
  mobile viewport as well as desktop.
- The mobile layout has no horizontal overflow. Spectator controls remain
  clickable while a story sheet is open.
- The local World's metrics and play-session table remained at zero after the
  completed review.
- Server tests cover repeatability and the no-metrics/no-rewards contract.

## What this reveals today

Auto Review is already useful for assessing map readability, pacing, character
panels, inventory, story decisions, combat feedback, the journey log, and the
ending report. It also makes long or repetitive routes very visible, which is
exactly the kind of issue a spectator pass should expose.

It does **not** yet represent the intended art-led production experience.
Production currently has generated World art disabled, and the old incompatible
Worlds were intentionally removed. A representative production World with art
enabled is therefore the next prerequisite for an honest visual judgment.

## Recommended next steps

1. Enable and validate generated World art on one internal/representative World.
2. Use Auto Review to tune layout, animation, encounter rhythm, writing density,
   and route length until a five-minute watch feels consistently good.
3. Add optional MP4 capture only after the browser review has stabilized. The
   live Auto Review should remain the canonical source; an automated recorder
   can capture the same deterministic run for asynchronous review.
4. Finish fresh iOS/Android builds and real-device social-auth/account-deletion
   checks.
5. When the game looks strong, define a structured external playtest brief and
   telemetry questions before hiring testers.

