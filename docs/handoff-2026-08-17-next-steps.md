# RogueLLM handoff — 2026-08-17 — next steps

This is the current continuation point. Read it after
[`handoff-2026-08-13-auto-review.md`](handoff-2026-08-13-auto-review.md) and
[`handoff-2026-08-11-social-auth.md`](handoff-2026-08-11-social-auth.md).

## Current product state

The web application is still served through Firebase. The game API, persisted
World data, and generated World assets are handled by the Hetzner deployment.
Google and Apple authentication, account deletion, the mobile wrappers, credit
accounting, creator rewards, and mobile-store scaffolding are implemented.

The latest product addition is **Auto Review**. From a World's detail sheet,
**Watch Auto Review** starts a deterministic real-game session that demonstrates
exploration, an item/equipment change, a story choice, combat, and the ending.
It supports pause/resume and 1x, 1.5x, and 2x playback. Spectator sessions cannot
earn rewards or alter World popularity/completion metrics.

The deterministic Piedone showcase completed successfully in desktop and mobile
browser validation. The repository-wide result at that point was 301 tests
passed, 7 skipped, and 573 subtests passed, with no browser-console errors or
mobile horizontal overflow.

## The honest visual status

Auto Review makes the current gameplay legible without requiring a manual run,
but it does not yet show the intended final visual experience. Production has
generated World art disabled, and the old incompatible Worlds were intentionally
removed. The current review is therefore strongest as an assessment of layout,
map readability, story/combat feedback, inventory, pacing, and the ending report.

Do not treat the present no-art production view as the final aesthetic verdict.
The next meaningful product gate is one representative, art-enabled World.

## Recommended order of work

### 1. Establish the visual-quality loop

1. Enable generated art only for an internal/canary environment or a single
   controlled World.
2. Create one representative World with complete cover, backdrop, character,
   enemy, and token assets.
3. Watch its Auto Review repeatedly on phone and desktop.
4. Tune visual hierarchy, art cropping, animation, transition timing, writing
   density, route length, encounter rhythm, and combat clarity.
5. Repeat until a three-to-five-minute review feels consistently intentional.

This is the immediate next feature/product task.

### 2. Finish native release verification

After the visual loop is credible:

1. Regenerate the iOS provisioning profiles required by the authentication
   entitlement changes.
2. Produce a fresh TestFlight build and Android internal-test build.
3. Verify Google and Apple sign-in and backend token exchange on real devices.
4. Run a destructive account-deletion test on a disposable account.
5. Confirm safe areas, status-bar spacing, native icon, and splash treatment.

Google plus Apple can be the launch authentication surface; a password/email
delivery and reset system is not required merely as a fallback if both social
providers are reliable on the supported platforms.

### 3. Activate commerce deliberately

The current pack design remains:

- 40 credits for $1.99;
- 120 credits for $4.99;
- 300 credits for $9.99.

Keep World credits and the mobile store behind their production flags until the
native purchase/restore paths have passed store-sandbox testing. Web Stripe is
not a prerequisite for a mobile-first launch.

### 4. Add recorded review after the live review stabilizes

Auto Review should remain the canonical playback source. Once its visual output
is stable, add an automated recorder that captures the same deterministic run
to MP4 for asynchronous review. Recording an unstable interface now would add
maintenance without improving the underlying game.

### 5. Prepare external playtesting later

Hire playtesters only after the internal visual gate is passed. Before doing so,
write a short test brief and decide which questions telemetry and interviews
must answer: first-minute comprehension, completion rate, confusing decisions,
perceived repetition, desired replay behavior, and willingness to create or
share Worlds.

## How to resume Auto Review locally

Seed the model-free showcase:

```bash
venv/bin/python tools/seed_spectator_showcase.py
```

Start the app as a Little Control Room managed runtime with the World library
and debug seed enabled:

```bash
ENABLE_WORLD_LIBRARY=1 ENABLE_DEBUG_SEED=1 \
  venv/bin/uvicorn main:app --host 127.0.0.1 --port 8765
```

Open `http://127.0.0.1:8765/?lang=en`, select **Piedone a Tokyo**, and press
**Watch Auto Review**.

## Repository/worktree normalization

The assigned secondary worktree had accidentally been left on local `master`
with the Auto Review commit on top of `origin/master`. It was normalized
immediately after this handoff was created. The resulting state is:

- canonical worktree: `feature/prebuilt-quick-descriptions`;
- this worktree: `feature/auto-review`;
- local `master`: same commit as `origin/master` and not checked out by either
  worktree.

The Auto Review work remains preserved at `b97ea61` on
`feature/auto-review`. No canonical-worktree files or branches were changed.
