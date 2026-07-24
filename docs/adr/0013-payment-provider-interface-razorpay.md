# ADR 0013: PaymentProvider behind DI interface — Razorpay via built-in fetch + node:crypto, lazy key validation

## Status
Accepted

## Context
`CLAUDE.md §1` requires that every external vendor call go through a provider interface
(`PaymentProvider`). Phase-2 introduces real payment processing via Razorpay (India-first
per `docs/00-product-strategy.md`). Three constraints shaped the implementation:

1. No additional npm dependency for a simple REST integration — Razorpay's REST API can
   be called with built-in `fetch`; their Node SDK is not worth the supply-chain
   surface for what amounts to two signed HTTP calls.
2. HMAC-SHA256 signature verification must be constant-time (`timingSafeEqual`) to
   prevent timing-oracle attacks (see `docs/03-prd-crm.md §20`).
3. The application must boot cleanly even when `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`
   are not yet provided by the operator (TEST mode keys or staging config not yet
   supplied). Throwing at construction would break `pnpm dev` for all developers who
   don't have Razorpay credentials.

An earlier draft of the provider threw during DI construction if keys were absent. This
was remediated (Wave 6 QA) after it was found to break boot.

## Decision
`apps/api/src/modules/commerce/providers/razorpay.payment-provider.ts` implements
`PaymentProvider` (behind the `PAYMENT_PROVIDER` DI token) using:

- **Built-in `fetch`** for all Razorpay REST calls (create order, initiate refund,
  fetch payment). No `razorpay` npm SDK dependency.
- **`node:crypto` HMAC-SHA256 + `timingSafeEqual`** for both payment signature
  verification (`verifyPaymentSignature`) and webhook signature verification
  (`verifyWebhookSignature`).
- **Lazy key validation**: the constructor only emits a warning log if keys are
  absent. Methods `createOrder` and `refund` throw a configuration error at *call
  time* if keys are missing. `verifyPaymentSignature` and `verifyWebhookSignature`
  **fail closed** (return `false`) rather than throw, so unsigned/unkeyed paths are
  rejected without crashing.
- **Fail-closed webhook**: `RAZORPAY_WEBHOOK_SECRET` is optional in `.env.example`;
  when absent, all webhook payloads are rejected. This is intentional — accepting
  unverified webhooks is a security risk. The webhook endpoint is marked `@Public`
  and excluded from CSRF, but protected by the HMAC check.

## Consequences
- The application boots without Razorpay credentials; developers who do not need
  payment flows are unaffected.
- Live webhooks are non-functional until the operator sets `RAZORPAY_WEBHOOK_SECRET`.
  This is documented in `docs/phase-2-followups.md` and in `.env.example`.
- Swapping to a different payment provider (e.g. Stripe for international) requires
  only a new class implementing `PaymentProvider` and a DI binding change — no change
  to `OrdersService` or `PaymentsService`.
- No new runtime dependency means no new supply-chain audit surface for the core
  payment path. The trade-off is that Razorpay SDK convenience features (e.g. error
  type helpers) are not available; errors are handled by inspecting HTTP status codes
  and response bodies directly.

## Alternatives considered
- **Use the `razorpay` npm SDK**: simpler code, but adds a dependency to the hot
  payment path and its own transitive deps. Rejected — the REST surface we use is
  small enough that built-in fetch is sufficient and preferable.
- **Throw at construction if keys are absent**: consistent fail-fast style with the
  rest of the zod-validated env. Rejected after Wave 6 found it breaks dev boot;
  lazy validation achieves the same security posture at call time without blocking
  developers who haven't provisioned keys.
- **Accept webhooks without HMAC verification when secret is absent**: would have
  allowed non-production testing without setting the secret. Rejected — fail-closed
  is the safer default; an attacker who can reach the webhook endpoint could otherwise
  trigger arbitrary payment-state transitions.
