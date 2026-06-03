# Production Publish Plan

## Goals

- Publish RogueLLM with login and `My Worlds` without treating user accounts as
  a synced local save file.
- Keep Worlds private by default.
- Let users request public visibility only after an automated LLM safety review.
- Keep the open-source repo free of production secrets, personal notes, VPS
  access details, private IPs, SSH key paths, and real user data.

## Non-Goals For First Publish

- Full social network features.
- Public moderation queues with many admin roles.
- Cross-app shared auth with AskMei.
- Copying ChatNext3 TypeScript auth directly into this Python app.

## Publish-Soon Track

Keep the work in small publishable slices so the app remains usable:

1. Current guardrail slice:
   - Production loads env before session middleware is constructed.
   - `APP_ENV=production` refuses missing, placeholder, or short
     `SESSION_SECRET_KEY` values.
   - Production sessions use HTTPS-only cookies with explicit SameSite and max
     age settings.
   - Newly generated Worlds default to `private`; production ignores
     non-private default overrides.
   - Fresh World generation requires login in production; existing public and
     unlisted Worlds remain anonymously playable.
2. Staging slice:
   - Dockerize the current app on the VPS behind HTTPS.
   - Add `/health` and `/health/db` checks.
   - Run a source-open/secret scan before pushing or deploying.
   - Keep signups limited or clearly temporary until Postgres migrations land.
3. Public-login slice:
   - Move users and Worlds to Postgres with migrations.
   - Add signup rate limits and stronger password hashing.
   - Keep all Worlds private unless reviewed.
4. Public-worlds slice:
   - Add the five-minute pending public request flow.
   - Run structured LLM moderation before any World becomes browseable.

Completed publish-hardening slice:

- Raw LLM prompts, user themes, generated descriptions, generated definitions,
  map CSV, entity placements, and web-search results are no longer logged by
  default. Full LLM content logging now requires `ENABLE_LLM_CONTENT_LOGGING=1`.
- Login has a basic in-process failed-attempt throttle.
- Public/user-facing auth and World API responses no longer return stable
  internal user IDs or `owner_id`; clients receive `can_manage` instead.
- Password hash verification uses constant-time comparison.

## Source-Open Safety Rules

- Do not commit `.env`, production hostnames tied to private operations, VPS IPs,
  SSH usernames, SSH key paths, Slack webhooks, database URLs, API keys, object
  storage credentials, or production backup locations.
- Keep deployment-specific values in ignored local files such as
  `ops/.env.production`, `scripts/.env`, or the server-side environment.
- Docs in this repo should use placeholders like `<ROGUELLM_HOST>`,
  `<VPS_HOST>`, and `<DATABASE_URL>`.
- Do not include personal notes or real user examples in prompts, fixtures, seed
  data, tests, screenshots, or moderation examples.
- Add a secret scan before release and keep `.gitignore` broad enough for local
  deploy artifacts, logs, backups, and generated env files.

## Hosting Direction

Use the underused AskMei VPS, but do not reuse the current SQLite object-storage
sync pattern for accounts.

Recommended deployment shape:

- Docker image for RogueLLM.
- Postgres as the production database.
- One reverse proxy owns public ports `80` and `443`.
- RogueLLM app container listens only on an internal Docker network.
- Health endpoints support deployment checks.
- Backups are database-native, not whole SQLite file uploads.

ChatNext3 provides useful patterns to mirror:

- Docker Compose orchestration.
- App container health checks.
- Nginx plus certbot, or an equivalent single ingress proxy.
- Deploy user instead of root.
- Preflight checks before deploy.
- Health/version endpoints.
- Migration and backup runbooks.

Do not copy ChatNext3 production access details or real env values into this repo.

## Staging Docker Runbook

The current staging compose file is intentionally SQLite-backed and should be
treated as a smoke-test bridge, not the final public-account architecture.

1. Create an ignored staging env file from the template:

   ```bash
   cp _env.example .env.staging
   ```

2. In `.env.staging`, set at least:

   ```bash
   APP_ENV=production
   SESSION_SECRET_KEY=<32+ character random secret>
   LOW_SPEC_MODEL_API_KEY=<api key>
   HIGH_SPEC_MODEL_API_KEY=<api key>
   DEFAULT_NEW_WORLD_VISIBILITY=private
   REQUIRE_LOGIN_TO_CREATE_WORLD=1
   ```

3. Build and start the app on a loopback-only host port:

   ```bash
   docker compose -f docker-compose.staging.yml up --build -d
   ```

   The default host port is `127.0.0.1:18080`. Override it from the shell if the
   VPS already uses that port:

   ```bash
   ROGUELLM_HOST_PORT=18081 docker compose -f docker-compose.staging.yml up --build -d
   ```

4. Verify locally on the VPS before adding ingress:

   ```bash
   curl -fsS http://127.0.0.1:18080/health
   curl -fsS http://127.0.0.1:18080/health/db
   ```

5. Point the reverse proxy upstream at `http://127.0.0.1:18080`, including
   WebSocket upgrade headers for `/ws/*`.

Do not commit `.env.staging`, generated databases, logs, backups, or reverse
proxy files containing real hostnames or private paths.

## DNS And Reverse Proxy Plan

DNS can point a hostname to the VPS, but the VPS still needs an ingress proxy to
route traffic by hostname.

Current status:

- Staging is live on the VPS through the shared ChatNext3 Nginx ingress.
- A separate `roguellm-production` VPS stack has been prepared with its own env,
  container, volume, loopback port, and Docker network alias.
- Production DNS has been moved to the registrar-managed zone and points at the
  VPS ingress. Keep concrete DNS records, server IPs, and registrar credentials
  out of this repo.

Recommended staged approach:

1. Choose hostnames:
   - Staging: `roguellm-staging.<domain>` or `play-staging.<domain>`.
   - Production: `roguellm.<domain>` or `play.<domain>`.
2. Set DNS TTL low, such as 300 seconds, during cutover.
3. Add `A` and, if applicable, `AAAA` records pointing to the VPS.
4. On the VPS, use one of these ingress options:
   - Preferred: a shared top-level Caddy/Traefik/Nginx proxy that routes
     hostnames to app containers on a shared Docker network.
   - Acceptable short-term: extend the existing ChatNext3 Nginx container with a
     separate `server_name` block for RogueLLM.
   - Avoid: running a second independent Nginx container on `80`/`443`; it will
     conflict with ChatNext3.
   - If using ChatNext3 Nginx, do not put RogueLLM server blocks in
     `active_upstream.conf`; ChatNext3 deploys rewrite that file. Use a
     separate mounted include directory for deployment-specific ingress files.
5. Add WebSocket proxy headers for `/ws/*`.
6. Issue TLS certificates after DNS points at the VPS.
7. Verify:
   - `GET /health`
   - `GET /health/db`
   - landing page loads over HTTPS
   - WebSocket game creation works over HTTPS

If we use Cloudflare or another DNS proxy later, confirm WebSocket support,
request body limits, caching behavior, and ACME challenge behavior.

Production cutover checklist:

1. Keep staging on a separate staging hostname.
2. Keep the production app running separately as `roguellm-production`.
3. Add a pending HTTP-only Nginx server block for `roguellm.com` and `www`.
4. Confirm `curl --resolve roguellm.com:80:<VPS_IP> http://roguellm.com/health`
   reaches the production stack.
5. Update registrar DNS records for apex and `www` to the VPS.
6. Wait for DNS to resolve to the VPS.
7. Issue a Let's Encrypt certificate for apex and `www` using the shared Nginx
   webroot.
8. Replace the pending HTTP-only block with the final HTTPS block.
9. Smoke test HTTPS health, login/session, `My Worlds`, private Worlds, and WSS.

Completed cutover notes:

- The active RogueLLM production ingress lives in the shared reverse proxy's
  deployment-specific include directory, not in ChatNext3's generated active
  upstream file.
- The ACME challenge locations use `^~ /.well-known/acme-challenge/` so the
  dotfile deny rule does not intercept Let's Encrypt probes.
- The shared certbot renewal cron runs `certbot renew` over the shared
  certificate directory and reloads Nginx after a successful run.

## Database Plan

Replace SQLite/object-storage sync with Postgres before public accounts.

Schema direction:

- `users`
  - `id UUID PRIMARY KEY`
  - `username` or `email` unique, normalized
  - `password_hash`
  - `created_at`
  - `updated_at`
  - optional auth metadata later
- `worlds`
  - `id UUID PRIMARY KEY`
  - existing generator definition columns
  - `content_hash TEXT`
  - `owner_id UUID NULL REFERENCES users(id)`
  - `visibility TEXT NOT NULL DEFAULT 'private'`
  - `moderation_status TEXT NOT NULL DEFAULT 'not_requested'`
  - `public_requested_at TIMESTAMP NULL`
  - `public_review_after TIMESTAMP NULL`
  - `public_reviewed_at TIMESTAMP NULL`
  - `moderation_reason TEXT NULL`
  - `created_at`, `updated_at`
- `world_moderation_reviews`
  - review input snapshot
  - model name
  - structured output JSON
  - decision
  - created_at

Important fixes:

- Use random World IDs, not short content-hash IDs.
- Stop using `INSERT OR REPLACE` for Worlds.
- Keep `content_hash` only for dedupe or debugging.
- Default logged-in generated Worlds to `private` for production.
- Keep anonymous fresh generation disabled in production; allow anonymous starts
  only for existing public and unlisted Worlds.
- Add migrations with a repeatable tool such as Alembic.
- Add indexes on `owner_id`, `visibility`, `moderation_status`, and
  `updated_at`.

## Auth Hardening Plan

Before public launch:

- Load production env before constructing session middleware.
- Fail startup in production if `SESSION_SECRET_KEY` is missing or placeholder.
- Configure secure session cookies:
  - HTTPS-only
  - SameSite
  - explicit max age
- Replace hand-rolled PBKDF2 with Argon2id or bcrypt via a maintained library.
- Normalize usernames or switch to email-based login.
- Increase password requirements.
- Add signup rate limits and replace the in-process login throttle with a
  shared production limiter once the app has Postgres/Redis or equivalent.
- Use generic login failure messages.
- Avoid returning stable `owner_id` to public clients; prefer `can_manage`.
- Add audit logs for visibility and moderation state changes.

Optional before first publish, but important soon:

- Email verification.
- Password reset.
- Account deletion.
- Admin user management.

## Public Visibility And LLM Review

Worlds stay private by default.

Visibility states should distinguish user intent from reviewed public state:

- `private`: visible only to owner.
- `unlisted`: visible by direct link if we choose to keep this mode.
- `public_pending`: owner requested public listing; not browseable yet.
- `public`: browseable.
- `rejected`: not public; owner can edit/fork/request again later.

If we keep `visibility` limited to `private`, `unlisted`, `public`, then add a
separate `moderation_status`:

- `not_requested`
- `pending`
- `approved`
- `rejected`
- `error`

Recommended flow:

1. Owner clicks “Make Public”.
2. API sets `moderation_status = 'pending'`, records `public_requested_at`, and
   sets `public_review_after = now + 5 minutes`.
3. World remains private or unlisted while pending.
4. A background worker picks up due reviews.
5. The worker calls an LLM with structured output.
6. If approved, set `visibility = 'public'` and
   `moderation_status = 'approved'`.
7. If rejected, keep it non-public and store a short non-sensitive reason.
8. UI shows pending/rejected/approved status.

Use model-based structured review as the primary classifier. Do not implement
keyword or regex gates as the primary moderation logic.

Review should check:

- Direct personal information: emails, phone numbers, physical addresses,
  government IDs, precise school/workplace plus identifying details.
- Secrets: API keys, tokens, passwords, private URLs, internal hostnames.
- Offensive, hateful, sexual, violent, exploitative, or harassing content.
- Real-person defamation or targeted private claims.
- Copyright/trademark issues if the generated World is obviously trying to
  republish protected material.
- Prompt-injection attempts in World text.
- Child safety risks.

Structured output sketch:

```json
{
  "decision": "approve | reject | needs_human_review",
  "confidence": 0.0,
  "categories": ["pii", "secrets", "hate", "sexual", "violence", "copyright", "prompt_injection"],
  "public_reason": "Short user-safe reason.",
  "internal_notes": "Short admin note without reproducing sensitive details."
}
```

Do not store or display the sensitive snippets that triggered rejection unless
we have a deliberate admin-only redaction design.

## Deployment Plan

1. Create a staging branch and staging hostname.
2. Add Dockerfile and compose file for RogueLLM.
3. Add Postgres service or managed Postgres connection.
4. Add health endpoints.
5. Add Alembic migrations.
6. Migrate local/dev SQLite data only if needed; otherwise seed fresh public/dev
   Worlds.
7. Add ingress routing on the VPS without disrupting AskMei.
8. Issue TLS cert for staging hostname.
9. Run smoke tests against staging.
10. Enable production hostname.
11. Keep public signup disabled, invite-only, or heavily rate-limited until
    moderation and monitoring are verified.

## Operational Checks

- Backups:
  - daily SQLite backup while this publish-soon bridge still uses SQLite
  - daily Postgres backup after the database migration
  - before every migration
  - restore test before launch
- Monitoring:
  - app health
  - DB health
  - disk space
  - container restarts
  - moderation queue age
  - failed login rate
- Logs:
  - no secrets
  - no raw passwords
  - avoid logging full World text in moderation failures
- Release:
  - preflight checks
  - migration backup
  - deploy
  - verify health
  - verify WebSocket
  - verify login
  - verify private/public visibility

## SQLite Bridge Backup Runbook

This is a temporary bridge until production accounts and Worlds move to
Postgres. The backup script is safe to keep in the open repo because it uses
placeholder-friendly defaults and expects deployment-specific paths to be passed
through the server-side environment.

Manual backup:

```bash
APP_DIR=<APP_DIR> BACKUP_ROOT=<PRIVATE_BACKUP_DIR> \
  scripts/backup-production-sqlite.sh
```

Cron shape:

```cron
17 2 * * * APP_DIR=<APP_DIR> BACKUP_ROOT=<PRIVATE_BACKUP_DIR> <APP_DIR>/scripts/backup-production-sqlite.sh >> <PRIVATE_BACKUP_DIR>/backup.log 2>&1
```

The script:

- creates a consistent copy with SQLite's online backup API inside the running
  app container;
- copies the backup out with `docker cp`;
- compresses it with `gzip`;
- validates the compressed archive with `PRAGMA integrity_check`;
- writes a checksum and small metadata file;
- prunes files older than `RETENTION_DAYS`, defaulting to 14 days.

## Suggested Implementation Order

1. Add this production plan and source-open guardrails.
2. Add Dockerfile/compose for local production-like run.
3. Replace SQLite with Postgres behind a DB interface.
4. Convert World IDs to random IDs and remove `INSERT OR REPLACE`.
5. Harden auth/session cookies/password hashing/rate limits.
6. Add moderation tables and pending-public workflow.
7. Add LLM moderation worker.
8. Add VPS ingress/DNS staging deployment.
9. Run staging smoke tests.
10. Publish with public signup limited until reviewed.
