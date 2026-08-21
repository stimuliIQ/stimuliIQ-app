// apps/api/src/modules/lms/providers/live-class/live-class-provider.module.ts
//
// Binds LIVE_CLASS_PROVIDER → the adapter selected by the LIVE_CLASS_PROVIDER env
// variable, and exports it for consumption by the Wave-3 LiveClass module.
//
// Adapter selection logic (mirrors VideoProviderModule / StorageProviderModule exactly):
//   LIVE_CLASS_PROVIDER=noop         → NoopLiveClassProvider   (DEFAULT — dev + tests)
//   LIVE_CLASS_PROVIDER=zoom         → ZoomLiveClassProvider
//   LIVE_CLASS_PROVIDER=google_meet  → GoogleMeetLiveClassProvider
//   (absent / unrecognised)          → NoopLiveClassProvider   (fail-safe default, warning logged)
//
// FAIL CLOSED IN PRODUCTION (docs/plans/phase-9-completion.md T15 / T2 / B2):
//   In production (NODE_ENV=production or APP_ENV=production):
//     - LIVE_CLASS_PROVIDER=noop → boot-time throw (never serve fake meetings to students).
//     - LIVE_CLASS_PROVIDER=zoom|google_meet with missing credentials → boot-time throw.
//   Outside production: falls back to NoopLiveClassProvider with a loud warning.
//
// ─── FEATURE MODULE WIRING (Wave-3 LiveClass module) ──────────────────────────
//
//   // apps/api/src/modules/lms/live-class/live-class.module.ts
//   import { LiveClassProviderModule } from '../providers/live-class/live-class-provider.module';
//
//   @Module({
//     imports: [LiveClassProviderModule, ...],
//     providers: [LiveClassService, ...],
//   })
//   export class LiveClassModule {}
//
// ─── SERVICE USAGE ────────────────────────────────────────────────────────────
//
//   import { Inject } from '@nestjs/common';
//   import { LIVE_CLASS_PROVIDER, LiveClassProvider }
//     from '../providers/live-class/live-class-provider.interface';
//
//   @Injectable()
//   export class LiveClassService {
//     constructor(
//       @Inject(LIVE_CLASS_PROVIDER) private readonly liveClass: LiveClassProvider,
//     ) {}
//   }
//
// ─── TEST WIRING ─────────────────────────────────────────────────────────────
//
//   import { NoopLiveClassProvider } from '../providers/live-class/noop-live-class.provider';
//
//   const noop = new NoopLiveClassProvider();
//   await Test.createTestingModule({
//     providers: [
//       LiveClassService,
//       { provide: LIVE_CLASS_PROVIDER, useValue: noop },
//     ],
//   }).compile();

import { Module, Logger } from "@nestjs/common";
import { validateEnv, isProductionEnv, missingEnvVars } from "../../../../config/env";
import { LIVE_CLASS_PROVIDER, type LiveClassProvider } from "./live-class-provider.interface";
import { NoopLiveClassProvider } from "./noop-live-class.provider";
import { ZoomLiveClassProvider } from "./zoom-live-class.provider";
import { GoogleMeetLiveClassProvider } from "./google-meet-live-class.provider";

const bootLogger = new Logger("LiveClassProviderModule");

/**
 * Constructs the LiveClassProvider implementation selected by the
 * LIVE_CLASS_PROVIDER env variable.
 *
 * NOTE: bound via `useFactory` (not `useClass`), same DEFECT-1/ADR-0023 rationale
 * as MailProviderModule/VideoProviderModule/StorageProviderModule/PaymentProviderModule:
 * NoopLiveClassProvider has an optional-param constructor whose emitted design-type
 * is `Object`, which crashes NestJS's `useClass` DI reflection. The factory `new`s the
 * class directly, bypassing DI reflection entirely.
 */
function createLiveClassProvider(): LiveClassProvider {
  const env = validateEnv();
  const selector = env.LIVE_CLASS_PROVIDER ?? "noop";
  const isProd = isProductionEnv(env);

  /** Shared fail-closed handling for a real adapter with incomplete credentials. */
  const bindOrFail = (
    adapterName: string,
    missing: string[],
    construct: () => LiveClassProvider,
  ): LiveClassProvider => {
    if (missing.length === 0) {
      bootLogger.log(`[LiveClassProviderModule] LIVE_CLASS_PROVIDER=${selector}, binding ${adapterName}.`);
      return construct();
    }
    if (isProd) {
      throw new Error(
        `[LiveClassProviderModule] LIVE_CLASS_PROVIDER=${selector} but the following required ` +
          `environment variables are not set: ${missing.join(", ")}. ` +
          `Live class scheduling/join would fail for every student. ` +
          `The application will NOT start without them in production.`,
      );
    }
    bootLogger.warn(
      `[LiveClassProviderModule] LIVE_CLASS_PROVIDER=${selector} but ${missing.join(", ")} ` +
        `is not set (non-production). Falling back to NoopLiveClassProvider, meetings are FAKE. ` +
        `Set these before deploying to staging/prod.`,
    );
    return new NoopLiveClassProvider();
  };

  switch (selector) {
    case "zoom":
      return bindOrFail(
        "ZoomLiveClassProvider",
        missingEnvVars({
          ZOOM_ACCOUNT_ID: env.ZOOM_ACCOUNT_ID,
          ZOOM_CLIENT_ID: env.ZOOM_CLIENT_ID,
          ZOOM_CLIENT_SECRET: env.ZOOM_CLIENT_SECRET,
          ZOOM_WEBHOOK_SECRET_TOKEN: env.ZOOM_WEBHOOK_SECRET_TOKEN,
        }),
        () => new ZoomLiveClassProvider(),
      );

    case "google_meet":
      return bindOrFail(
        "GoogleMeetLiveClassProvider",
        missingEnvVars({
          GOOGLE_SERVICE_ACCOUNT_EMAIL: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
          GOOGLE_MEET_IMPERSONATE_USER_EMAIL: env.GOOGLE_MEET_IMPERSONATE_USER_EMAIL,
        }),
        () => new GoogleMeetLiveClassProvider(),
      );

    case "disabled":
      // Live Classes feature is turned OFF (removed from the LMS + CRM UIs). Bind Noop
      // with NO production boot-throw — no Zoom/Meet credentials are required. The
      // live-class API endpoints remain registered but dormant (no UI ever calls them).
      bootLogger.log(
        "[LiveClassProviderModule] LIVE_CLASS_PROVIDER=disabled. Live Classes feature is off. " +
          "Binding NoopLiveClassProvider (endpoints dormant, not surfaced in any app).",
      );
      return new NoopLiveClassProvider();

    case "noop":
      if (isProd) {
        throw new Error(
          "[LiveClassProviderModule] LIVE_CLASS_PROVIDER=noop in a production environment. " +
            "This would create FAKE meetings. Students would receive links to nowhere. " +
            "Set LIVE_CLASS_PROVIDER=zoom or LIVE_CLASS_PROVIDER=google_meet with real " +
            "credentials for production. The application will NOT start with " +
            "LIVE_CLASS_PROVIDER=noop in production.",
        );
      }
      bootLogger.warn(
        "[LiveClassProviderModule] LIVE_CLASS_PROVIDER=noop, binding NoopLiveClassProvider. " +
          "Meetings/join URLs are FAKE. Set LIVE_CLASS_PROVIDER=zoom or " +
          "LIVE_CLASS_PROVIDER=google_meet with real credentials for production/staging.",
      );
      return new NoopLiveClassProvider();

    default:
      if (isProd) {
        throw new Error(
          `[LiveClassProviderModule] Unrecognised LIVE_CLASS_PROVIDER='${selector}' in production. ` +
            "Valid values: noop | zoom | google_meet. The application will NOT start.",
        );
      }
      bootLogger.warn(
        `[LiveClassProviderModule] Unrecognised LIVE_CLASS_PROVIDER='${selector}' - ` +
          "falling back to NoopLiveClassProvider (non-production). " +
          "Valid values: noop | zoom | google_meet.",
      );
      return new NoopLiveClassProvider();
  }
}

@Module({
  providers: [
    {
      provide: LIVE_CLASS_PROVIDER,
      useFactory: createLiveClassProvider,
    },
  ],
  // Export only the token — consumers inject LIVE_CLASS_PROVIDER, never the concrete class.
  exports: [LIVE_CLASS_PROVIDER],
})
export class LiveClassProviderModule {}
