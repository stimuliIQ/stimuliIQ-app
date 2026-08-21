// apps/api/src/modules/storage/providers/storage/storage-provider.module.ts
//
// Binds STORAGE_PROVIDER → the adapter selected by the STORAGE_PROVIDER env
// variable, and exports it for consumption by feature modules.
//
// Adapter selection logic:
//   STORAGE_PROVIDER=noop       → NoopStorageProvider   (DEFAULT — local dev + tests)
//   STORAGE_PROVIDER=s3         → S3StorageProvider     (AWS S3)
//   STORAGE_PROVIDER=r2         → S3StorageProvider     (Cloudflare R2 / S3-compatible;
//                                  the adapter is identical, only the endpoint differs)
//   (absent / unrecognised)     → NoopStorageProvider   (fail-safe default, warning logged)
//
// Mirrors the VideoProviderModule pattern exactly, including:
//   - useFactory binding (ADR-0023 / DEFECT-1): avoids the NestJS DI crash
//     caused by `useClass` on a class with a default-param constructor.
//   - Lazy credential validation: construction does NOT throw; any call throws.
//   - Boot warning logged when Noop is selected.
//
// ─── FEATURE MODULE WIRING ────────────────────────────────────────────────────
//
//   // certificates.module.ts (or submissions.module.ts, etc.)
//   import { StorageProviderModule }
//     from '../storage/providers/storage/storage-provider.module';
//
//   @Module({
//     imports: [StorageProviderModule, ...],
//     providers: [CertificatesService, ...],
//   })
//   export class CertificatesModule {}
//
// ─── SERVICE USAGE ────────────────────────────────────────────────────────────
//
//   // certificates.service.ts
//   import { Inject } from '@nestjs/common';
//   import { STORAGE_PROVIDER, StorageProvider }
//     from '../storage/providers/storage/storage-provider.interface';
//   import { S3StorageProvider }
//     from '../storage/providers/storage/s3-storage.provider';
//
//   @Injectable()
//   export class CertificatesService {
//     constructor(
//       @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
//     ) {}
//
//     async mintCertDownloadUrl(certStorageKey: string): Promise<string> {
//       const result = await this.storage.getSignedDownloadUrl({ key: certStorageKey });
//       return result.url;  // short-lived signed GET URL — only this goes to the client
//     }
//   }
//
// ─── TEST WIRING ──────────────────────────────────────────────────────────────
//
//   import { NoopStorageProvider }
//     from '../storage/providers/storage/noop-storage.provider';
//
//   const noop = new NoopStorageProvider();
//   const module = await Test.createTestingModule({
//     providers: [
//       CertificatesService,
//       { provide: STORAGE_PROVIDER, useValue: noop },
//       // ...other deps...
//     ],
//   }).compile();

import { Module, Logger } from "@nestjs/common";
import { validateEnv, isProductionEnv, missingEnvVars } from "../../../../config/env";
import { STORAGE_PROVIDER, type StorageProvider } from "./storage-provider.interface";
import { NoopStorageProvider } from "./noop-storage.provider";
import { S3StorageProvider } from "./s3-storage.provider";
import { LocalStorageProvider } from "./local-storage.provider";
import { resolveLocalStorageDir } from "./local-storage.lib";

const bootLogger = new Logger("StorageProviderModule");

/**
 * Constructs the StorageProvider implementation selected by the STORAGE_PROVIDER
 * env variable.
 *
 * NOTE: bound via `useFactory` (not `useClass`) to avoid the NestJS DI crash
 * (DEFECT-1): both NoopStorageProvider and S3StorageProvider have optional
 * constructor parameters, whose emitted design-type is `Object`.  A `useClass`
 * binding causes Nest to try injecting a provider of type `Object` from the
 * current module context (which does not exist), crashing AppModule boot.
 * The factory `new`s the class directly, bypassing DI reflection entirely.
 *
 * (See VideoProviderModule for the canonical DEFECT-1 explanation in this codebase.)
 */
function createStorageProvider(): StorageProvider {
  const env = validateEnv();
  const selector = env.STORAGE_PROVIDER ?? "noop";
  const isProd = isProductionEnv(env);

  /** Credentials S3StorageProvider needs. R2 additionally requires STORAGE_ENDPOINT. */
  const s3Credentials = (): string[] =>
    missingEnvVars({
      STORAGE_BUCKET: env.STORAGE_BUCKET,
      STORAGE_REGION: env.STORAGE_REGION,
      STORAGE_ACCESS_KEY_ID: env.STORAGE_ACCESS_KEY_ID,
      STORAGE_SECRET_ACCESS_KEY: env.STORAGE_SECRET_ACCESS_KEY,
      ...(selector === "r2" ? { STORAGE_ENDPOINT: env.STORAGE_ENDPOINT } : {}),
    });

  /** Production: abort boot. Elsewhere: warn loudly and bind Noop. */
  const bindOrFail = (label: string): StorageProvider => {
    const missing = s3Credentials();
    if (missing.length === 0) {
      bootLogger.log(`[StorageProviderModule] STORAGE_PROVIDER=${selector}, binding ${label}.`);
      return new S3StorageProvider();
    }
    if (isProd) {
      throw new Error(
        `[StorageProviderModule] STORAGE_PROVIDER=${selector} but the following required ` +
          `environment variables are not set: ${missing.join(", ")}. ` +
          `Uploads would be written nowhere. ` +
          `The application will NOT start without them in production.`,
      );
    }
    bootLogger.warn(
      `[StorageProviderModule] STORAGE_PROVIDER=${selector} but ${missing.join(", ")} ` +
        `is not set (non-production). Falling back to NoopStorageProvider, presigned URLs ` +
        `are FAKE. Set these before deploying to staging/prod.`,
    );
    return new NoopStorageProvider();
  };

  switch (selector) {
    case "local": {
      // DEV/LOCAL: store on disk + serve through the API — no cloud creds. Fail-closed in
      // production (real uploads would live on an ephemeral API disk, not durable storage).
      if (isProd) {
        throw new Error(
          "[StorageProviderModule] STORAGE_PROVIDER=local in a production environment. " +
            "Local disk storage is dev-only (non-durable, single-node). " +
            "Set STORAGE_PROVIDER=s3 or STORAGE_PROVIDER=r2 with real credentials for production.",
        );
      }
      const apiBaseUrl = (env.API_PUBLIC_URL ?? `http://localhost:${env.API_PORT}`).replace(/\/+$/, "");
      const baseDir = resolveLocalStorageDir(env.LOCAL_STORAGE_DIR);
      bootLogger.log(`[StorageProviderModule] STORAGE_PROVIDER=local, binding LocalStorageProvider (disk: ${baseDir}).`);
      return new LocalStorageProvider({ baseDir, apiBaseUrl, secret: env.COOKIE_SECRET });
    }

    case "s3":
      return bindOrFail("S3StorageProvider (AWS S3)");

    case "r2":
      return bindOrFail("S3StorageProvider (Cloudflare R2 / S3-compatible via STORAGE_ENDPOINT)");

    case "noop":
      if (isProd) {
        // Fail-closed: a Noop storage provider in production returns FAKE presigned
        // URLs. Assignment submissions, invoices and certificate PDFs report success
        // and the bytes are silently discarded — unrecoverable data loss.
        throw new Error(
          "[StorageProviderModule] STORAGE_PROVIDER=noop in a production environment. " +
            "This would return FAKE presigned URLs, student submissions, invoices and " +
            "certificates would be silently discarded. " +
            "Set STORAGE_PROVIDER=s3 or STORAGE_PROVIDER=r2 with real credentials for production. " +
            "The application will NOT start with STORAGE_PROVIDER=noop in production.",
        );
      }
      bootLogger.warn(
        "[StorageProviderModule] STORAGE_PROVIDER=noop, binding NoopStorageProvider. " +
          "Presigned URLs are FAKE.  Set STORAGE_PROVIDER=s3 or STORAGE_PROVIDER=r2 " +
          "with real credentials for production/staging.",
      );
      return new NoopStorageProvider();

    default:
      // A typo'd selector must not silently degrade to fake presigned URLs in production.
      if (isProd) {
        throw new Error(
          `[StorageProviderModule] Unrecognised STORAGE_PROVIDER='${selector}' in a production ` +
            `environment. Valid values: noop | s3 | r2. ` +
            `Refusing to fall back to NoopStorageProvider (which discards all uploads).`,
        );
      }
      bootLogger.warn(
        `[StorageProviderModule] Unrecognised STORAGE_PROVIDER='${selector}' - ` +
          "falling back to NoopStorageProvider (fail-safe). " +
          "Valid values: noop | s3 | r2.",
      );
      return new NoopStorageProvider();
  }
}

@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useFactory: createStorageProvider,
    },
  ],
  // Export only the token — consumers inject STORAGE_PROVIDER, never the concrete class.
  exports: [STORAGE_PROVIDER],
})
export class StorageProviderModule {}
