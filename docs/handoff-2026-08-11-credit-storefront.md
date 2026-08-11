# RogueLLM handoff — 2026-08-11 — mobile credit storefront

## Git state

- The core-art and credit foundation was committed as `44c3602` (`Add core art
  credit economy`), fast-forwarded into `master`, and pushed to `origin/master`.
- Storefront work continues from that exact commit on
  `feature/credit-storefront` in the isolated worktree. It was intentionally kept
  separate from the already-authorized foundation commit.
- Do not touch the canonical worktree or rename `master`.

## Product decision

Stripe is deferred. Web remains the development/preview surface and cannot buy
credits. The same storefront will run in the mobile shell, where StoreKit or
Play Billing supplies localized products and starts the purchase.

The preview catalog is deliberately easy to revise before store products are
created:

| Product key | Credits | Worlds at default rate | Target price | Per World |
| --- | ---: | ---: | ---: | ---: |
| `credits_40` | 40 | 4 | $1.99 | $0.50 |
| `credits_120` | 120 | 12 | $4.99 | $0.42 |
| `credits_300` | 300 | 30 | $9.99 | $0.33 |

These prices are presentation defaults, not purchase authority. The mobile
store's localized price replaces them when a provider is available.

## What is implemented

- A polished responsive shop is reachable from the header balance, forge hint,
  and signed-in account panel whenever credits are enabled.
- The shop shows balance, forge value, free-play promise, included art retry,
  three packs, and the capped play-to-earn reward.
- Desktop uses a centered three-pack presentation. The 390 px phone layout is a
  safe-area-aware scrolling sheet with no horizontal overflow.
- The copy is present in all six existing languages.
- On web, tapping any pack reports that no charge was made and performs no
  purchase request.

## Native provider contract

`static/js/creditStore.js` looks for an injected
`window.RogueLLMCreditPurchaseProvider` with this shape:

```javascript
{
    isAvailable: async () => true,
    getProducts: async (productKeys) => [
        { productKey: 'credits_120', localizedPrice: '$4.99' }
    ],
    purchase: async (productKey) => ({ verified: true })
}
```

`purchase()` may return `verified: true` only after a server endpoint has
validated the Apple/Google receipt and appended an idempotent paid-credit ledger
entry. The browser never increments a balance. After a reported success, the UI
reloads `/api/me` and `/api/my/stats` and still refuses to show success unless
the server balance increased.

No receipt endpoint or native adapter exists yet, so the provider is absent on
web by design.

## Verification

- `venv/bin/python -m pytest tests/ -q`: 281 passed, 7 skipped, 571 subtests
  passed.
- `node --check` passes for `landing.js` and `creditStore.js`; all six
  translation files parse; `git diff --check` passes.
- Embedded Little Control Room Playwright checked 1440×1000 and 390×844. The
  dialog fits at desktop, scrolls on phone, traps background scrolling, closes
  with Escape, returns focus to the balance trigger, and makes no network request
  when a web pack is tapped. The temporary managed runtime was stopped.

## Before real purchases

The storefront can keep evolving on web with the provider absent. When the
mobile/payment work is deliberately started, it needs:

1. A Capacitor shell and settled iOS/Android bundle identifiers.
2. Create matching consumable product IDs in App Store Connect and Play Console;
   decide whether the preview prices and pack sizes are final first.
3. Add Apple/Google receipt verification endpoints. Key ledger idempotency by the
   store transaction/purchase token, never by a client-generated operation ID.
4. Implement the injected native provider, then exercise purchase, retry,
   cancellation, restore/reconciliation, and duplicate webhook/receipt cases in
   both stores' sandboxes.

No Hetzner, Porkbun, Apple, Google, or Stripe login is needed for the current
storefront work.
