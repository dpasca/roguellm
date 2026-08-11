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

> **Superseded.** This section records the decision as it stood at the time.
> Phase 4 below abandoned the Journey after seeing the game with real art, and
> the tile grid is staying. Read Phase 4 and Status before acting on anything
> here. Phase 5 is credits and payments, not the Journey.

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

The default core bundle is now 1 medium hero sheet + 1 low-quality primary
backdrop. The token and cover are composed locally, so they add no image calls.
With the measured text forge this is roughly **$0.07 per World** before any
visual reroll. `WORLD_ART_TIER=full` retains the former all-character and
all-location bundle for an explicit premium path.

**A 2–4 minute forge is the target.** Make the wait the reveal, not a spinner:
title card lands, hero fades in, enemies appear one at a time, locations fill
in. That is the share moment and the credit justification in one animation.

## Credits and monetization

- **Forging costs credits. Playing is always free.** Play must stay anonymous
  and instant with no login — gating play behind signup kills the sharing loop
  and wastes the moderation work.
- The implemented rollout defaults are 10 credits per forge and 30 welcome
  credits, or three core Worlds before a purchase is needed.
- A creator gets one free core-art reroll per World. Technical failures restore
  that allowance and failed forges refund their credit charge.
- Completing a distinct World earns 1 promotional credit, capped at 5 rewards
  per UTC day. Replays count toward total completions but cannot farm credits.
- World cards and creator dashboards show plays, completions, and qualified
  unique completers. The creator's own completion does not increase the unique
  popularity count.
- **Remix** — fork a public World with a twist — costs credits. This is the
  growth loop that converts a player into a creator.
- The mobile-first shop now previews 40-, 120-, and 300-credit packs at target
  USD prices of $1.99, $4.99, and $9.99. Those are presentation defaults, not a
  source of truth: StoreKit or Play Billing supplies the final localized price.
- Web deliberately cannot complete a purchase. The storefront looks and behaves
  like the future mobile screen, but its provider seam only accepts a successful
  result after a native adapter has verified the receipt with the server. Stripe
  is deferred unless web later becomes a real shipping target.
- Creator milestone payouts, remix pricing, receipt verification, and mobile IAP
  are not implemented yet. `ENABLE_WORLD_CREDITS` therefore remains off by
  default.

## Front page

Reduce eight regions to three:

1. One sentence of what this is, the prompt box, and Forge. No tabs.
2. A gallery of World cards showing actual generated art. Tap plays instantly.
3. A thin header: logo, language, avatar.

Everything else — My Worlds, world code entry, visibility controls, auth forms —
moves behind the avatar or onto the World card itself. Delete `preview-map`; a
real World card replaces it.

## Mobile

**Decided: mobile only, shipped through the App Store and Play Store.** The PWA
route is dropped. The product is a phone game with a server behind it, and web
is no longer a shipping target — it stays as the development surface and, if
useful later, a marketing or desktop companion.

This reverses the earlier recommendation in this document, which argued PWA
first to avoid store review and the store cut. That trade is now accepted
deliberately, and it has one consequence worth carrying into Phase 5: **credits
sold in-app go through StoreKit and Play Billing, which take 15-30%.** The core
art path is now roughly $0.07 per forge before retries, but the store share still
comes off the margin directly, so credit pack pricing has to be set against the
net rather than the list price. Selling credits on the web and consuming them in
the app is the usual way around it and is against both stores' rules for digital
goods consumed in-app; do not plan on it.

**Use Capacitor rather than building native.** The frontend is already a
mobile-first Vue app with the location stage, combat screen, and encounter sheet
all designed portrait-first, and ChatNext3 already ships an iOS build on
Capacitor 7 with a multi-instance config. Wrapping is a fraction of the cost of
a rewrite and keeps one codebase. Android would be new but is the same toolchain.

What this changes technically:

- The server becomes an API and content host rather than a web app. It already
  is, in practice: play is entirely websocket-driven and art is served as static
  files.
- **Asset size becomes a client concern, not just a server one.** A World is
  currently about 20-25 MB of PNG. Converting to WebP takes that to roughly
  2 MB, measured — see [deployment-handoff.md](deployment-handoff.md). Over a
  mobile connection that is the difference between a usable download and a
  hostile one.
- Auth needs to work without a browser session cookie. Sign in with Apple is
  effectively mandatory on iOS if any other social sign-in is offered.
- The `180mm` breakpoints should still be replaced with real portrait
  breakpoints; that work is unaffected.

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

**Phase 2 — Art pipeline. Done.**
1. `gen_image.py` holds the client, prompts, slicing, keying, and tokens, with
   env-driven model config. Art is off unless `ENABLE_WORLD_ART=1`.
2. `gen_visual_manifest` emits the manifest; `normalize_visual_manifest`
   validates it against the World, dropping invented ids and filling omissions.
   The manifest is persisted via `save_generator_visual_manifest`.
3. Characters generate sequentially so the first anchors the style. Every prompt
   repeats the manifest verbatim, which is what holds a World together.
4. Sheets are sliced into equal frames, keyed, trimmed, and turned into tokens.
5. Art attaches through the existing `sprite_url` / `sprite_token_url` contract,
   written back with a targeted update so the World id does not change.

Verified against real output; three assumptions were wrong and are now fixed:

- **`gpt-image-2` rejects `background="transparent"` with a 400.** Chroma keying
  is not a fallback for it, it is the only path. The generator detects that
  specific rejection once and switches.
- **The model returns hard-edged art with no alpha at all**, so key colour
  bleeds into outlines as opaque tinted pixels. A de-spill pass on boundary
  pixels handles it.
- **Keying is a plain colour match, not a flood fill.** Connectivity stranded
  background in gaps enclosed by the subject. The prompt now tells the model to
  keep the key colour off the character instead.

6. Each World gets a cover card, composited rather than generated whole. One
   backdrop is generated from the manifest's first location, and the real hero
   and two supporting sprites are composited over it. Compositing means the card
   can never advertise a hero the game does not contain, which separately
   generated key art could. Costs one extra image per World.

Two details that decide whether a cover reads as art or as a sprite sheet:

- **The backdrop prompt forbids people and keeps the lower centre foreground
  clear**, because that is where the hero lands. Anything detailed there fights
  the subject.
- **The gradient uses the two darkest palette entries, not the median.** A
  manifest palette carries accent colours too; a noir harbour palette has a
  signal red in it, and picking by median turned the card into a sunset.

Every location gets a backdrop, drawn concurrently and attached as
`backdrop_url` on its cell type. The cover reuses one rather than generating a
scene only the gallery card would see.

Cost note: this originally read that the model generated 11 enemies from a
5-enemy sample, doubling a forge. The cast cap fixed that - a forge remeasured
on `gpt-5.6-luna` produced exactly 5 enemies, 5 terrain, and 7 items, so the
image count is back to the ~12 estimated here.
6. Store assets in a Docker volume owned by the RogueLLM stack, not object
   storage. Add an assets volume alongside the existing
   `roguellm-production-data` and keep any host path in the server-side
   environment, not in this repo. Revisit object storage only if disk or
   bandwidth actually become a problem.
7. Include generated art in backups — complete. Atomic snapshots now contain a
   consistent SQLite copy and `_data/assets`, with checksums and a disposable
   restore test. The remaining infrastructure decision is confirming Hetzner
   Cloud Backups cover the snapshot root or adding an off-host copy.

## Deployment isolation

RogueLLM has a separate Docker project, env file, volumes, loopback port, and
default network. The shared reverse proxy is the only container outside the
stack that joins that network. The goal is that moving to a dedicated server
keeps the same RogueLLM compose file; only the external proxy and DNS need
repointing.

Both compose files now meet this. Production previously joined
`chatnext3-network` as an external network with a container alias, which was a
hard dependency on another app's Docker environment. That is removed:
production and staging now have the same self-contained shape and both publish
only on `127.0.0.1:${ROGUELLM_HOST_PORT}`.

Do not share volumes, databases, sessions, or auth with any other app on the
host. Generated assets live under `_data/assets`, inside the existing
`roguellm-production-data` volume, so there is one volume to move or snapshot.

### Proxy cutover (completed 2026-08-10)

The shared nginx proxy now joins `roguellm-production_default` from the proxy
side and routes to `roguellm-production-app-1:8000`. The RogueLLM app is no
longer attached to `chatnext3-network`; its own compose file has no external
network dependency.

The previously proposed `host.docker.internal:host-gateway` route was tested
and rejected. On the Linux VPS it resolves to the Docker bridge address, which
cannot reach a port published only on host loopback. The private-network route
keeps port 18081 loopback-only without adding a relay or firewall exception.

The cutover retained the WebSocket upgrade headers and passed `/`, `/health`,
`/health/db`, unauthenticated auth routing, and a real managed-browser WSS
handshake. Timestamped pre-cutover files remain on the VPS for rollback.

**Phase 3 — Front page. Done.**
1. `list_worlds` left joins `generator_worlds` for `cover_url`, conditionally,
   since databases predating snapshots have no such table.
2. `index.html` is three regions: thin bar, one prompt box, gallery. The eight
   old regions and the fake `preview-map` are gone.
3. Auth, world code, and visibility live behind the avatar or the card's menu.
4. The forge reveal narrates the wait: title lands, cast slots fill as each
   sprite is drawn, then the map build reports itself.

**Phase 4 — Make exploration look like combat.** Revised after seeing the game
rendered with real art. The original plan was to replace the grid with a
vertical node path; three of its four steps turned out to be either already
done or based on a wrong reading:

- The combat screen already shows hero and enemy sprites full size, on both
  desktop and phone, and it is the best-looking screen in the game.
- Encounters already render as a mobile-native bottom sheet with numbered
  choices.
- The map only looked unreadable because of hand-written test data. A forged
  World picks vivid, distinct terrain colours and reads fine.

So the gap was narrower than "replace the play surface": exploration was the one
screen showing a board rather than a place. Rather than a new state model,
generation path, and migration, the current location is now drawn behind the
grid.

1. **Backdrops per location. Done.** Every terrain gets one, drawn concurrently
   and attached as `backdrop_url` on its cell type. Cell types are capped at
   4–6 for the same reason enemies are: each is now illustrated.
2. **Location behind the grid. Done.** Explored tiles thin to 42% alpha so the
   place shows through; unexplored stay near-opaque, which is the fog of war.
   Worlds without backdrops render exactly as before.
3. **The location is now the primary surface on both phone and desktop**, with
   the map as a minimap beneath it. `?layout=grid` returns to the previous
   arrangement. Desktop widens the left column rather than restructuring, since
   the map otherwise lives in a 300-400px sidebar.

The cover now reuses a location backdrop instead of generating a scene only the
gallery card would ever see.

**Phase 5 — Credits and payments.** The credit ledger, forge price, free
allowance, completion rewards, and provider-neutral storefront are done. Native
receipt verification, creator rewards, and remix pricing remain. Stripe is not
on the critical path for a mobile-only launch.

**Phase 6 — Mobile app.** Replaces the PWA plan.
1. Wrap the existing frontend with Capacitor, following the ChatNext3 setup.
2. **Done:** newly generated art is quality-85 WebP. Historical PNG Worlds keep
   working without migration; new Worlds are roughly 2 MB instead of 20 MB.
3. Replace cookie-session auth with a token the app can hold, and add Sign in
   with Apple.
4. Store listings, review, and IAP products for credits. Budget the 15-30% cut
   into pricing rather than discovering it afterwards.

## Status

Phases 1 through 4 are complete: runtime model cost during play is zero, Worlds
persist and are shareable, art generates end to end, the front page is a prompt
and a gallery, and exploration shows the place you are standing in.
The WebP prerequisite from Phase 6 is also complete for newly forged Worlds.

Open, roughly in order of how much they block anything:

- **The sample Worlds are `unlisted`, not `public`**, so they do not appear on
  the public front page. Making them public runs the moderation review, which
  is worth doing deliberately: they are the first Worlds whose baked prose the
  reviewer will see.
- **Backdrops are generated at medium quality but displayed sunk** behind a
  shade gradient at 40% opacity. Dropping just those to low quality cuts a
  forge from about $0.47 to $0.29, measured, with nothing visible lost.
- **The off-host backup layer is unconfirmed.** Complete snapshots now cover
  SQLite and generated art, but they remain on the VPS disk until Hetzner Cloud
  Backups are confirmed or the snapshot root is replicated elsewhere.
- The local-dev "Quick Start: Piedone" button points at a retired World.
- The location name can still appear three times on one screen: stage eyebrow,
  stage heading, and the stats card. The eyebrow dedupe only catches exact
  matches, so "Abandoned Control Tower" and "Control Tower" both show.
- `_data/assets/efea0944/` holds orphaned art from a deleted test World.

Phase 5 has not started. Phase 6 has only its WebP prerequisite complete;
Capacitor, token auth, and store work have not started. Deployment is being
taken forward separately; see [deployment-handoff.md](deployment-handoff.md),
the technical handoff: architecture, the client contract, data model, costs,
deployment, and the traps that are not visible from reading the code.

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
