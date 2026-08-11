# RogueLLM handoff — 2026-08-11 — mobile foundation and native IAP

## Git state

- Creator milestone rewards landed first as `0ed617d` (`Add creator milestone
  rewards`) and were pushed to `origin/master`.
- Mobile work was built from that exact tip on `feature/mobile-foundation` in
  the isolated worktree. Use Git history to locate the final integration
  commit.
- The canonical worktree was not touched; do not rename `master`.

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

- `venv/bin/python -m pytest tests/ -q`: 288 passed, 7 skipped, 571 subtests
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
  No tester list is configured yet, so the release is not installable by a
  tester until one is added.
- Dedicated service account
  `roguellm-purchase-verifier@newtypekk-2.iam.gserviceaccount.com` has access
  only to RogueLLM, with read-only app access plus View financial data (the
  Purchases API permission). It has no Google Cloud project role. The Android
  Publisher API is enabled in `newtypekk-2`.
- The first authenticated dummy-token probe immediately after granting access
  returned `401` / insufficient permissions. Keep the store gate off and retry
  after Play permission propagation; a non-401/403 invalid-token response is
  the readiness signal.

Android release signing is configured through `ROGUELLM_ANDROID_*` environment
variables. The upload keystore and passwords remain outside Git. Release bundle
creation and `jarsigner` verification pass with JDK 21.

Both Compose stacks mount an ignored server-side `./secrets` directory at
`/run/secrets/roguellm` read-only. Keep `ENABLE_WORLD_CREDITS=0` and
`ENABLE_MOBILE_STORE=0` while deploying the schema and credentials. Temporarily
allow sandbox/test transactions only when a tester build is ready.

## What needs external accounts

No Porkbun change is required. Hetzner is needed only to deploy the updated
server and add secret environment values. Before enabling purchases:

1. In App Store Connect, register the app/bundle id, create the three
   consumables, create an App Store Server API key, and note the numeric Apple
   app id, issuer id, and key id. Install the private key and Apple roots only on
   the server. Root certificates may be configured as comma-separated base64
   DER values, which avoids adding a Docker secret mount.
2. In Play Console, register the same package, create the three one-time
   products, link a Google Cloud service account with order/purchase access, and
   install its JSON only on the server.
3. Configure Apple signing/team and Android upload signing, replace the
   placeholder icon/splash, and build a sandbox/internal-test app.
4. Deploy with the server variables from `_env.example`. Temporarily allow
   Apple sandbox and Google license-tester purchases, test success,
   cancellation, retry/redelivery, and duplicate verification, then restore
   production-only policy and set `ENABLE_WORLD_CREDITS=1` plus
   `ENABLE_MOBILE_STORE=1`.

Later hardening should add store notification/reconciliation jobs for refunds
or revocations that occur after the initial consumable grant. That is separate
from the now-complete purchase-time verification and idempotency path.
