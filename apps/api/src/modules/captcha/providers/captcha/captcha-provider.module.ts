// apps/api/src/modules/captcha/providers/captcha/captcha-provider.module.ts
//
// Binds CAPTCHA_PROVIDER → the adapter selected by the CAPTCHA_PROVIDER env
// variable (with production fail-closed logic), and exports it for consumption
// by public write feature modules.
//
// Adapter selection logic:
//
//   CAPTCHA_PROVIDER=turnstile  (+ CAPTCHA_SECRET_KEY set)
//     → TurnstileCaptchaProvider  (Cloudflare Turnstile; real network verify)
//
//   CAPTCHA_PROVIDER=noop  (or unset)
//   AND NODE_ENV != production AND APP_ENV != production
//     → NoopCaptchaProvider  (always passes, no network — for dev + CI)
//
//   CAPTCHA_PROVIDER=noop  (or unset OR CAPTCHA_SECRET_KEY absent)
//   AND (NODE_ENV=production OR APP_ENV=production)
//     → FailClosedCaptchaProvider  (always returns { success: false })
//       Logs a loud boot-time error so operators know to fix the config.
//       This ensures production NEVER silently passes all captcha tokens
//       due to a missing key.
//
// DEFECT-1 / ADR-0023 compliance:
//   Bound via `useFactory` (not `useClass`) to bypass NestJS DI reflection on
//   classes with default-parameter constructors (would crash AppModule boot).
//   The factory `new`s the class directly. Mirrors VideoProviderModule +
//   StorageProviderModule patterns exactly.
//
// ─── FEATURE MODULE WIRING ────────────────────────────────────────────────────
//
//   // public-leads.module.ts (or whichever public write module)
//   import { CaptchaProviderModule }
//     from '../../captcha/providers/captcha/captcha-provider.module';
//
//   @Module({
//     imports: [CaptchaProviderModule, ...],
//     providers: [PublicLeadsService, ...],
//   })
//   export class PublicLeadsModule {}
//
// ─── SERVICE USAGE ────────────────────────────────────────────────────────────
//
//   // public-leads.service.ts
//   import { Inject } from '@nestjs/common';
//   import { CAPTCHA_PROVIDER, CaptchaProvider }
//     from '../../captcha/providers/captcha/captcha-provider.interface';
//
//   @Injectable()
//   export class PublicLeadsService {
//     constructor(
//       @Inject(CAPTCHA_PROVIDER) private readonly captcha: CaptchaProvider,
//     ) {}
//   }
//
// ─── TEST WIRING ──────────────────────────────────────────────────────────────
//
//   import { NoopCaptchaProvider }
//     from '../../captcha/providers/captcha/noop-captcha.provider';
//
//   const noop = new NoopCaptchaProvider();
//   const module = await Test.createTestingModule({
//     providers: [
//       PublicLeadsService,
//       { provide: CAPTCHA_PROVIDER, useValue: noop },
//     ],
//   }).compile();

import { Module, Logger } from "@nestjs/common";
import { validateEnv, isProductionEnv } from "../../../../config/env";
import { CAPTCHA_PROVIDER, type CaptchaProvider } from "./captcha-provider.interface";
import { NoopCaptchaProvider } from "./noop-captcha.provider";
import { TurnstileCaptchaProvider } from "./turnstile-captcha.provider";
import { FailClosedCaptchaProvider } from "./fail-closed-captcha.provider";
import { ReplayTolerantCaptchaProvider } from "./replay-tolerant-captcha.provider";
import { RedisService } from "../../../../redis/redis.service";

const bootLogger = new Logger("CaptchaProviderModule");

/**
 * Determines whether the current runtime is a production environment.
 * Uses both NODE_ENV and APP_ENV to catch deployments that set APP_ENV=production
 * but leave NODE_ENV=development (a common misconfiguration pattern).
 */
/**
 * Constructs the CaptchaProvider implementation selected by the CAPTCHA_PROVIDER
 * env variable, with fail-closed production safety.
 *
 * NOTE: bound via `useFactory` (not `useClass`) to avoid the NestJS DI crash
 * (DEFECT-1): NoopCaptchaProvider / FailClosedCaptchaProvider / Turnstile all
 * have no-arg constructors, but to stay consistent with the established
 * VideoProviderModule / StorageProviderModule pattern and to be safe if options
 * are added later, we always use useFactory. Mirrors the established pattern.
 */
function createCaptchaProvider(): CaptchaProvider {
  const env = validateEnv();
  const selector = env.CAPTCHA_PROVIDER ?? "noop";
  const isProd = isProductionEnv(env);
  const hasSecret = Boolean(env.CAPTCHA_SECRET_KEY);

  switch (selector) {
    case "turnstile": {
      if (!hasSecret) {
        // Turnstile explicitly selected but secret is missing.
        // In production: bind FailClosed (hard reject). In non-prod: warn + Noop.
        if (isProd) {
          bootLogger.error(
            "[CaptchaProviderModule] CAPTCHA_PROVIDER=turnstile but CAPTCHA_SECRET_KEY " +
              "is not set in production. Binding FailClosedCaptchaProvider, " +
              "all captcha-gated writes will be rejected until the key is supplied.",
          );
          return new FailClosedCaptchaProvider();
        } else {
          bootLogger.warn(
            "[CaptchaProviderModule] CAPTCHA_PROVIDER=turnstile but CAPTCHA_SECRET_KEY " +
              "is not set (non-production). Binding NoopCaptchaProvider for dev convenience. " +
              "Set CAPTCHA_SECRET_KEY before deploying to staging/prod.",
          );
          return new NoopCaptchaProvider();
        }
      }
      bootLogger.log(
        "[CaptchaProviderModule] CAPTCHA_PROVIDER=turnstile, binding TurnstileCaptchaProvider " +
          "(Cloudflare Turnstile server-side verify).",
      );
      return new TurnstileCaptchaProvider();
    }

    case "noop": {
      if (isProd) {
        // Noop explicitly requested in production — fail closed instead.
        // This protects against accidental production deployments with Noop.
        bootLogger.error(
          "[CaptchaProviderModule] CAPTCHA_PROVIDER=noop in production environment. " +
            "Binding FailClosedCaptchaProvider to prevent silent captcha bypass. " +
            "Set CAPTCHA_PROVIDER=turnstile and CAPTCHA_SECRET_KEY for production.",
        );
        return new FailClosedCaptchaProvider();
      }
      bootLogger.warn(
        "[CaptchaProviderModule] CAPTCHA_PROVIDER=noop, binding NoopCaptchaProvider. " +
          "ALL captcha tokens are accepted unconditionally. " +
          "Set CAPTCHA_PROVIDER=turnstile with CAPTCHA_SECRET_KEY for staging/prod.",
      );
      return new NoopCaptchaProvider();
    }

    default: {
      // Unrecognised value.
      if (isProd) {
        bootLogger.error(
          `[CaptchaProviderModule] Unrecognised CAPTCHA_PROVIDER='${selector}' in production. ` +
            "Binding FailClosedCaptchaProvider (fail-closed). " +
            "Valid values: noop | turnstile.",
        );
        return new FailClosedCaptchaProvider();
      }
      bootLogger.warn(
        `[CaptchaProviderModule] Unrecognised CAPTCHA_PROVIDER='${selector}' - ` +
          "falling back to NoopCaptchaProvider (non-production). " +
          "Valid values: noop | turnstile.",
      );
      return new NoopCaptchaProvider();
    }
  }
}

@Module({
  providers: [
    {
      provide: CAPTCHA_PROVIDER,
      // The selected adapter is WRAPPED in ReplayTolerantCaptchaProvider (see that
      // file's header). A Turnstile token is single-use, but /onboarding and
      // /careers each spend one token on TWO captcha-gated calls — mint a signed
      // upload URL, then submit — so the second call always died with
      // `timeout-or-duplicate` and the form told the visitor to solve a captcha
      // they had already solved. Wrapping here rather than in each service means
      // every consumer of CAPTCHA_PROVIDER gets the fix and the vendor adapters
      // stay pure vendor calls.
      //
      // RedisService is injected (RedisModule is @Global) rather than resolved
      // inside the factory, so the memo participates in normal DI/test wiring.
      useFactory: (redis: RedisService): CaptchaProvider =>
        new ReplayTolerantCaptchaProvider(createCaptchaProvider(), redis),
      inject: [RedisService],
    },
  ],
  // Export only the token — consumers inject CAPTCHA_PROVIDER, never the concrete class.
  exports: [CAPTCHA_PROVIDER],
})
export class CaptchaProviderModule {}
