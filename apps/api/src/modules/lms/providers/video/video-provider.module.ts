// apps/api/src/modules/lms/providers/video/video-provider.module.ts
//
// Binds VIDEO_PROVIDER → the adapter selected by the VIDEO_PROVIDER env variable,
// and exports it for consumption by the LmsModule (Wave 4).
//
// Adapter selection logic:
//   VIDEO_PROVIDER=noop              → NoopVideoProvider   (DEFAULT — safe for local dev + tests)
//   VIDEO_PROVIDER=cloudflare_stream → CloudflareStreamVideoProvider
//   VIDEO_PROVIDER=mux               → MuxVideoProvider
//   VIDEO_PROVIDER=disabled          → NoopVideoProvider   (feature OFF — no prod boot-throw)
//   (absent / unrecognised)          → NoopVideoProvider   (fail-safe default, warning logged)
//
// This mirrors the PaymentProviderModule pattern from P2
// (apps/api/src/modules/commerce/providers/payment/payment-provider.module.ts).
//
// ─── WAVE-4 LMS MODULE WIRING ─────────────────────────────────────────────────
//
//   // apps/api/src/modules/lms/lms.module.ts
//   import { VideoProviderModule } from './providers/video/video-provider.module';
//
//   @Module({
//     imports: [VideoProviderModule, PrismaModule, AuditModule, ...],
//     providers: [LmsService, LmsRepository, ...],
//     controllers: [LmsController, VideoWebhookController],
//   })
//   export class LmsModule {}
//
//   // apps/api/src/modules/lms/lms.service.ts
//   import { Inject } from '@nestjs/common';
//   import { VIDEO_PROVIDER, VideoProvider }
//     from './providers/video/video-provider.interface';
//
//   @Injectable()
//   export class LmsService {
//     constructor(
//       @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
//       ...
//     ) {}
//   }
//
// ─── TEST WIRING (unit tests — bind the Noop provider directly) ───────────────
//
//   import { NoopVideoProvider } from './providers/video/noop-video.provider';
//
//   const noopVideo = new NoopVideoProvider();
//   const module = await Test.createTestingModule({
//     providers: [
//       LmsService,
//       { provide: VIDEO_PROVIDER, useValue: noopVideo },
//       // ...other deps...
//     ],
//   }).compile();
//
// ─── WEBHOOK CONTROLLER REQUIREMENTS (for Wave-4 backend-builder) ─────────────
//
// The transcode webhook controller MUST:
//   1. Use @Public() — the HMAC signature is the auth mechanism.
//   2. Read req.rawBody (requires rawBody: true in NestFactory.create — already
//      required for the Razorpay webhook; ensure main.ts has it).
//   3. Pass the full signatureHeader verbatim (Cloudflare: 'Webhook-Signature' header;
//      Mux: 'Mux-Signature' header; Noop: any hex string).
//   4. Be excluded from the CSRF middleware (webhook route ≠ browser request).
//   5. Treat verifyWebhookSignature() === false as an immediate 401 — no further processing.
//   6. Call parseTranscodeEvent() on the parsed body and update videos.status via the
//      VideoWebhookProcessorPort (ADR-0020 inline-port, consistent with P2 pattern).
//
// See the full NestJS wiring example in VerifyWebhookSignatureInput JSDoc in
// video-provider.interface.ts.

import { Module, Logger } from "@nestjs/common";
import { validateEnv, isProductionEnv, missingEnvVars } from "../../../../config/env";
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from "../../../storage/providers/storage/storage-provider.interface";
import { StorageProviderModule } from "../../../storage/providers/storage/storage-provider.module";
import { VIDEO_PROVIDER, type VideoProvider } from "./video-provider.interface";
import { NoopVideoProvider } from "./noop-video.provider";
import { CloudflareStreamVideoProvider } from "./cloudflare-stream-video.provider";
import { MuxVideoProvider } from "./mux-video.provider";

// The providers array is built dynamically based on the selected adapter, so
// we need the module-level logger before NestJS bootstraps its own DI logger.
const bootLogger = new Logger("VideoProviderModule");

/**
 * Constructs the VideoProvider implementation selected by the VIDEO_PROVIDER env
 * variable.
 *
 * NOTE: we bind via `useFactory` (not `useClass`) on purpose. `NoopVideoProvider`
 * has a constructor parameter (`options: NoopVideoProviderOptions = {}`), whose
 * emitted design-type is `Object`. A `useClass` binding makes Nest attempt to
 * inject a provider of type `Object` from this module's context, which does not
 * exist — crashing AppModule boot (and, transitively, EVERY integration test that
 * boots AppModule). A factory sidesteps DI reflection entirely by `new`-ing the
 * class ourselves. Mirrors PaymentProviderModule's intent (single token binding,
 * no orphan bare-class registration).
 */
function createVideoProvider(storage: StorageProvider): VideoProvider {
  const env = validateEnv();
  const selector = env.VIDEO_PROVIDER ?? "noop";
  const isProd = isProductionEnv(env);

  /**
   * Shared fail-closed handling for a real adapter whose credentials are incomplete.
   * Production: abort boot. Elsewhere: warn loudly and bind Noop.
   */
  const bindOrFail = (
    adapterName: string,
    missing: string[],
    construct: () => VideoProvider,
  ): VideoProvider => {
    if (missing.length === 0) {
      bootLogger.log(`[VideoProviderModule] VIDEO_PROVIDER=${selector} — binding ${adapterName}.`);
      return construct();
    }
    if (isProd) {
      throw new Error(
        `[VideoProviderModule] VIDEO_PROVIDER=${selector} but the following required ` +
          `environment variables are not set: ${missing.join(", ")}. ` +
          `Signed HLS URLs would be unsignable. ` +
          `The application will NOT start without them in production.`,
      );
    }
    bootLogger.warn(
      `[VideoProviderModule] VIDEO_PROVIDER=${selector} but ${missing.join(", ")} ` +
        `is not set (non-production). Falling back to NoopVideoProvider — signed HLS URLs ` +
        `are FAKE. Set these before deploying to staging/prod.`,
    );
    return new NoopVideoProvider({ storage });
  };

  switch (selector) {
    case "cloudflare_stream":
      return bindOrFail(
        "CloudflareStreamVideoProvider",
        missingEnvVars({
          CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
          CLOUDFLARE_STREAM_SIGNING_KEY_ID: env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
          CLOUDFLARE_STREAM_SIGNING_KEY_PEM: env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM,
        }),
        () => new CloudflareStreamVideoProvider(),
      );

    case "mux":
      return bindOrFail(
        "MuxVideoProvider",
        missingEnvVars({
          MUX_TOKEN_ID: env.MUX_TOKEN_ID,
          MUX_TOKEN_SECRET: env.MUX_TOKEN_SECRET,
          MUX_SIGNING_KEY_ID: env.MUX_SIGNING_KEY_ID,
          MUX_SIGNING_KEY_PRIVATE: env.MUX_SIGNING_KEY_PRIVATE,
        }),
        () => new MuxVideoProvider(),
      );

    case "disabled":
      // Recorded-video feature is turned OFF (mirrors LIVE_CLASS_PROVIDER=disabled). Bind
      // Noop with NO production boot-throw — no Mux/Cloudflare Stream credentials required.
      // Signed-HLS endpoints stay registered but dormant; use ONLY when no recorded video
      // is served yet. Flip to cloudflare_stream|mux (with keys) to enable it.
      bootLogger.log(
        "[VideoProviderModule] VIDEO_PROVIDER=disabled — recorded-video feature is off. " +
          "Binding NoopVideoProvider (signed-HLS endpoints dormant; no video vendor needed).",
      );
      return new NoopVideoProvider({ storage });

    case "noop":
      if (isProd) {
        // Fail-closed: a Noop video provider in production mints FAKE signed HLS
        // URLs. Students pay for video they cannot watch, and nothing errors.
        throw new Error(
          "[VideoProviderModule] VIDEO_PROVIDER=noop in a production environment. " +
            "This would serve FAKE signed HLS URLs to paying students. " +
            "Set VIDEO_PROVIDER=cloudflare_stream or VIDEO_PROVIDER=mux with real " +
            "credentials for production. " +
            "The application will NOT start with VIDEO_PROVIDER=noop in production.",
        );
      }
      bootLogger.warn(
        "[VideoProviderModule] VIDEO_PROVIDER=noop — binding NoopVideoProvider. " +
          "Signed HLS URLs are FAKE. Set VIDEO_PROVIDER=cloudflare_stream or " +
          "VIDEO_PROVIDER=mux with real credentials for production/staging.",
      );
      return new NoopVideoProvider({ storage });

    default:
      // An unrecognised selector is a typo (e.g. VIDEO_PROVIDER=cloudflare). Silently
      // degrading to Noop in production is exactly the failure this guard exists to stop.
      if (isProd) {
        throw new Error(
          `[VideoProviderModule] Unrecognised VIDEO_PROVIDER='${selector}' in a production ` +
            `environment. Valid values: noop | cloudflare_stream | mux. ` +
            `Refusing to fall back to NoopVideoProvider (which serves FAKE signed HLS URLs).`,
        );
      }
      bootLogger.warn(
        `[VideoProviderModule] Unrecognised VIDEO_PROVIDER='${selector}' — ` +
          "falling back to NoopVideoProvider (fail-safe). " +
          "Valid values: noop | cloudflare_stream | mux.",
      );
      return new NoopVideoProvider({ storage });
  }
}

@Module({
  // NoopVideoProvider needs the storage seam to hand back an upload URL a browser can
  // actually reach (dev: STORAGE_PROVIDER=local). Storage does not depend on LMS, so
  // this import introduces no cycle.
  imports: [StorageProviderModule],
  providers: [
    {
      provide: VIDEO_PROVIDER,
      useFactory: createVideoProvider,
      inject: [STORAGE_PROVIDER],
    },
  ],
  // Export only the token — consumers inject VIDEO_PROVIDER, never the concrete class.
  exports: [VIDEO_PROVIDER],
})
export class VideoProviderModule {}
