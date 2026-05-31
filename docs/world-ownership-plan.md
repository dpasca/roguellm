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
  Worlds default to `private`, while anonymous generated Worlds default to
  `unlisted`.
- Phase 5 is implemented with `PATCH /api/worlds/{world_id}/visibility` and an
  owner-only control in the World picker.
- Phase 6 has an initial UI: compact signup/login/logout controls, `My Worlds`,
  `Public`, and local-only `Recent Dev` tabs, direct share-link copying, and
  visibility display.

## Desired Experience

Before login:

- Public Worlds can be browsed.
- Unlisted Worlds can be opened by link/World ID.
- Local/dev behavior remains easy.

After login:

- Users can see `My Worlds`.
- New generated Worlds are owned by the current user.
- Users can change visibility between private, unlisted, and public.
- Public Worlds appear in a public list.
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
- `unlisted` for anonymous/dev flows.

This avoids accidentally putting user-generated Worlds into a global list.

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
- Anonymous generated World does not become public by default.

## Open Questions

- Should anonymous generated Worlds be allowed in production?
- Should unlisted Worlds be visible in the generic recent list during local dev
  only, or also in private deployments?
- Should public Worlds require moderation later?
- Should users be able to fork another public World into their own private copy?
- Should Runs be persisted per user, or are only Worlds owned at first?

## Recommended Next Implementation Step

Tighten the logged-in creation flow:

1. Make sure a newly generated logged-in World appears in `My Worlds` after the
   first run is created.
2. Add UI copy or status around the default `private` visibility for new logged
   in Worlds.
3. Add a smoke test for creating a logged-in custom World with a mocked game
   generator and then listing it through `GET /api/my/worlds`.
