// apps/api/src/observability/otel.ts
//
// OpenTelemetry tracing bootstrap (CLAUDE.md §1, docs/04-trd-architecture.md §2.13).
// MUST be imported and started before any other module (Nest, Prisma, etc.) so
// auto-instrumentation can patch modules at require-time. No-ops cleanly when
// OTEL_EXPORTER_OTLP_ENDPOINT is absent (docs/plans/phase-0.md §Stubs).
//
// Phase 7 WS-C (docs/plans/phase-7.md task #9) hardening: `sdk.start()` is wrapped in
// try/catch so a misconfigured/unreachable hosted OTel collector at BOOT time (bad URL,
// DNS failure during the initial handshake, etc.) logs a warning and lets the app
// continue booting WITHOUT tracing, rather than crashing the process — a hosted
// collector being briefly unreachable must never take the whole API down. Export
// failures that occur later, in the background (once the SDK is running), are already
// handled by the OTLP exporter itself (logged via OpenTelemetry's diagnostic channel,
// not thrown) and never block a request.
//
// HTTP auto-instrumentation (`getNodeAutoInstrumentations()`) gives span coverage for
// outbound HTTP/fetch calls made by every provider adapter (Resend/WhatsApp
// Cloud/Razorpay/MSG91 all call out over HTTP) — child spans for provider calls
// (AC-46) come from this without any Prisma-specific instrumentation. Prisma-level DB
// spans would additionally need `@prisma/instrumentation` + `previewFeatures =
// ["tracing"]` in schema.prisma — a NEW dependency + a schema change, out of scope for
// this task's "no new deps without asking" constraint; tracked as a follow-up.
//
// T4 (docs/plans/phase-9-completion.md B11) hardening: a production deploy with no
// OTEL_EXPORTER_OTLP_ENDPOINT previously no-op'd SILENTLY. `startOtel()` now logs a loud
// WARN (never throws — a missing endpoint must not take the whole API down) whenever
// `isProductionEnv()` is true and the endpoint is absent, so this is visible in
// deploy/boot logs. Non-production environments keep the fully silent no-op.

import type { NodeSDK as NodeSDKType } from "@opentelemetry/sdk-node";
import { isProductionEnv } from "../config/env";

let sdk: NodeSDKType | undefined;

export async function startOtel(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!endpoint) {
    if (isProductionEnv()) {
      // Loud (not fatal): see the sentry.ts equivalent for the fail-safe rationale.
      // pino isn't bootstrapped yet at this point in boot, so use console directly.
      console.warn(
        "[api] OTEL_EXPORTER_OTLP_ENDPOINT is not set in a production environment, " +
          "distributed tracing is DISABLED. Set OTEL_EXPORTER_OTLP_ENDPOINT to enable " +
          "production tracing.",
      );
    }
    // No-op: tracing is deferred until an OTel collector endpoint is configured.
    return;
  }

  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { getNodeAutoInstrumentations } = await import(
      "@opentelemetry/auto-instrumentations-node"
    );

    sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? "stimuliiq-api",
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
      instrumentations: [getNodeAutoInstrumentations()],
    });

    await sdk.start();
  } catch (err) {
    // Fail-safe: an unreachable/misconfigured hosted collector must never crash boot.
    // pino isn't bootstrapped yet at this point in boot, so use console directly.
    console.warn(
      `[api] OpenTelemetry failed to start, continuing WITHOUT tracing: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    sdk = undefined;
  }
}

export async function shutdownOtel(): Promise<void> {
  try {
    await sdk?.shutdown();
  } catch {
    // Fail-safe: never let shutdown errors block process exit.
  }
}
