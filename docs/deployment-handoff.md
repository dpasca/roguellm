# Deployment Handoff

Written for whoever takes deployment forward separately from feature work.

This is **what changed and what blocks**, not a full runbook. The existing
[production-publish-plan.md](production-publish-plan.md) already covers hosting
direction, DNS and reverse proxy, the database plan, auth hardening, the staging
Docker runbook, and the SQLite backup runbook. Read that for the detail; read
this for what is different now and what is outstanding.

## Current shape

- **App**: FastAPI + uvicorn, `main:app`, port 8000 inside the container.
- **Image**: `python:3.11-slim`, non-root user `app` (uid 10001), `HEALTHCHECK`
  built in. `--proxy-headers --forwarded-allow-ips *` are already set, so the
  app trusts a reverse proxy in front of it.
- **Stacks**: `docker-compose.staging.yml` (project `roguellm-staging`, port
  18080) and `docker-compose.production.yml` (project `roguellm-production`,
  port 18081). Both publish on `127.0.0.1` only.
- **State**: one named volume per stack mounted at `/app/_data`, holding both the
  SQLite database and all generated art.
- **Health**: `GET /health` and `GET /health/db`.

Both compose files are now the same shape. RogueLLM shares the VPS hardware with
other apps and nothing else: separate project, env file, volume, and port.

## Blocking: the reverse proxy cutover

`docker-compose.production.yml` **no longer joins `chatnext3-network`**. Until
the proxy is repointed, deploying that change breaks production ingress, because
the proxy still resolves RogueLLM by container alias over a network the app is
no longer on.

Before or with that deploy:

1. Point the proxy upstream at `127.0.0.1:${ROGUELLM_HOST_PORT}` (18081) on the
   host, instead of the `roguellm-production` container alias.
2. A containerized proxy cannot reach host loopback directly. Give it
   `extra_hosts: ["host.docker.internal:host-gateway"]` and use that name, or
   address the Docker bridge gateway.
3. Keep the WebSocket upgrade headers for `/ws/*`. The game is entirely
   websocket-driven; HTTP alone will look like it works and then hang.
4. Verify `/health`, `/health/db`, login, and one full websocket run.

Rollback is to restore the `networks:` block in the compose file.

Staging already runs this way and needs no change, which is the evidence the
pattern works on that host.

## New environment variables

Everything below is additive; existing deployments keep working with none of it
set.

| Variable | Default | Notes |
|---|---|---|
| `ENABLE_WORLD_ART` | `0` | Off. Every forge costs real money when on. |
| `IMAGE_MODEL_NAME` | `gpt-image-2` | Do not use `gpt-image-1-mini`: removed from the API 2026-12-01. `gpt-image-1` deprecates 2026-10-23. |
| `IMAGE_MODEL_QUALITY` | `medium` | See the WebP and quality notes below. |
| `IMAGE_MODEL_API_KEY` | falls back to `LOW_SPEC_MODEL_API_KEY` | |
| `IMAGE_MODEL_BASE_URL` | unset | For OpenAI-compatible endpoints. |
| `WORLD_ASSETS_DIR` | `_data/assets` | Inside the existing data volume on purpose. |
| `WORLD_CREATION_TIMEOUT_SECONDS` | `60`, or `600` when art is on | A flat 60s ceiling failed every art-enabled forge. |

## Storage

Generated art lives in `_data/assets/<world_id>/`, inside the same volume as the
database, so there is one thing to back up and one thing to move.

Measured, per World: **30 files, about 20-25 MB**. The database itself is
negligible by comparison — 364 KB for ten Worlds.

That scales badly. A thousand Worlds is roughly 25 GB.

**The single highest-value fix is serving WebP instead of PNG.** Measured on a
real World at quality 85:

| Asset | PNG | WebP | Saving |
|---|---|---|---|
| character frame | 481 KB | 56 KB | 88% |
| location backdrop | 2804 KB | 303 KB | 89% |
| cover card | 1121 KB | 93 KB | 92% |
| map token | 74 KB | 14 KB | 81% |
| **World total** | **20.1 MB** | **~2.1 MB** | **~89%** |

That is a tenfold cut in disk, bandwidth, and mobile download size for no
visible quality loss. Sprites and tokens need the alpha channel, which WebP
supports; backdrops and covers are opaque and could drop alpha for a little
more. The generator writes PNG today (`save_asset` in `gen_image.py`).

## Object storage

Art currently sits on the box, in the same volume as the database. That is fine
while it is small and keeps the "one thing to move" property, but it does not
survive the mobile plan: every player fetching a World's art is egress, and the
VPS pays for all of it.

**The deciding cost here is egress, not storage.** A World is stored once and
downloaded many times, which inverts the usual instinct to shop on price per
stored GB.

Modelled at 1,000 Worlds, 100 plays each, WebP assets — so about 210 GB served
against 2.1 GB stored:

| | Storage | Egress | Total / month |
|---|---|---|---|
| **Cloudflare R2** | $0.03 | **$0** | **~$0.03** |
| Backblaze B2 | $0.01 | $2.04, or $0 through the Cloudflare CDN | ~$2 |
| AWS S3 | $0.05 | $18.90 | ~$19 |

B2 has the cheapest raw storage, roughly 2.5x cheaper than R2, but that barely
registers when the bill is made of traffic. **R2 is the recommendation**, on
zero egress.

Note how this compounds with the WebP conversion above: at 20 MB per World
rather than 2 MB, the same traffic on S3 would be about $190/month. Under the
mobile plan that egress is also the player's mobile data, so the two decisions
push the same way.

Two practical notes:

- **The plumbing already exists.** `db.py` builds a boto3 client with a
  configurable `endpoint_url`, currently pointed at DigitalOcean Spaces for the
  SQLite file. R2 is S3-compatible, so adopting it is an endpoint and a
  credential rather than a rewrite.
- **R2 charges for operations even though egress is free**: Class B reads are
  about $0.36 per million. At 30 files per World that is roughly $1/month in the
  model above. Small, but it argues for something worth doing regardless:
  **ship a World's art as one bundle rather than 30 files.** One request instead
  of thirty is faster on a phone, more reliable on a bad connection, easier to
  cache, and collapses the operation cost. That is a client-architecture
  decision worth making before the app is built.

Suggested order: keep art on the local volume while it is small, convert to
WebP, and move to R2 when art leaves the box — which the mobile client forces.

Related: **backups do not cover art.** `scripts/backup-production-sqlite.sh`
takes the database only, so a host loss keeps the Worlds and loses every image
in them. Either extend it to archive `_data/assets`, or accept art as
regenerable and record that decision.

## Database

SQLite at `_data/rllm_game_data.db`. Schema changes this cycle are additive and
applied automatically by `init_db()` on startup:

- new table `generator_worlds` — the persisted playable snapshot (map as
  cell-type ids, entity placements, tile prose keyed by language) plus the
  `visual_manifest` holding a World's art direction and `cover_url`;
- new column `generator_worlds.visual_manifest`, added through the existing
  `_ensure_column` helper for databases created before it existed.

No manual migration step. Verified against a database predating both.

One trap worth knowing: `save_generator` uses `INSERT OR REPLACE`, which deletes
and reinserts the row. That is why the snapshot lives in its own table rather
than in extra `generators` columns. Anything that mutates a World after save
must use `update_generator_definitions`, not `save_generator` — the World id is
a content hash of the definitions, so re-saving mints a *different* id and
orphans the art written under the original one.

Also: deleting a `generator_worlds` row to force a map rebuild also drops that
World's art manifest, including `cover_url`. They are deliberately disjoint
*columns*, but a whole-row delete ignores that.

`production-publish-plan.md` still proposes Postgres for production. Nothing
here blocks that; the snapshot and manifest are plain JSON columns.

## Runtime characteristics

- A forge with art takes **2-4 minutes** and issues about 20 API calls: 9 text
  on `gpt-4.1-mini`, 11 images on `gpt-image-2`.
- Image generation runs 4 at a time (`ART_CONCURRENCY` in `gen_image.py`).
  Serialised, the same World took over nine minutes.
- **Play makes no model calls at all.** A World's map, placements, and tile
  prose are generated once and persisted; every later run reads them back.
  Expect cost to scale with Worlds forged, not with Worlds played.
- Measured cost per forge: **$0.45 images, $0.018 text**. Images are 96% of it.
  Backdrops are generated at medium quality and then displayed at 40% opacity
  behind a shade gradient; dropping only those to low quality takes a forge to
  about $0.29 with nothing visible lost.

## Open items

- The proxy cutover above. Blocking.
- WebP conversion. Biggest single infrastructure win available, and a
  prerequisite for the mobile client rather than just a saving.
- Object storage on R2 when art leaves the box, reusing the existing boto3
  client. Bundle a World's art into one artifact while doing it.
- Art in backups, or an explicit decision that art is regenerable.
- The sample Worlds are `unlisted`, so they do not appear on a public front
  page. Making them public runs the LLM moderation review in
  `world_moderation.py`. They are the first Worlds whose baked prose the
  reviewer will see, via `collect_baked_prose`.
- `_data/assets/efea0944/` holds orphaned art from a deleted test World.
- Rate limiting and abuse controls for forging are not implemented. Forging is
  the expensive operation and is currently ungated beyond
  `REQUIRE_LOGIN_TO_CREATE_WORLD`.
