// apps/api/src/modules/lms/providers/video/noop-video.provider.ts
//
// Test / sandbox double for VideoProvider. Used in unit tests, integration tests,
// and local dev environments where no real Cloudflare Stream or Mux credentials
// are present or desired. Selected automatically when VIDEO_PROVIDER=noop (the
// default) or when no VIDEO_PROVIDER env var is set.
//
// This class is NEVER bound in production — VideoProviderModule binds the real
// adapter when VIDEO_PROVIDER=cloudflare_stream or VIDEO_PROVIDER=mux.
//
// ─── BEHAVIOUR ───────────────────────────────────────────────────────────────
//
//   mintSignedHlsUrl:
//     Returns a DETERMINISTIC fake signed URL:
//       https://noop.video.local/hls/<assetId>/manifest.m3u8?token=noop-signed-<userId>-<lessonId>-<expS>
//     The URL encodes userId, lessonId, and expiry so tests can assert on its shape
//     WITHOUT hitting any real provider. expiresAt = now + ttlSeconds.
//
//   verifyWebhookSignature:
//     Uses HMAC-SHA256 over rawBody with a configurable test webhook secret, so test
//     suites can derive valid/invalid fixtures deterministically. When
//     simulateWebhookSecretAbsent=true (or webhookSecret=undefined), FAIL CLOSED
//     (returns false) exactly as the real adapters do when unconfigured.
//
//   parseTranscodeEvent:
//     Accepts a "noop" fixture payload { uid, readyToStream } (Cloudflare-like) so
//     integration tests can exercise the transcode-event path without a live provider.
//
//   createUploadTarget:
//     Returns a deterministic fake upload URL + asset id for tests.
//
// ─── SECURITY NOTE ───────────────────────────────────────────────────────────
//
//   The fake URL returned by mintSignedHlsUrl is structured like a signed URL but
//   is NOT cryptographically signed (there is no private key). It must NEVER be
//   used in production. A warning is logged at construction time.
//
//   The `token=noop-signed-...` segment looks signed but is just a deterministic
//   string — no key material, no verifiable signature. This is correct and
//   intentional: the purpose is to make the URL shape testable (has a query
//   param, encodes user/lesson context) without real crypto.

import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { timingSafeEqualHex } from "./cloudflare-stream-video.provider";
import type { StorageProvider } from "../../../storage/providers/storage/storage-provider.interface";
import type {
  VideoProvider,
  MintSignedHlsUrlInput,
  MintSignedHlsUrlResult,
  VerifyWebhookSignatureInput,
  TranscodeEvent,
  CreateUploadTargetInput,
  CreateUploadTargetResult,
} from "./video-provider.interface";
import { DEFAULT_HLS_TTL_SECONDS } from "./video-provider.interface";

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

export interface NoopVideoProviderOptions {
  /**
   * Secret used for HMAC-SHA256 in verifyWebhookSignature.
   * Defaults to DEFAULT_NOOP_WEBHOOK_SECRET.
   * Override per test suite for isolation.
   */
  webhookSecret?: string;

  /**
   * When true, simulates the webhook secret being absent (not configured).
   * verifyWebhookSignature will return false (fail closed) regardless of input.
   * Default: false.
   */
  simulateWebhookSecretAbsent?: boolean;

  /**
   * Storage seam used by createUploadTarget to mint an upload URL a browser can
   * actually PUT to (VideoProviderModule passes the bound STORAGE_PROVIDER).
   *
   * Omit it — as unit tests do — and createUploadTarget falls back to the
   * deterministic `https://noop.video.local/upload/...` fake.
   */
  storage?: StorageProvider;
}

export const DEFAULT_NOOP_WEBHOOK_SECRET = "noop-test-webhook-secret";
const PROVIDER_NAME = "noop" as const;

/** Key namespace for source videos uploaded through the noop provider's storage fallback. */
const NOOP_UPLOAD_KEY_PREFIX = "video/source";

/** Ceiling used when the caller does not specify one (matches video-library's default). */
const NOOP_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

@Injectable()
export class NoopVideoProvider implements VideoProvider {
  private readonly logger = new Logger(NoopVideoProvider.name);
  private readonly webhookSecret: string | undefined;
  private readonly simulateWebhookSecretAbsent: boolean;
  private readonly storage: StorageProvider | undefined;

  constructor(options: NoopVideoProviderOptions = {}) {
    this.simulateWebhookSecretAbsent = options.simulateWebhookSecretAbsent ?? false;
    this.storage = options.storage;
    this.webhookSecret = this.simulateWebhookSecretAbsent
      ? undefined
      : (options.webhookSecret ?? DEFAULT_NOOP_WEBHOOK_SECRET);

    this.logger.warn(
      "[NoopVideoProvider] Running with the no-op/test video provider. " +
        "Returned HLS URLs are FAKE and NOT cryptographically signed. " +
        "Do NOT use this in production. Set VIDEO_PROVIDER=cloudflare_stream or " +
        "VIDEO_PROVIDER=mux with real credentials for production/staging.",
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // mintSignedHlsUrl — DETERMINISTIC fake URL (no real crypto, no real keys)
  // ───────────────────────────────────────────────────────────────────────────

  async mintSignedHlsUrl(input: MintSignedHlsUrlInput): Promise<MintSignedHlsUrlResult> {
    const { assetId, userId, lessonId, ttlSeconds = DEFAULT_HLS_TTL_SECONDS } = input;

    const nowS = Math.floor(Date.now() / 1000);
    const expS = nowS + ttlSeconds;

    // STORAGE-BACKED PLAYBACK (dev): createUploadTarget wrote the source file to
    // `video/source/<assetId>` via the storage seam, so mint a SHORT-TTL SIGNED GET
    // URL for that exact object. The file plays as a progressive MP4 — there is no
    // transcode step in dev, so this is a source-quality stream, not adaptive HLS.
    //
    // The security contract is unchanged and fully honoured: the URL is signed,
    // expires in ttlSeconds, and the raw storage key never reaches the client. The
    // enrollment/preview gate still runs in LmsService BEFORE this is ever called.
    //
    // Without this branch the returned URL pointed at `noop.video.local`, a host that
    // does not resolve — every player showed ERR_NAME_NOT_RESOLVED even though the
    // upload had succeeded.
    if (this.storage) {
      const { url, expiresAt } = await this.storage.getSignedDownloadUrl({
        key: `${NOOP_UPLOAD_KEY_PREFIX}/${assetId}`,
        ttlSeconds,
      });
      return { url, expiresAt, provider: PROVIDER_NAME };
    }

    // No storage seam (unit tests): deterministic fake URL, unchanged shape.
    // The token is a deterministic string encoding (userId, lessonId, expS).
    // It is NOT a real JWT or HMAC — just a stable string for test assertions.
    const fakeToken = `noop-signed-${userId}-${lessonId}-${expS}`;

    const url =
      `https://noop.video.local/hls/${encodeURIComponent(assetId)}/manifest.m3u8?token=${fakeToken}`;

    return {
      url,
      expiresAt: new Date(expS * 1000),
      provider: PROVIDER_NAME,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // verifyWebhookSignature — real HMAC with test secret; FAIL CLOSED when absent
  // ───────────────────────────────────────────────────────────────────────────

  verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
    if (this.simulateWebhookSecretAbsent || !this.webhookSecret) {
      this.logger.warn(
        "[NoopVideoProvider] verifyWebhookSignature: webhook secret absent — " +
          "returning false (fail closed).",
      );
      return false;
    }

    // For the Noop provider, we treat signatureHeader directly as the HMAC hex of rawBody
    // (no time-prefixed source string), keeping test fixture derivation simple.
    // See makeWebhookSignature() static helper below.
    const { rawBody, signatureHeader } = input;

    const expectedHex = createHmac("sha256", this.webhookSecret)
      .update(rawBody)
      .digest("hex");

    return timingSafeEqualHex(expectedHex, signatureHeader);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // parseTranscodeEvent — accepts noop fixture payloads
  // ───────────────────────────────────────────────────────────────────────────

  parseTranscodeEvent(payload: Record<string, unknown>): TranscodeEvent | null {
    // Accept a minimal Cloudflare-like fixture for test convenience:
    //   { uid: "fake-asset-123", readyToStream: true, duration: 90 }
    // OR a minimal Mux-like fixture:
    //   { type: "video.asset.ready", data: { id: "fake-asset-123", duration: 90 } }
    // OR a noop-specific fixture:
    //   { noop: true, uid: "...", status: "ready" | "errored" | "processing" }

    // Try noop-specific shape first
    if (payload["noop"] === true) {
      const uid = typeof payload["uid"] === "string" ? payload["uid"] : null;
      if (!uid) return null;

      const rawStatus = payload["status"];
      let status: TranscodeEvent["status"];
      if (rawStatus === "ready") status = "ready";
      else if (rawStatus === "errored") status = "errored";
      else status = "processing";

      const durationRaw = payload["duration"];
      const durationS =
        typeof durationRaw === "number" && durationRaw > 0 ? Math.round(durationRaw) : undefined;

      return { providerAssetId: uid, status, durationS };
    }

    // Try Cloudflare-like shape
    if (typeof payload["uid"] === "string") {
      const uid = payload["uid"] as string;
      const readyToStream = payload["readyToStream"] === true;
      const state = typeof payload["state"] === "string" ? payload["state"] : "";
      const durationRaw = payload["duration"];

      let status: TranscodeEvent["status"];
      if (readyToStream || state === "ready") status = "ready";
      else if (state === "error") status = "errored";
      else status = "processing";

      const durationS =
        typeof durationRaw === "number" && durationRaw > 0 ? Math.round(durationRaw) : undefined;

      return { providerAssetId: uid, status, durationS };
    }

    // Try Mux-like shape
    if (typeof payload["type"] === "string" && (payload["type"] as string).startsWith("video.asset")) {
      const dataPayload = payload["data"] as Record<string, unknown> | undefined;
      const objectPayload = payload["object"] as Record<string, unknown> | undefined;

      const assetId =
        (typeof dataPayload?.["id"] === "string" ? dataPayload["id"] : null) ??
        (typeof objectPayload?.["id"] === "string" ? objectPayload["id"] : null);

      if (!assetId) return null;

      const eventType = payload["type"] as string;
      let status: TranscodeEvent["status"];
      if (eventType === "video.asset.ready") status = "ready";
      else if (eventType === "video.asset.errored") status = "errored";
      else status = "processing";

      const durationRaw = dataPayload?.["duration"];
      const durationS =
        typeof durationRaw === "number" && durationRaw > 0 ? Math.round(durationRaw) : undefined;

      return { providerAssetId: assetId, status, durationS };
    }

    return null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // createUploadTarget — deterministic fake upload target for tests
  // ───────────────────────────────────────────────────────────────────────────

  async createUploadTarget(input: CreateUploadTargetInput): Promise<CreateUploadTargetResult> {
    const fakeAssetId = `noop-asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // A real browser PUTs the file to whatever URL we hand back, so `noop.video.local`
    // (a host that does not resolve) surfaces in the CRM as "Network error during upload".
    // When a storage seam is wired — dev runs STORAGE_PROVIDER=local — mint a signed URL
    // against it so the upload actually lands. Transcoding still no-ops: the asset stays
    // `processing` until a transcode webhook is replayed, exactly as before.
    if (this.storage) {
      const { url } = await this.storage.getSignedUploadUrl({
        key: `${NOOP_UPLOAD_KEY_PREFIX}/${fakeAssetId}`,
        contentType: "video/mp4",
        maxBytes: input.maxSizeBytes ?? NOOP_UPLOAD_MAX_BYTES,
      });
      this.logger.log(
        `[NoopVideoProvider] createUploadTarget: asset ${fakeAssetId} → storage-backed upload URL`,
      );
      return { uploadUrl: url, providerAssetId: fakeAssetId };
    }

    const uploadUrl = `https://noop.video.local/upload/${fakeAssetId}`;

    this.logger.log(
      `[NoopVideoProvider] createUploadTarget: fake asset ${fakeAssetId}`,
    );

    return {
      uploadUrl,
      providerAssetId: fakeAssetId,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Static test helpers — for deriving HMAC values in test fixtures.
  // These do NOT belong on the VideoProvider interface; they are test-double
  // utilities only, mirroring NoopPaymentProvider.makeWebhookSignature().
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Computes the expected HMAC-SHA256 webhook signature for a given raw body
   * using a test secret. Use this in test suites to build valid and invalid
   * signature fixtures for verifyWebhookSignature:
   *
   *   const rawBody = '{"uid":"fake-asset-123","readyToStream":true}';
   *   const sig = NoopVideoProvider.makeWebhookSignature(rawBody);
   *   expect(noopProvider.verifyWebhookSignature({ rawBody, signatureHeader: sig })).toBe(true);
   */
  static makeWebhookSignature(
    rawBody: string | Buffer,
    secret: string = DEFAULT_NOOP_WEBHOOK_SECRET,
  ): string {
    return createHmac("sha256", secret).update(rawBody).digest("hex");
  }

  /**
   * Builds the deterministic fake signed HLS URL for a given (assetId, userId,
   * lessonId, expS) without constructing a full provider instance.
   * Useful for asserting URL shape in unit tests.
   */
  static buildExpectedUrl(
    assetId: string,
    userId: string,
    lessonId: string,
    expS: number,
  ): string {
    const fakeToken = `noop-signed-${userId}-${lessonId}-${expS}`;
    return `https://noop.video.local/hls/${encodeURIComponent(assetId)}/manifest.m3u8?token=${fakeToken}`;
  }
}
