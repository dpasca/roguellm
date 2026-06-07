# World Ownership And Sharing Plan

## Goal

Improve the reusable World experience without jumping into a large auth rewrite.
Players should eventually have their own generated Worlds, decide which ones are
private or shareable, and browse public Worlds created by others.

This plan keeps the current local/dev world picker working while adding the data
model needed for users later.

## Terms

- **World**: reusable generated setting and definitions currently stored in the
  `generators` table.
- **Run**: one play session inside a World.
- **Owner**: the user who generated or imported a World.
- **Visibility**:
  - `private`: only the owner can see or start it.
  - `unlisted`: not shown in public lists, but startable by direct World ID/link.
  - `public`: shown in public World lists.

## Original State

- Worlds are stored in `generators`.
- There is no user model.
- `/api/worlds/recent` returns recent reusable Worlds when local or
  `ENABLE_WORLD_LIBRARY=1`.
- Starting a World by ID works.
- Quick Start prefers the seeded dev Piedone World when present.

## Implementation Status

See [production-publish-plan.md](production-publish-plan.md) for the broader
publish-readiness plan covering open-source safety, VPS hosting, Postgres,
auth hardening, and public World moderation.

- Phase 1 is implemented: `generators` has ownership, visibility, and update
  timestamp fields; existing rows are backfilled to `unlisted`; writes validate
  visibility.
- Phase 2 is implemented for anonymous and session-based access: public Worlds
  are browsable, unlisted Worlds resolve by direct ID, and private Worlds are
  blocked unless the logged-in requester owns them.
- Phase 3 is implemented as minimal username/password session auth.
- Phase 4 is implemented for the WebSocket creation flow: logged-in generated
  Worlds default to `private`; production forces new generated Worlds to remain
  private by default.
- Production now requires login before creating a fresh generated World by
  default via `REQUIRE_LOGIN_TO_CREATE_WORLD`; local development remains open
  unless that flag is enabled.
- Phase 5 is implemented with `PATCH /api/worlds/{world_id}/visibility` and an
  owner-only control in the World picker.
- Phase 6 has an initial UI: compact signup/login/logout controls, `My Worlds`,
  `Public`, and local-only `Recent Dev` tabs, direct share-link copying, and
  visibility display.
- Phase 6 now also explains the account payoff: signing in saves generated
  Worlds privately to `My Worlds`, anonymous play remains possible, and empty
  states point users toward creating a saved private World.
- The landing page now centers `Play Worlds` and `Create World`; the visible
  Fantasy Theme entry point is removed while the backend fantasy fallback
  remains for legacy/dev requests.
- Public visibility requests run LLM review immediately with a waiting modal
  unless the internal pending-review queue is over the inline-review threshold.
  The reviewer receives the original prompt plus generated public/playable
  World data; raw web-search results are excluded. A World remains private or
  unlisted while `moderation_status = pending`; only an approved review may
  change `visibility` to `public`.

## Desired Experience

Before login:

- Public Worlds can be browsed.
- Unlisted Worlds can be opened by link/World ID.
- Fresh generated Worlds require signup/login in production.
- Local/dev behavior remains easy.

After login:

- Users can see `My Worlds`.
- New generated Worlds are owned by the current user.
- Users can change visibility between private and unlisted immediately.
- Users can request public visibility; public Worlds appear in a public list
  only after automated LLM approval.
- Shared links keep working for unlisted/public Worlds.

## Phase 1: Add Ownership And Visibility Shape

Add nullable ownership fields to `generators` without requiring login yet.

Suggested columns:

```sql
owner_id TEXT NULL;
visibility TEXT NOT NULL DEFAULT 'unlisted';
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

Initial migration behavior:

- Existing Worlds become `unlisted`.
- Existing Worlds have `owner_id = NULL`.
- Local/dev tools continue to work.
- Seeded dev Worlds stay unlisted unless we explicitly make them public.

Validation rules:

- `visibility` must be one of `private`, `unlisted`, `public`.
- `owner_id` can stay nullable until auth exists.

## Phase 2: Split World Listing Semantics

Keep backwards compatibility, but make intent clearer.

Suggested API behavior:

- `GET /api/worlds/recent`
  - Local/dev: returns recent Worlds for convenience.
  - Deployment: returns public Worlds only, plus unlisted only by exact ID.
- `GET /api/worlds/{world_id}`
  - Returns World metadata when visible to the requester.
  - Allows unlisted links to resolve.
- Later: `GET /api/my/worlds`
  - Requires login.
  - Returns private, unlisted, and public Worlds owned by the user.

Start permissions:

- `public`: anyone can start.
- `unlisted`: anyone with direct ID can start.
- `private`: only owner can start.

## Phase 3: Minimal User Model

Do this only after visibility is in place.

Suggested tables:

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Session behavior:

- Use the existing Starlette session middleware.
- Store `user_id` in the session after login.
- No email verification at first.
- Password hashing should use a real password hash library, not plain hashes.

Minimal pages/API:

- `POST /api/signup`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`

## Phase 4: Own New Worlds

When a logged-in user creates a new World:

- Save `owner_id = current_user.id`.
- Default `visibility = private` or `unlisted`.

Recommended default:

- `private` for real users.
- `unlisted` for local/dev anonymous flows.

This avoids accidentally putting user-generated Worlds into a global list.

Production policy:

- Require login for fresh World generation.
- Keep starting existing public and unlisted Worlds anonymous.
- Allow local/dev deployments to keep anonymous generation unless
  `REQUIRE_LOGIN_TO_CREATE_WORLD=1` is set.

## Phase 5: Visibility Controls

Add UI controls on owned Worlds:

- Private
- Unlisted/share link
- Public

Add endpoint:

```http
PATCH /api/worlds/{world_id}/visibility
```

Rules:

- Requires login.
- Only owner can change visibility.
- Validate requested visibility.

## Phase 6: UI Shape

World picker tabs:

- `My Worlds` when logged in.
- `Public`.
- `Recent Dev` only for local/dev mode if still useful.

World detail actions:

- Start Run.
- Copy Share Link.
- Change Visibility if owner.

Keep the first iteration plain. Avoid a large dashboard until the model is solid.

## Testing Plan

Phase 1 tests:

- DB migration adds `owner_id`, `visibility`, and `updated_at`.
- Existing Worlds default to `unlisted`.
- `list_worlds` does not expose `private` Worlds to anonymous callers.
- Direct lookup allows `unlisted` Worlds.
- Direct lookup blocks `private` Worlds without owner.

Phase 2 tests:

- Public list returns only public Worlds outside local/dev mode.
- Local/dev list still returns seeded dev Worlds.
- Starting public/unlisted Worlds works.
- Starting private Worlds without owner fails.

Phase 3 tests:

- Signup creates user.
- Login stores session `user_id`.
- Logout clears session.
- Duplicate username is rejected.

Phase 4 tests:

- Logged-in generated World gets `owner_id`.
- Login-required deployments reject anonymous fresh World generation.
- Existing public/unlisted Worlds can still start anonymously.
- Local/dev anonymous generated Worlds do not become public by default.

## Open Questions

- Should unlisted Worlds be visible in the generic recent list during local dev
  only, or also in private deployments?
- Should public Worlds get a human appeal path after automated rejection?
- Should users be able to fork another public World into their own private copy?
- Should Runs be persisted per user, or are only Worlds owned at first?

## Recommended Next Implementation Step

The pre-moderation production policy for public visibility is implemented:

1. Direct `public` updates are replaced with a pending-review request flow.
2. UI status covers private, public-review-pending, approved, rejected,
   human-review-needed, and review-error Worlds.
3. The reviewer uses a configurable OpenAI-compatible model via
   `WORLD_PUBLIC_REVIEW_MODEL_*`, falling back to `LOW_SPEC_MODEL_*`.

Recommended next implementation step:

1. Choose the dedicated production review model.
2. Exercise immediate review, overloaded queued review, and the background
   worker in staging.
3. Add an admin/human appeal path for `needs_human_review` and disputed
   rejections.
