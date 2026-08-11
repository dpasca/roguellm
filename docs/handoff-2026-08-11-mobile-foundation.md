# RogueLLM handoff — 2026-08-11 — mobile foundation and native IAP

## Git state

- Creator milestone rewards landed first as `0ed617d` (`Add creator milestone
  rewards`) and were pushed to `origin/master`.
- Mobile work landed on `master` as `da7028a` (`Add mobile apps and verified
  credit purchases`). Release-credential and secret-mount support followed as
  `465a0ec` (`Configure mobile release credentials`). Apple pre-release
  verification fallback followed as `0e021ea` (`Handle Apple sandbox
  verification before release`). All are on `origin/master`.
- This work was completed from an isolated worktree. That does not change the
  branch or deployment semantics; the canonical worktree was not touched. Do
  not rename `master`.

## Hosting model

The native apps package the lobby and game HTML, JavaScript, Vue, vue-i18n, and
Font Awesome. They do not use Capacitor `server.url` and do not load the live
website as their application shell.

`https://roguellm.com` remains the server for HTTP APIs, game WebSockets, and
generated World art under `/assets/worlds`. The mobile adapter turns relative
asset URLs into that absolute HTTPS origin. Generated assets therefore stay in
the existing `_data/assets` volume and backup flow; they are not copied into an
app release. Firebase remains optional Analytics only, not app or asset
hosting.

## Native projects

- App/bundle id: `com.newtypekk.roguellm`
- Capacitor: 8.5.0
- iOS deployment target: 15.0
- Android min/target/compile SDK: 24/36/36
- Package manager baseline: Node.js 22+
- Android build JDK: 21

`npm run mobile:sync` creates a production bundle for
`https://roguellm.com` and syncs it into `ios/` and `android/`. A staging build
sets `ROGUELLM_API_BASE_URL`, `ROGUELLM_PUBLIC_WEB_URL`, and
`ROGUELLM_APPLE_ENVIRONMENT=sandbox` before running the same command.

The generated `mobile-dist/` and native copied-public directories are ignored;
their source and native project files are tracked. The generated Capacitor icon
and splash are still placeholders and must be replaced with final release
artwork before store submission.

## Native authentication

- Mobile signup/login returns opaque access and refresh tokens. The defaults
  are 15 minutes and 30 days.
- Only SHA-256 token hashes are stored in `mobile_auth_sessions`.
- A refresh atomically rotates both tokens; the old refresh token stops working.
- The access token stays in JavaScript memory. The refresh token uses iOS
  Keychain with `whenUnlockedThisDeviceOnly`, or Android AES-GCM with its key in
  Keystore, through `@aparajita/capacitor-secure-storage`.
- Bearer auth is preferred when an Authorization header is present. A malformed
  or expired bearer token never falls back to a cookie.
- Game-session creation binds the authenticated user id to the opaque session
  id before the WebSocket opens. No bearer token appears in a WebSocket URL.
- Native CORS defaults are exact local Capacitor origins and are configurable
  through `MOBILE_ALLOWED_ORIGINS`.

Endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/mobile/auth/signup` | Create account and mobile session |
| POST | `/api/mobile/auth/login` | Authenticate and create mobile session |
| POST | `/api/mobile/auth/refresh` | Rotate access and refresh tokens |
| POST | `/api/mobile/auth/logout` | Revoke the current mobile session |

The normal authenticated HTTP endpoints, including `/api/me` and
`/api/create_game_session`, accept the bearer token without duplicating their
business logic.

## Store purchase authority

The product catalog remains fixed on the server:

| Product id | Credits | Preview price |
| --- | ---: | ---: |
| `credits_40` | 40 | $1.99 |
| `credits_120` | 120 | $4.99 |
| `credits_300` | 300 | $9.99 |

The native provider uses `capacitor-plugin-cdv-purchase` for StoreKit 2 and Play
Billing. It sets the opaque RogueLLM user UUID as Apple's `appAccountToken` and
Google's `obfuscatedExternalAccountId`. The server never accepts a credit amount
from the device.

Apple verification fetches the transaction through the App Store Server API,
validates Apple's signed JWS against configured root certificates, and checks
bundle, environment, app account token, consumable type, product, quantity, and
revocation. Google verification calls
`purchases.productsv2.getproductpurchasev2` and checks package, purchased state,
account id, product, quantity/refundable quantity, and test status.

`store_purchases` has a unique `(provider, external_transaction_id)` key. Its
row and the paid-credit ledger entry are appended in one SQLite transaction.
The native store transaction is finished/consumed only after that operation
succeeds. A crash or redelivery repeats verification but cannot grant twice,
and a transaction already claimed by another account returns a conflict.

Endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/mobile/store/config` | Gate, product catalog, account token |
| POST | `/api/mobile/purchases/verify` | Verify and idempotently grant purchase |

`ENABLE_MOBILE_STORE=0` is the independent default. Token auth and the native
shell can be tested while purchases stay unavailable. Web remains a preview and
never initiates a charge.

## Verification

- `venv/bin/python -m pytest tests/ -q`: 289 passed, 7 skipped, 573 subtests
  passed.
- The dedicated foundation tests cover hashed token rotation/revocation,
  bearer API use, user binding across game-session/WebSocket setup, atomic paid
  grants, same-user idempotency, cross-user conflicts, and the receipt endpoint.
- `npm ci` and `npm run mobile:sync` pass under Node 22.23.2.
- iOS Debug simulator build passes with signing disabled.
- Android `assembleDebug` passes with JDK 21.
- Embedded Little Control Room Playwright checked the live 390×844 storefront,
  including the three packs, balance, free-play/reward copy, and horizontal fit.
  No standalone Playwright package was installed and the managed runtime was
  stopped.
- Production npm dependencies report zero known vulnerabilities. Three moderate
  development-only advisories come through Capacitor CLI's `xcode` dependency;
  there is no non-breaking Capacitor 8 upgrade that removes them today.

## Store provisioning completed on 2026-08-11

Apple is provisioned under the NEWTYPE K.K. team (`69NH26W767`):

- App Store Connect app `RogueLLM`, numeric app id `6800248025`, bundle id
  `com.newtypekk.roguellm`.
- Consumables `credits_40`, `credits_120`, and `credits_300` are Prepare for
  Submission at US prices $1.99, $4.99, and $9.99 respectively.
- Dedicated In-App Purchase key `RogueLLM Purchase Verify`, key id
  `3LJ5D26T57`, issuer id `69a6de72-3df6-47e3-e053-5b8c7c11a4d1`.
- The one-time `.p8` download is held outside the repository. The three current
  public Apple PKI roots were fetched from Apple's PKI page and validated as
  self-signed CA certificates before deployment.

Google Play is provisioned under the NEWTYPE, Japan developer account:

- Play app `RogueLLM`, package `com.newtypekk.roguellm`, with Play App Signing
  active.
- The three matching one-time products are active in 173 countries/regions at
  US prices $1.99, $4.99, and $9.99.
- Internal release `1 (1.0)` contains the signed AAB. Its SHA-256 is
  `24d86faec76e48c1bba0e8d92b3ddb8a488d65e88105357eed546ec16ec9d1ad`.
  The existing two-person `Testers L1` list is attached, the track is active,
  and the signed-in developer account accepted the invite. The opt-in URL is
  `https://play.google.com/apps/internaltest/4701630974171201245`.
- `Testers L1` is also enabled under account-wide License testing with
  `RESPOND_NORMALLY`, so Play can provide test payment methods without real
  charges.
- Dedicated service account
  `roguellm-purchase-verifier@newtypekk-2.iam.gserviceaccount.com` has access
  only to RogueLLM, with read-only app access plus View financial data (the
  Purchases API permission). It has no Google Cloud project role. The Android
  Publisher API is enabled in `newtypekk-2`.
- The first authenticated dummy-token probe immediately after granting access
  returned `401` / insufficient permissions. After propagation, the same
  production-server probe returned `400 Invalid Value`, the expected response
  for a fake purchase token. Service-account and Purchases API access are
  ready.

App Store Connect already contains three Sandbox test accounts, so no new
Apple test identity was created. A production-server probe authenticates to the
Apple sandbox endpoint and returns the expected invalid-transaction response
(`4000006`). The production endpoint returns `401` while RogueLLM has no live
App Store release. Apple staff documents that production App Store Server API
access is locked until the first release is live in
[Developer Forums thread 806452](https://developer.apple.com/forums/thread/806452).
Purchase verification now falls back from production to sandbox on the
pre-release `401` and the post-release transaction-not-found response, but only
while `APPLE_IAP_ALLOW_SANDBOX=1`; the signed transaction is still validated
against the selected environment and bundle.

Android release signing is configured through `ROGUELLM_ANDROID_*` environment
variables. The upload keystore and passwords remain outside Git. Release bundle
creation and `jarsigner` verification pass with JDK 21.

Both Compose stacks mount an ignored server-side `./secrets` directory at
`/run/secrets/roguellm` read-only. Keep `ENABLE_WORLD_CREDITS=0` and
`ENABLE_MOBILE_STORE=0` while deploying the schema and credentials. Temporarily
allow sandbox/test transactions only when a tester build is ready.

## Production deployment completed on 2026-08-11

Commit `0e021ea57549cc85243261111bd3bf43285453dd` is deployed from
`/home/deploy/roguellm-production` on the Hetzner VPS. The app, loopback health
checks, public HTTPS health endpoints, OpenAPI document, mounted credentials,
Apple root certificates, and all six mobile database tables passed verification.
No Porkbun or Firebase hosting change was needed. Firebase remains Analytics
only; APIs and generated assets remain on the VPS.

The pre-deploy backup is `20260811T090416Z`; the post-migration backup is
`20260811T091245Z`. A disposable restore of the latter passed SQLite integrity,
schema, app health, and asset probes. It contains zero worlds intentionally
because the incompatible old worlds were removed, and 182 static asset files
with no generated world assets yet. A fresh snapshot immediately before the
Apple-fallback cutover is `20260811T092455Z`. The rollback image is tagged
`roguellm-production-app:pre-0e021ea`.

Production is deliberately running with these rollout gates off:

- `ENABLE_WORLD_ART=0`
- `ENABLE_WORLD_CREDITS=0`
- `ENABLE_MOBILE_STORE=0`
- `APPLE_IAP_ALLOW_SANDBOX=0`
- `GOOGLE_PLAY_ALLOW_TEST_PURCHASES=0`

## Remaining controlled rollout

1. Replace the placeholder native icon and splash before public submission.
2. On Android, open the internal-test opt-in URL using a `Testers L1` account,
   update to release `2 (1.0.1)`, and confirm native login and game launch.
3. On iOS, run a development-signed build on a Developer Mode device or upload
   a TestFlight build, then use one of the existing Sandbox accounts.
4. For the purchase-test window only, enable the mobile store, Apple sandbox,
   and Google test-purchase flags. Test success, cancellation, retry/redelivery,
   and duplicate verification on both platforms, then turn the sandbox/test
   flags back off.
5. Once generation credits are ready for users, enable
   `ENABLE_WORLD_CREDITS=1` and `ENABLE_MOBILE_STORE=1`. Retest Apple production
   API access after the first App Store release goes live.

Later hardening should add store notification/reconciliation jobs for refunds
or revocations that occur after the initial consumable grant. That is separate
from the now-complete purchase-time verification and idempotency path.

## Mobile lobby follow-up completed on 2026-08-11

Commit `caa82a325c421ae6bbfc2a5c7011ed5ff8e85820` removes the three
simultaneous `Sign Up to Create` prompts from the anonymous lobby. The primary
button now remains `Create World`; tapping it still opens account creation when
the production login gate applies. The anonymous hint and empty gallery remain
informative without repeating the same call to action.

Capacitor `SystemBars` now supplies CSS insets, and the lobby, dialogs, game
header, mobile dock, and panels consume those values with web-safe `env()`
fallbacks. This fixes the bundled Android shell drawing the RogueLLM header
under the system status bar. The change is deployed to the web production app,
whose health endpoint reports the same commit. Rollout flags remain off. The
pre-deploy snapshot is `20260811T121143Z`; rollback source and image are
`20260811T121403Z-pre-caa82a3` and
`roguellm-production-app:pre-caa82a3`.

Signed Android internal release `2 (1.0.1)` is active and available to the
existing internal testers. Its AAB SHA-256 is
`13ecf4d0dc9f285eb7cd1da1f5bdb717adc58ad7623576de6a78b07cf6c06b34`.

Social login should land as Google and Apple together, not Google alone.
[App Review Guideline 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services)
exempts an app that exclusively uses its own account system, so the current
username/password flow does not require Sign in with Apple. Once Google Sign-In
authenticates a user's primary RogueLLM account, the iOS app must also offer an
equivalent privacy-preserving login; in practice that is Sign in with Apple.
No nonfunctional social buttons were added in this release.

Social authentication and the account-deletion policy were implemented in the
next work session. See
[`handoff-2026-08-11-social-auth.md`](handoff-2026-08-11-social-auth.md) for the
current code, console state, verification, and remaining Apple/Play setup.
