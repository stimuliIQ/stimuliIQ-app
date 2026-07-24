# ADR 0040: MailProvider (Resend) and WhatsAppProvider (WhatsApp Cloud API) interfaces — Noop-by-default, fail-closed in prod

## Status
Accepted

## Context
P6 is the first phase that actually **sends** email and WhatsApp messages — P4 wrote
grade/certificate domain events and P5 lead/booking/registration/payment events, but both
deferred real delivery (`CONFLICT-4`, `CONFLICT-P5-2/-5`). Before P6, only
`SmsProvider`/MSG91 existed as a messaging provider (ADR-0006); `SES_*`/`RESEND_API_KEY` env
vars were declared but unused, with no adapter behind them.

`CLAUDE.md §1` names Email (AWS SES / Resend) and WhatsApp (WhatsApp Cloud API / Gupshup) as
swappable-behind-interfaces integrations. The established pattern (payment — ADR-0013, video
— ADR-0023, storage — ADR-0027, captcha — ADR-0036) is: interface + DI `Symbol` token +
`NoopXProvider` + real adapter(s), bound via `useFactory` (never `useClass`, per ADR-0023 —
avoids the constructor-default-value DI crash), lazy env validation, fail-closed in
production when unconfigured.

## Decision
Two **new** provider interfaces are added, following that exact pattern:

**`MailProvider`** (`MAIL_PROVIDER` token)
- `send({ to, subject, html, text, tags }) → { providerMessageId }`
- `verifyWebhookSignature(payload, signatureHeader)` for delivery/bounce/complaint receipts
- Real adapter: **Resend** (`ResendMailProvider`, locked per the P6 spec LOCK-D2; SES remains
  a documented alternative adapter behind the same interface but is not built in P6)
- `NoopMailProvider`: deterministic success response, no network call, used in dev/test

**`WhatsAppProvider`** (`WHATSAPP_PROVIDER` token)
- `sendTemplate({ to, templateId, variables })` — India-compliant, template-gated (see
  ADR-0041 for the DLT gating rule)
- `sendSession({ to, body })` for in-window session replies
- `verifyWebhookSignature(...)` for delivery/read receipts
- Real adapter: **WhatsApp Cloud API** (`CloudApiWhatsAppProvider`, locked per LOCK-D2;
  Gupshup remains a documented alternative behind the same interface)
- `NoopWhatsAppProvider`: deterministic success response, no network call

**`SmsProvider`/MSG91 is reused unchanged** (ADR-0006) as the SMS channel of the notification
fan-out and campaign send; it is extended to carry a DLT template id per send (see
ADR-0041) rather than being rebuilt.

Both new tokens are bound via `useFactory` in `AppModule`, mirroring ADR-0023:

```ts
{
  provide: MAIL_PROVIDER,
  useFactory: (config: MailConfig) => {
    switch (config.provider) {
      case 'resend': return new ResendMailProvider(config.resend);
      default:       return new NoopMailProvider();
    }
  },
  inject: [MAIL_CONFIG],
}
```

**Fail-closed in production:** if `NODE_ENV=production` and `MAIL_PROVIDER=resend` but
`RESEND_API_KEY` is absent (or `WHATSAPP_PROVIDER=cloud_api` but
`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_APP_SECRET` are absent), the application **fails to boot**
with a descriptive zod config-validation error — no partial-boot state is reachable (AC-13).
In dev/test, an unset provider selector defaults to `noop` and the app boots cleanly.

No vendor SDK is called from a feature module — `NotificationService` and `CampaignService`
depend only on the `MailProvider`/`WhatsAppProvider`/`SmsProvider` interface types.

## Consequences
- P6 is fully testable (unit + integration) without any Resend/WhatsApp Cloud API
  credentials — `NoopMailProvider`/`NoopWhatsAppProvider` keep `turbo run build lint test`
  green.
- Swapping Resend for SES, or WhatsApp Cloud API for Gupshup, later requires only a new
  adapter class + a `useFactory` branch — no change to `NotificationService`,
  `CampaignService`, or any consuming module.
- Real sends (grade-ready emails, campaign WhatsApp messages, etc.) are **not live** until
  `MAIL_PROVIDER`/`WHATSAPP_PROVIDER` are set to a real adapter and credentials are supplied
  — tracked as a pending user action, not a P6 gap.
- No provider secret (`RESEND_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
  `MSG91_AUTH_KEY`, `MAIL_WEBHOOK_SECRET`) ever appears in an HTTP response, response header,
  or structured log — asserted by AC-76's response/log secret-scan test.

## Alternatives considered
- **Call the Resend/WhatsApp Cloud API SDK directly from `NotificationService`.** Rejected —
  violates `CLAUDE.md §1` rule 7 and removes the seam that keeps a future vendor swap a
  binding change.
- **Bind the tokens with `useClass`.** Rejected per ADR-0023's documented crash: any adapter
  constructor with a default-valued options parameter causes NestJS to attempt DI resolution
  of the TS-emitted `Object` metadata type and fail to boot. `useFactory` is the standing
  policy for every provider with optional constructor params.
- **Build both SES and Gupshup adapters immediately alongside Resend/Cloud API.** Deferred —
  the interface makes them structurally trivial to add later; building both now doubles
  integration-test surface for no P6 acceptance-criterion benefit. Recorded as the documented
  alternative adapter, not built.

## Related
Follows the pattern of ADR-0006 (SmsProvider), ADR-0013 (PaymentProvider), ADR-0023
(VideoProvider `useFactory`), ADR-0027 (StorageProvider), ADR-0036 (CaptchaProvider).
