# Social authentication handoff — 2026-08-11

This is the newest handoff. It continues
[`handoff-2026-08-11-mobile-foundation.md`](handoff-2026-08-11-mobile-foundation.md).

## Implemented locally

- Production is social-only: Google and Apple are shown with equal prominence;
  username/password signup remains available only in development or behind
  `ENABLE_LEGACY_PASSWORD_AUTH=1`.
- Firebase ID tokens are verified server-side for project, issuer, expiry,
  provider, subject, and recent authentication where required. Verified social
  identities map to stable local users and then use the existing cookie or
  opaque mobile access/refresh sessions.
- Account deletion requires a fresh provider sign-in. Apple access is revoked
  before deletion. Private and unlisted Worlds and their generated assets are
  deleted; public Worlds are retained with no owner; credits, provider metadata,
  and private account data are removed. Only a de-identified transaction marker
  remains to prevent a store purchase from being claimed twice.
- `/delete-account` is a public web entry point and opens the same in-app flow
  required by the stores.
- Native Firebase app config, Google URL handling, Android Google credentials,
  and the iOS Sign in with Apple entitlement are wired into Capacitor.
- The mobile lobby consumes system safe-area insets, so its header stays below
  the Android/iOS status bar.

## Firebase console state

- Project: `roguellm` (`693029179648`).
- Google and Apple providers are enabled.
- Android app: `com.newtypekk.roguellm`.
- iOS app: `com.newtypekk.roguellm`, App Store ID `6800248025`.
- Android debug SHA-1 is registered:
  `AB:88:13:EF:09:DF:32:A2:22:10:19:34:3A:07:44:6C:FE:0A:46:C9`.
- Android upload SHA-1 is registered:
  `DE:05:B3:E4:2B:A9:93:95:23:5A:EC:44:C8:C1:1B:EA:91:53:F9:5D`.
- Play App Signing SHA-1 is registered:
  `6C:C7:5E:A5:BA:EC:EA:DC:D9:26:D4:5E:4C:76:E5:92:8B:78:1C:60`.
- OAuth authorized domains now include `roguellm.com` and
  `www.roguellm.com`, in addition to the Firebase defaults.
- Sign in with Apple is enabled on the primary App ID
  `com.newtypekk.roguellm` under team `69NH26W767`.
- Web Services ID `com.newtypekk.roguellm.web` is grouped with that primary
  App ID. Its domain is `roguellm.firebaseapp.com` and its return URL is
  `https://roguellm.firebaseapp.com/__/auth/handler`.
- Dedicated Sign in with Apple key `RogueLLM Sign In With Apple` has key ID
  `94J7363CD3`. The one-time private key is stored outside the repository at
  `~/.config/roguellm/secrets/apple-sign-in-AuthKey_94J7363CD3.p8` with mode
  `0600`; Firebase has the matching Services ID, team ID, key ID, and private
  key in the Apple provider OAuth code-flow configuration.

## Verification completed

- Python suite: 299 passed, 7 skipped, 573 subtests passed.
- Mobile bundle and Capacitor sync pass with Node 22.
- Android debug build passes with JDK 21, including Google Services processing.
- Unsigned iOS Simulator build passes with Firebase Auth 12.17.0 and Google
  Sign-In 9.2.0.
- Embedded Playwright at 390×844 confirms one concise sign-in prompt, equal
  Google/Apple buttons, a safe account sheet, and direct `/delete-account`
  routing.
- Real Google web sign-in passes end to end: provider consent, Firebase token
  issue, server verification, stable local identity, cookie session, `/api/me`,
  and authenticated account/World state all succeeded.
- Real Apple web sign-in also passes end to end: Apple login and privacy
  consent, the Firebase callback and code exchange, Firebase token issue,
  server verification, stable local identity, cookie session, and `/api/me`
  all succeeded. `/api/me` returned `200` with `auth_providers: ["apple"]`.

## Production deployment completed — 2026-08-12

- Commit `9060be2c7f5dc592b0fa51741e54ad88357d74ef` is deployed from
  `/home/deploy/roguellm-production`. The production environment explicitly
  sets `ENABLE_SOCIAL_AUTH=1` and `ENABLE_LEGACY_PASSWORD_AUTH=0`.
- The reverse-proxy CSP was extended for the Firebase auth iframe and the
  Google endpoints actually used by Firebase Auth. It now permits the Firebase
  project iframe, Google API loader, Identity Toolkit and token endpoints,
  Google account frames, and the current Analytics collector. The vhost passed
  `nginx -t` before each zero-downtime reload. Timestamped pre-change copies are
  beside `/opt/chatnext3/nginx/extra_conf.d/roguellm-production.conf`.
- Public and loopback `/health`, `/health/db`, `/`, `/delete-account`, and
  `/openapi.json` all pass. A new 390x844 browser session loads without CSP or
  application console errors.
- Real production Google and Apple sign-in both pass through their provider,
  Firebase, `POST /api/auth/firebase`, the signed production cookie, and
  `/api/me`. The server logged two `200` auth exchanges with no exception;
  `/api/me` reported `auth_providers: ["google"]` and `["apple"]`
  respectively. The managed browser was signed out afterward.
- The pre-deploy data snapshot is `20260811T145034Z`. The post-migration and
  post-login snapshot is `20260811T171839Z`; its checksums and SQLite integrity
  pass, and a network-isolated disposable restore passed schema, app health,
  database health, and asset probes.
- Rollback source/config is
  `/home/deploy/roguellm-production-rollbacks/20260811T145311Z-pre-9060be2`.
  The prior image is tagged `roguellm-production-app:pre-9060be2`.
- World art, world credits, the mobile store, Apple sandbox purchases, and
  Google test purchases remain disabled. No DNS, Porkbun, or Firebase Hosting
  change was needed.

## Remaining rollout work

1. Adding Sign in with Apple invalidated provisioning profiles that included
   the RogueLLM App ID. Regenerate or let Xcode automatically regenerate them
   before the next signed iOS archive or device build.
2. Build and distribute fresh Android internal-test and iOS TestFlight builds,
   then confirm native Google/Apple login and bearer-session exchange on real
   devices.
3. Run the destructive account-deletion smoke test with a sacrificial provider
   account before publishing new store builds. Do not delete a maintainer's
   real Google or Apple RogueLLM identity merely to exercise this path.
