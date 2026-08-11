# RogueLLM handoff — 2026-08-11 — creator milestones

## Git state

- The mobile credit storefront is committed as `b9a6f39` (`Add mobile credit
  storefront`), fast-forwarded into local `master`, and pushed to
  `origin/master`.
- Creator rewards were developed from that exact tip on
  `feature/creator-milestone-rewards` in the isolated worktree. Use Git history
  to locate the final integration commit.
- The canonical worktree was not touched; do not rename `master`.

## Product policy

Each World pays its creator one-time promotional-credit milestones:

| Qualified distinct players | Credits granted | Cumulative creator credits |
| ---: | ---: | ---: |
| 5 | 5 | 5 |
| 20 | 10 | 15 |
| 50 | 20 | 35 |

A qualified player is a signed-in, non-owner user completing that World for the
first time. Anonymous clears still count toward total plays and clears, but do
not advance creator milestones. Repeat clears, reconnects, and the creator's own
clear cannot trigger a payout.

## Implementation

- The qualifying completion, popularity increment, and creator ledger grant run
  inside one `BEGIN IMMEDIATE` SQLite transaction.
- Each grant uses an idempotent operation key of
  `creator_milestone:<world_id>:<player_threshold>` and the existing `promo`
  bucket. `INSERT OR IGNORE` prevents duplicate payment under retries or
  reconnects.
- The fixed product schedule is serialized in `/api/me`. There are no new
  environment variables and no new database tables or one-off migration.
- `/api/my/stats` now reports total `creator_reward_credits` earned from the
  ledger.
- An owned World's detail sheet shows progress to the next reward and a
  completed state after 50 qualified players. The account panel shows total
  creator credits earned.
- When a player's clear triggers a creator milestone, the victory report tells
  the player how many credits the creator earned. Copy exists in all six
  supported languages.
- Everything remains behind `ENABLE_WORLD_CREDITS=0`; production behavior is
  unchanged until that rollout flag is deliberately enabled.

If an already-popular World is missing a reached milestone ledger entry, its
next new qualified player grants the missing reached milestone(s). This makes a
feature rollout recognize existing popularity without a bulk migration.

## Verification

- `venv/bin/python -m pytest tests/ -q`: 282 passed, 7 skipped, 571 subtests
  passed.
- Python compilation, JavaScript syntax checks, all six translation JSON
  parses, and `git diff --check` pass.
- Embedded Little Control Room Playwright verified the owned-World progress card
  at 12/20 (60%), its completed state at 50, the account's earned-credit stat,
  and no horizontal overflow at 390×844. No local Playwright package was
  installed; the temporary managed runtime was stopped.
- The WebSocket integration test verifies a real qualifying win grants both the
  capped player reward and the creator milestone payload atomically.

## Next step

The main Phase 5/6 blocker after integration is the mobile purchase authority:
Capacitor/token auth, Apple and Google consumable products, and server-side
receipt verification keyed by store transaction identifiers.
