# RogueLLM handoff — 2026-08-11 — core art and credit foundation

## Git state

- There was no pull request. Remote `master` was fast-forwarded directly from
  `95128d5` to `7c3450d` (`Back up generated World assets`).
- This work continues on `feature/core-art-credits`, created from that exact
  `master` tip in the existing isolated worktree.
- The work described below was developed on that isolated feature branch. Use
  the Git history to locate its final integration commit; do not touch the
  canonical worktree or rename `master`.

## What is implemented

### Cheaper core art

- `WORLD_ART_TIER=core` is the default when art is enabled.
- Core makes one medium hero-sheet call and one low-quality primary-backdrop
  call. The hero token and cover are composed locally. `full` preserves the old
  all-character/all-location path.
- `IMAGE_CHARACTER_QUALITY` and `IMAGE_BACKDROP_QUALITY` can override the two
  qualities independently.
- The one free owner reroll regenerates that core bundle in a temporary staging
  directory. Only a complete hero/backdrop/cover set is published; a failure or
  timeout restores the allowance. Persisted URLs receive a cache-busting query.

### Credits

- `credit_ledger` is append-only, supports `promo` and `paid` buckets, and uses
  operation keys for idempotency.
- A forge spends promo before paid. The spend happens only when a new-World
  WebSocket begins work. A normal timeout or exception appends a refund into the
  same buckets. Replaying an existing World is free.
- Defaults: 30 welcome credits, 10 per forge. Welcome grants are idempotent and
  are also applied to an existing account the next time it signs in.
- The entire economy is behind `ENABLE_WORLD_CREDITS=0`. Deploying this branch
  with the default cannot unexpectedly charge users.

### Rewards and popularity

- The first server-qualified completion of a distinct World awards 1 promo
  credit, capped at 5 rewards per UTC day.
- Session starts, total completions, and qualified unique completers are
  idempotently persisted. The creator's own completion is excluded from the
  unique-popularity count, while anonymous runs still contribute to total plays
  and clears.
- Lobby cards and the owner dashboard expose popularity. The victory report
  shows either the credit award and balance or the daily-cap message.

### UI and API

- `/api/me` and `/api/my/stats` include the balance and economy configuration.
- The forge button shows its 10-credit price and disables itself when the signed
  in user cannot afford it.
- The World details sheet offers the one free art reroll only when the requester
  owns the World, art is enabled, and the allowance remains.
- Six translation files carry the new economy, popularity, reward, and reroll
  copy.

## Verification

- `venv/bin/python -m pytest tests/ -q`
  - 281 passed
  - 7 skipped
  - 571 subtests passed
- `git diff --check` passes.
- JavaScript syntax checks and all six translation JSON parses pass.
- The embedded Little Control Room Playwright browser verified the live lobby at
  desktop and 390×844 mobile sizes with credits enabled. Signup produced 30
  credits, the forge showed a 10-credit price, its enabled state followed the
  prompt/balance, and the five account metrics rendered without overflow. No
  standalone Playwright install was used; the temporary LCR runtime was stopped.

## Rollout

Production is unchanged until configuration is deliberately updated. A safe
code-only deploy keeps:

```text
ENABLE_WORLD_ART=0
ENABLE_WORLD_CREDITS=0
```

For a free-only beta, enable art first and confirm one real core forge and its
backup, then enable credits. With no paid-pack path, users receive three initial
forges plus capped completion rewards and cannot buy more.

## Next product/code step

1. Choose the first paid pack and purchase authority. Web can use Stripe, but
   the mobile product must use StoreKit / Play Billing for consumed credits.
2. Decide creator popularity milestones and payouts. The trustworthy input —
   qualified unique completers — is now stored, but no credit thresholds were
   invented in this change.
3. Add purchase webhook/IAP receipt idempotency to the same ledger, then expose
   a buy-credits surface.
4. After that, deploy with both flags off, run the additive SQLite migration,
   turn on core art for a controlled forge, and only then turn on credits.
