# ADR 0023: VideoProvider DI via `useFactory` (not `useClass`)

## Status
Accepted

## Context
The `VIDEO_PROVIDER` DI token follows the same provider-interface pattern as
`PAYMENT_PROVIDER` (ADR-0013) and `SMS_PROVIDER` (ADR-0006). The three concrete
adapters are:

- `CloudflareStreamVideoProvider` — production default when `VIDEO_PROVIDER=cloudflare_stream`.
- `MuxVideoProvider` — alternate when `VIDEO_PROVIDER=mux`.
- `NoopVideoProvider` — default for local dev and CI; requires no credentials.

An initial implementation bound the token with `useClass`:

```ts
{ provide: VIDEO_PROVIDER, useClass: NoopVideoProvider }
```

This caused a **runtime crash** during integration testing in Wave 6: Nest's DI
container inspected `NoopVideoProvider`'s constructor, found a parameter with a
default value of `{}` (`constructor(private readonly options: VideoProviderOptions = {})`),
and attempted to inject the TypeScript-emitted metadata type `Object`. Because `Object`
is not a registered provider, NestJS threw a dependency-resolution error and `AppModule`
failed to boot.

The identical problem affects `CloudflareStreamVideoProvider` and `MuxVideoProvider`
if those adapters accept optional options objects.

This crash was not caught until Wave 6 integration testing because the LMS module had
not been booted inside a full `AppModule` context in any earlier test pass — only
isolated module tests had been run.

## Decision
Bind `VIDEO_PROVIDER` (and, by policy, any future provider with constructor params
that have default values) using `useFactory` instead of `useClass`:

```ts
{
  provide: VIDEO_PROVIDER,
  useFactory: (config: VideoConfig) => {
    switch (config.provider) {
      case 'cloudflare': return new CloudflareStreamVideoProvider(config.cloudflare);
      case 'mux':        return new MuxVideoProvider(config.mux);
      default:           return new NoopVideoProvider();
    }
  },
  inject: [VIDEO_CONFIG],
}
```

`useFactory` bypasses NestJS's constructor-parameter metadata inspection entirely —
the factory function is called directly, so default-value parameters are never
exposed to the DI container as injection targets.

The `NoopVideoProvider` is the **fail-safe default**: `VIDEO_PROVIDER` env var absent
or unrecognised → Noop is selected → no credentials required → API boots cleanly →
video endpoints return a fake `.m3u8` URL.

## Consequences
- The `AppModule` boots without any signing keys or `VIDEO_PROVIDER` being set (the
  selector defaults to `noop`); the video stream-url endpoint returns a deterministic
  fake URL in development.
- The `useFactory` pattern is now the documented approach for any provider adapter
  whose constructor has parameters with default values (the `options = {}` shape).
- Existing `PAYMENT_PROVIDER` and `SMS_PROVIDER` bindings should be audited to confirm
  they do not use `useClass` with default-value constructor params. They currently use
  `useClass` cleanly because the Razorpay and MSG91 adapters take injected config
  services, not default-value object params.
- **Process note:** this defect was found in Wave 6 integration testing (the first time
  the LMS module was booted inside a full NestJS `AppModule`). Unit tests and isolated
  module tests did not catch it. This is a reminder that integration smoke tests of the
  full `AppModule` should run before feature modules are considered stable, not only at
  phase closeout.

## Alternatives considered
- **Remove the default value from `NoopVideoProvider`'s constructor**: makes it
  `useClass`-safe but forces callers to always pass an options object even when options
  are empty. Rejected — the `options = {}` default is idiomatic and removing it is a
  leaky fix that doesn't address the root cause for future adapters.
- **Register `VideoProviderOptions` as a provider**: injects `{}` as the options
  object. Works, but pollutes the DI container with a generic `Object`-shaped
  registration. Rejected — `useFactory` is cleaner and is the standard NestJS
  recommendation for conditional/factory-constructed providers.
- **Use `useValue` with a pre-constructed instance**: eliminates the DI resolution
  entirely but loses the ability to inject NestJS-managed config services into the
  adapter. Rejected for the real adapters (Cloudflare, Mux) which need the config
  service; acceptable as a fallback for the Noop adapter in extreme cases.
