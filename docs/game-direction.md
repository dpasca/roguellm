# Game Direction Plan

This document records the product direction agreed for the RogueLLM redesign and
the implementation order that follows from it. It is written to be picked up by a
fresh session with no prior context.

Related plans: [visual-assets.md](visual-assets.md) defines the entity art
contract, [story-encounters.md](story-encounters.md) defines the encounter
contract, [world-ownership-plan.md](world-ownership-plan.md) and
[production-publish-plan.md](production-publish-plan.md) cover ownership,
moderation, and hosting. This document supersedes the open items in
`llms-workspace.md`.

## The core decision

**Ship Worlds, not runs.**

Today a World is a config row in `generators` and the run is the product. The
direction inverts that: the World is the artifact — named, illustrated, ownable,
shareable, and playable by a stranger in one tap. A run is how you experience
someone's World.

Everything else in this plan follows from that inversion:

- Art stops being decoration and becomes what makes a World shareable.
- A multi-minute build stops being a wait and becomes the forge ceremony.
- Credits get an honest story: forging costs, playing is free.
- The existing ownership, visibility, and moderation work moves to the center.

## Chosen shape: Journey

Three shapes were considered.

- **A — Reskin.** Keep the tile grid, add art, rebuild the front page. Lowest
  risk, but the grid stays the mobile problem and the least distinctive part.
- **B — Journey.** Replace the 2D grid with a vertical path of nodes
  (encounter / fight / find / boss). Tap a node, get a full-bleed illustrated
  scene with 2–3 choices. Combat is its own screen: hero sprite left, enemy
  sprite right, large touch targets. **Chosen.**
- **C — Illustrated story.** Drop the tactical layer entirely. Fastest, but hard
  to differentiate from generic AI fiction and discards the combat work.

B was chosen because the grid is what forces the desktop layout, leaves art
nowhere to live at full size, and makes the game read as a spreadsheet. B is a
replacement of the play surface, not of the engine: combat, items, encounters,
and the whole generation pipeline are reused. `game_state_manager` already
tracks position and placements, and a linear path is a degenerate case of that.

## Current state

Assessed on the `spike/game-experience-redesign` branch.

Working and worth keeping:

- World generation: players, enemies, items, cell types, map CSV, entity
  placements (`gen_ai.py`, `gen_ai_prompts.py`).
- Story encounters with choices and bounded effects.
- Combat, inventory, run report.
- i18n across 6 locales with a DB-backed per-language world translation cache
  (`db.py:572`, `db.py:607`, `WORLD_TRANSLATION_CACHE_VERSION` at
  `game_state_manager.py:23`).
- Auth, world ownership, visibility, LLM moderation for public worlds.
- Docker, VPS, staging and production deploy, health endpoints.

The sprite system is half-built, in a useful way. Commit `4038642` added the
**consumption** side: `sprite_url` / `sprite_token_url` on entity models
(`models.py:13-14`), protected from translation (`gen_ai.py:68-69`), consumed by
`combat_manager.py:31` and `entity_placement_manager.py:73`, rendered through
774 lines of `static/css/game_art.css` with a Font Awesome fallback. There is
**no generation code anywhere**. The three Piedone sprites are hand-made files
hardcoded in `tools/ensure_dev_worlds.py`. The contract and renderer exist; only
the pipeline is missing.

Problems this plan addresses:

1. **The front page is a tool chooser, not a game.** `static/index.html` is 549
   lines with eight UI regions: review modal, auth strip, world-code panel,
   world-menu panel, lobby hero, mode tabs, world browser with its own sub-tabs,
   create panel. Plus 1018 lines of `landing.js` and 1859 of `landing.css`. A
   first-time visitor must make a taxonomy decision before seeing anything, and
   the only visual is `preview-map` — 58 hardcoded `<span class="tile">`
   elements faking a dungeon (`static/index.html:433-494`).
2. **The play surface reads as a spreadsheet.** Flat colored squares with Font
   Awesome glyphs, a stat table, an inventory row, a scrolling log.
3. **The loop is thin.** No persistent artifact worth showing anyone.
4. **Mobile is retrofitted.** `@media screen and (max-width: 180mm)` appears in
   eight stylesheets — a print unit standing in for a phone breakpoint.
5. **Play costs money on every move.** See below.

## Runtime cost: pre-bake narration at forge time

The original version of this section was written from a partial reading and was
wrong in two ways. Corrected after tracing the code:

`gen_tile_quick_info` was never a per-move runtime call — it runs once from
`initialize_tile_info` and its docstring already says "Prebuild fast tile
summaries so movement never waits on narration." `gen_room_description` is only
a fallback for when a tile has no summary.

The real cost was larger and elsewhere. **The `generators` table stores only
`theme_desc`, `theme_desc_better`, `language`, and the four `*_defs` columns. The
map, the entity placements, and the tile summaries were never persisted**, so
every single run of a saved World regenerated them:

| Call | When | Persisted |
|---|---|---|
| `gen_game_map_from_celltypes` | **every run**, including replays | no |
| `gen_entity_placements` | **every run**, including replays | no |
| `gen_tile_quick_info` | fresh forge only — *skipped* on replay | no |
| `gen_adapt_sentence` | once per run, not per event — see below | n/a |
| `gen_room_description` | rare fallback when a tile has no summary | n/a |

`gen_adapt_sentence` was also not a per-event cost. `FAST_DESCRIPTION_ACTIONS`
in `game_websocket_handler.py:8` already covers all six gameplay actions
(`move`, `attack`, `run`, `use_item`, `equip_item`, `choose_story`), which take
their raw text directly. Tracing every action showed the only remaining call was
on `initialize` / `restart`, where `initialize_game` returned the bare string
`"Game initialized!"` with no description and the handler adapted it.

The skip on replay was the worst of it: `initialize_tile_info` guarded on
`not loaded_from_generator`, so a replayed World paid for map and placement
generation anyway while *losing* its tile prose and falling back to generic
template text. Replays were both expensive and lower quality than the original
forge, and two players of the same "World" got different maps.

**Phase 1a (done)** persists the playable snapshot. The map is stored as a grid
of cell-type ids and placements as entity ids, both language-independent, so
they sit outside the translation cache. Only `tile_info` holds generated prose,
so it is keyed by language and reused only for a matching language.

**Phase 1b (done)** removed that last call without generating anything new. The
opening line now reuses the summary portion of `theme_desc_better`, which is
already generated, already translated with the rest of the world, and already
reviewed as `generated_title_and_summary`. It is passed as both `description_raw`
and `description` so the handler never adapts it, with a localized `run.started`
fallback for worlds that have no summary.

The planned flavor-pool system was dropped: it would have added forge cost,
translation surface, and moderation surface to replace a call that fired once per
run on a hardcoded English string. **Runtime LLM cost is now zero** — play is DB
reads and bandwidth.

Three benefits beyond cost:

- **Kills move latency.** `llms-workspace.md` lists "Fix lag when the player
  moves, entering a new room type and waiting for the room description to be
  generated" as previously fought. It is structural and cannot be won while
  narration is live. Pre-baked text renders instantly.
- **Closes a moderation hole, but only if the payload keeps up.** With live
  narration, an adversarial theme can produce unreviewed prose for strangers
  playing an approved public World. Pre-baking is necessary but not sufficient:
  `build_world_review_payload` originally passed only the theme and the four
  `*_defs`, so persisted tile prose was player-visible yet never reviewed.
  `process_public_world_review` now attaches baked prose from the snapshot via
  `collect_baked_prose`. **Every future pre-baking step must extend
  `collect_baked_prose` too, or it reopens this hole.**
- **Translation stays coherent.** Pre-baked narration rides the existing
  per-language world translation cache. Live narration would need per-call
  translation forever.

Accepted tradeoff: two runs through the same World see similar prose. Variation
comes from node order, choice branching, which enemies are met, and which of N
variants rolls. For the sharing loop this is arguably correct — a shared World
should look roughly like the World the sharer saw.

### Optional live narration

If live narration is wanted later, it is a paid tier, not the default:

- **Baked** (free, default): zero marginal cost, instant, fully moderated.
- **Living** (creator-funded): live narration drawn from a per-World credit
  budget the creator tops up. On exhaustion the World falls back to baked rather
  than breaking.

This makes each World's live cost funded by the person who wanted it live,
instead of hoping creators subsidize players in aggregate. For reference, the
aggregate model breaks exactly where it hurts most: a live run costs roughly
$0.02–0.04 at gpt-4.1-mini rates against a $0.10–0.50 forge, which works for the
long tail but fails on a World that goes viral.

## Art pipeline

### Model choice

Use **`gpt-image-2` at `quality: "low"`**, `size: 1536x1024` for sheets and
`1024x1024` for single portraits.

| Model | Range / image | Status |
|---|---|---|
| gpt-image-2 | $0.005 – $0.211 | current flagship, use this |
| gpt-image-1.5 | $0.009 – $0.20 | previous flagship |
| gpt-image-1-mini | $0.005 – $0.052 | **removed from API Dec 1, 2026** |
| gpt-image-1 | $0.011 – $0.25 | **deprecated Oct 23, 2026** |

Do not build on `gpt-image-1-mini` despite the attractive price — it is removed
in December 2026. `gpt-image-2` at low quality is the same ~$0.005 floor and is
not scheduled for removal. DALL·E 2 and 3 were removed from the API on
May 12, 2026. Batch mode is roughly 50% off if forge latency allows it.

Model name and quality must be configurable via env
(`IMAGE_MODEL_NAME`, `IMAGE_MODEL_QUALITY`, `IMAGE_MODEL_API_KEY`,
`IMAGE_MODEL_BASE_URL`) following the existing `LOW_SPEC_MODEL_*` pattern.

### Character frames

Generate the frames as **one sprite sheet in a single call**: the same character
in three poses side by side (neutral / attacking / defeated) on a flat
background, then slice deterministically. Identity consistency is exact because
it is literally one image, not three attempts at the same character. One
generation instead of three: 1/3 cost, 1/3 wall-clock, no drift. At 1536 wide
each frame is ~512px, more than a mobile sprite needs.

Tiers:

- **Motion stays CSS** — shake, flash, tint, knockback, fade. These are
  animation, not expression.
- **Expression comes from the sheet** — the default tier, one call per
  character.
- **Per-frame edits are premium** — hero and boss only, using the image *edit*
  endpoint with the base sprite as input, at medium quality. ~6 extra calls.

Degrade gracefully: if slicing yields a bad frame, fall back to the neutral pose
plus CSS.

### Style locking

Generate the hero first, then pass that image as an **input reference** to every
subsequent call ("match this art style, palette, line weight, and scale
exactly"). Without this, twelve images look like twelve different games. This is
the single highest-leverage step for cohesion.

### Background removal

Request `background: "transparent"` with PNG output. Keep a deterministic
chroma-key fallback — flat magenta, flood-fill from the corners with tolerance —
for when the model ignores it. Validate alpha coverage and safe padding before
attaching URLs, as `visual-assets.md` already specifies.

### Budget and timing

Per world: 1 hero sheet + ~5 enemy sheets + ~5 location backdrops + 1 cover card
≈ **12 calls ≈ $0.06 at low quality**, ~$0.35 at medium. At 10–25s each with
concurrency 4, that is 60–90 seconds of art on top of text generation.

**A 2–4 minute forge is the target.** Make the wait the reveal, not a spinner:
title card lands, hero fades in, enemies appear one at a time, locations fill
in. That is the share moment and the credit justification in one animation.

## Credits and monetization

- **Forging costs credits. Playing is always free.** Play must stay anonymous
  and instant with no login — gating play behind signup kills the sharing loop
  and wastes the moderation work.
- Free tier: 1–2 forges to try.
- **Remix** — fork a public World with a twist — costs credits. This is the
  growth loop that converts a player into a creator.
- Real API cost per forge is roughly $0.10–0.50 all-in, so there is honest
  margin at any sane price point.

## Front page

Reduce eight regions to three:

1. One sentence of what this is, the prompt box, and Forge. No tabs.
2. A gallery of World cards showing actual generated art. Tap plays instantly.
3. A thin header: logo, language, avatar.

Everything else — My Worlds, world code entry, visibility controls, auth forms —
moves behind the avatar or onto the World card itself. Delete `preview-map`; a
real World card replaces it.

## Mobile

**PWA first, not native.** Installable, works from a shared link, no store
review, and no 30% store cut on credit purchases — which would be severe on a
low-margin virtual-currency product. Go native only after the loop is proven.

Replace the `180mm` breakpoints with real portrait-first breakpoints. The
Journey layout is portrait-native by construction: vertical path, one thumb, no
horizontal grid, no zooming.

## Implementation order

Phases 1 and 2 are independent and can run in parallel; both touch `gen_ai.py`
and the world definition schema.

**Phase 1a — Persist the playable snapshot. Done.** Backend only, no UI change.
1. `generator_worlds` table holds `map_csv`, `entity_placements`, and
   `tile_info` keyed by language, with `WORLD_SNAPSHOT_VERSION` for
   invalidation. It is a separate table because `save_generator` uses
   `INSERT OR REPLACE` (`db.py:446`), which would null extra columns on the
   `generators` row.
2. `_load_world_snapshot` / `_save_world_snapshot` in `game_state_manager.py`.
   Loading validates dimensions and cell-type ids against the current
   definitions and returns None on any mismatch, so a stale snapshot falls back
   to generation rather than corrupting a run.
3. `initialize_game_placements` takes snapshot placements verbatim — density and
   sanitization already ran when the world was first built, and re-running them
   would drift the layout away from what was recorded.
4. The `not loaded_from_generator` guard in `initialize_tile_info` is removed.
   A legacy world without a snapshot now generates tile info once on its next
   run and persists it, instead of silently degrading forever.
5. Covered by `tests/test_world_snapshot.py`.

**Phase 1b — Remove the last runtime call. Done.**
1. `_opening_line` reuses the `theme_desc_better` summary, falling back to a
   localized `run.started` added to all six locales.
2. `initialize_game` passes it as both `description_raw` and `description`, so
   `create_message_description` short-circuits before `gen_adapt_sentence`.
3. `tests/test_world_snapshot.py` asserts every gameplay action stays in
   `FAST_DESCRIPTION_ACTIONS`, so reintroducing a per-turn call fails the suite.

No new generation was added. If a future change does bake new prose, it must
extend `collect_baked_prose` — see the moderation note above.

**Phase 2 — Art pipeline.** Backend only; the renderer already exists.
1. Add an image-generation client with env-driven model config.
2. Emit the visual-asset manifest from the completed world definition, per
   `visual-assets.md` step 1.
3. Generate the hero sheet first, then style-locked sheets and backdrops.
4. Slice sheets, remove backgrounds, derive map tokens, validate.
5. Persist assets and attach URLs to the world definition.
6. Store assets in a Docker volume owned by the RogueLLM stack, not object
   storage. Add an assets volume alongside the existing
   `roguellm-production-data` and keep any host path in the server-side
   environment, not in this repo. Revisit object storage only if disk or
   bandwidth actually become a problem.
7. Include generated art in backups — `scripts/backup-production-sqlite.sh`
   covers the database only, so art would not survive a host loss today.

## Deployment isolation

RogueLLM shares the VPS hardware with other apps and nothing else. Separate
Docker project, separate env file, separate volumes, separate loopback port. The
goal is that moving to a dedicated server is a DNS change plus the same compose
file, with nothing to unpick.

Current state against that goal:

- `docker-compose.staging.yml` meets it. No external network; the app is reached
  purely through `127.0.0.1:${ROGUELLM_HOST_PORT}`.
- `docker-compose.production.yml` does not. It joins `chatnext3-network` as an
  external network with a container alias, which is a hard dependency on another
  app's Docker environment: if that stack is recreated, this ingress path breaks.

Two ways to remove that coupling, both keeping one reverse proxy on `80`/`443`:

1. **Loopback only**, matching staging. Drop the external network entirely and
   point the proxy upstream at the published loopback port. A containerized
   proxy reaches it via `host-gateway`. Zero Docker coupling; the compose file
   becomes portable as-is.
2. **Neutral shared network.** Keep container-alias DNS but rename the shared
   network to something no app owns, such as `edge` or `web-ingress`, declared
   outside any single app's stack.

Option 1 is preferred: it is what staging already proves works, and it leaves
nothing app-specific in the RogueLLM compose file. Do not share volumes,
databases, sessions, or auth with any other app on the host.

**Phase 3 — Front page.** Needs Phase 2 for real art.
1. Rebuild `index.html` around prompt + gallery + thin header.
2. Move auth, world code, and visibility behind the avatar or the World card.
3. Add the forge reveal animation.

**Phase 4 — Journey play surface.** The largest chunk.
1. Replace grid rendering and movement with a vertical node path.
2. Full-bleed illustrated encounter scenes with 2–3 choices.
3. Dedicated combat screen with hero and enemy sprites.
4. Retire the map CSV rendering path; keep placement logic as path generation.

**Phase 5 — Credits and payments.** Stripe, credit ledger, forge/remix pricing,
free-tier allowance.

**Phase 6 — PWA.** Manifest, service worker, install prompt, offline shell.

## Open questions

- Should the forge be synchronous with a live reveal, or a background job the
  user can navigate away from and return to?
- Does the Journey path keep multiple levels (`llms-workspace.md`), or is one
  path per World with a boss at the end enough for the first version?
- Should Remix inherit the parent's art, regenerate it, or offer both at
  different credit prices?
- Do runs get persisted per user, or only Worlds? (Carried over from
  `world-ownership-plan.md`.)

## Sources

Image model pricing and deprecation dates verified August 2026 against
[OpenAI API pricing](https://developers.openai.com/api/docs/pricing) and
[OpenAI image API cost breakdown](https://costgoat.com/pricing/openai-images).
Re-verify before implementation; these dates are close.
