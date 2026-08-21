// apps/api/src/modules/lms/providers/video/cloudflare-stream-video.provider.ts
//
// Cloudflare Stream implementation of VideoProvider (docs/04-trd-architecture.md §2.10,
// docs/plans/phase-3.md task #4). Bound to the VIDEO_PROVIDER DI token in
// VideoProviderModule when VIDEO_PROVIDER=cloudflare_stream — feature modules NEVER
// import this class directly.
//
// ─── SIGNED HLS URL STRATEGY ─────────────────────────────────────────────────
//
// Cloudflare Stream uses RS256 JWTs to gate HLS playback:
//   1. A signing key pair is created via the Cloudflare API (/stream/keys).
//      The private key PEM (base64-encoded by CF, must be decoded) is stored in
//      CLOUDFLARE_STREAM_SIGNING_KEY_PEM.
//      The key id (kid) is stored in CLOUDFLARE_STREAM_SIGNING_KEY_ID.
//   2. To mint a signed URL, we produce a JWT with claims:
//        kid (key id in the header alg RS256)
//        sub (the stream video UID / asset id)
//        exp (unix epoch seconds — now + ttlSeconds)
//        nbf (now — immediately valid)
//        (optional custom claims: userId, lessonId for per-user scoping)
//   3. The signed HLS URL format is:
//        https://customer-<ACCOUNT_CODE>.cloudflarestream.com/<JWT_TOKEN>/manifest/video.m3u8
//   4. The ACCOUNT_CODE is derived from the account id stored in
//        CLOUDFLARE_ACCOUNT_ID (used for the API + CDN URL construction).
//
// Signing uses `jose` (already a project dependency — see apps/api/package.json).
// jose v6 is ESM-only; the unit test suite uses a stub (see jest.config.js §moduleNameMapper).
//
// ─── WEBHOOK VERIFICATION ─────────────────────────────────────────────────────
//
// Cloudflare Stream sends a `Webhook-Signature` header:
//   "time=<unix_ts>,sig1=<hex_signature>"
//
// Verification:
//   source_string = `${time}.${rawBody}`
//   expected_hex  = HMAC-SHA256(source_string, CLOUDFLARE_STREAM_WEBHOOK_SECRET)
//   compare constant-time: expected_hex === sig1
//
// FAIL CLOSED: if CLOUDFLARE_STREAM_WEBHOOK_SECRET is absent, return false.
//
// ─── SECURITY INVARIANTS ──────────────────────────────────────────────────────
//
//   - CLOUDFLARE_STREAM_API_TOKEN: consumed only inside this file; never logged, never
//     returned from any method, never included in any error message or thrown string.
//   - CLOUDFLARE_STREAM_SIGNING_KEY_PEM: the RS256 private key; never logged, never
//     returned, never serialised. The SIGNED URL (containing the JWT) IS returned but
//     the private key that produced it NEVER is.
//   - CLOUDFLARE_STREAM_WEBHOOK_SECRET: used only in verifyWebhookSignature; never logged
//     or returned.
//   - All signature comparisons use node:crypto timingSafeEqual (constant-time).
//   - Constructor MUST NOT throw when keys are absent (lazy validation). The app boots
//     with VIDEO_PROVIDER=noop and no keys. Keys validated lazily at call time.

import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, importPKCS8, type CryptoKey } from "jose";
import { validateEnv } from "../../../../config/env";
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
// Cloudflare API response shapes (internal, not exported)
// ─────────────────────────────────────────────────────────────────────────────

interface CloudflareStreamCreateUploadResponse {
  result: {
    uid: string;
    uploadURL: string;
  };
  success: boolean;
  errors: Array<{ code: number; message: string }>;
}

interface CloudflareStreamWebhookPayload {
  uid?: string;
  readyToStream?: boolean;
  state?: string;
  duration?: number;
  // The Cloudflare Stream webhook includes these top-level fields.
  // We access them defensively with optional chaining.
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const PROVIDER_NAME = "cloudflare_stream" as const;

@Injectable()
export class CloudflareStreamVideoProvider implements VideoProvider {
  private readonly logger = new Logger(CloudflareStreamVideoProvider.name);

  // All key material resolved from env at construction.
  // Stored as private readonly — NEVER returned or logged.
  // May be undefined: the app must boot without video config.
  // Keys validated LAZILY at call time (fail-closed pattern — see P2 Razorpay provider).
  private readonly accountId: string | undefined;
  private readonly apiToken: string | undefined;
  private readonly signingKeyId: string | undefined;
  // The PEM may be base64-encoded (Cloudflare encodes it); we decode lazily.
  private readonly signingKeyPemRaw: string | undefined;
  private readonly webhookSecret: string | undefined;

  // Memoized jose CryptoKey derived from signingKeyPemRaw (decoded once on first use).
  // We cannot do this in the constructor because importPKCS8 is async.
  private signingKeyCache: CryptoKey | undefined;

  constructor() {
    const env = validateEnv();
    this.accountId = env.CLOUDFLARE_ACCOUNT_ID;
    this.apiToken = env.CLOUDFLARE_STREAM_API_TOKEN;
    this.signingKeyId = env.CLOUDFLARE_STREAM_SIGNING_KEY_ID;
    this.signingKeyPemRaw = env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM;
    this.webhookSecret = env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;

    const missingKeys: string[] = [];
    if (!this.accountId) missingKeys.push("CLOUDFLARE_ACCOUNT_ID");
    if (!this.apiToken) missingKeys.push("CLOUDFLARE_STREAM_API_TOKEN");
    if (!this.signingKeyId) missingKeys.push("CLOUDFLARE_STREAM_SIGNING_KEY_ID");
    if (!this.signingKeyPemRaw) missingKeys.push("CLOUDFLARE_STREAM_SIGNING_KEY_PEM");

    if (missingKeys.length > 0) {
      this.logger.warn(
        `[CloudflareStreamVideoProvider] Missing env vars: ${missingKeys.join(", ")}. ` +
          "Video streaming (mintSignedHlsUrl) will fail until these are set. " +
          "App boot continues. Set VIDEO_PROVIDER=noop in .env for local dev.",
      );
    }
    if (!this.webhookSecret) {
      this.logger.warn(
        "[CloudflareStreamVideoProvider] CLOUDFLARE_STREAM_WEBHOOK_SECRET is not configured. " +
          "Webhook signature verification will FAIL CLOSED, all incoming transcode webhooks " +
          "will be rejected until this secret is set.",
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: lazy key validation helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Lazily asserts the API credentials for network calls (upload, etc).
   * Throws at CALL time so the app boots without video config.
   */
  private requireApiCredentials(): { accountId: string; apiToken: string } {
    if (!this.accountId || !this.apiToken) {
      throw new Error(
        "[CloudflareStreamVideoProvider] CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_STREAM_API_TOKEN " +
          "not configured. Cannot perform this video provider operation. " +
          "Add them to .env (see .env.example) or set VIDEO_PROVIDER=noop for local dev.",
      );
    }
    return { accountId: this.accountId, apiToken: this.apiToken };
  }

  /**
   * Lazily asserts and imports the RS256 signing key. Memoized after first import.
   * Throws at call time if key material is absent or malformed.
   */
  private async requireSigningKey(): Promise<{ key: CryptoKey; keyId: string }> {
    if (!this.signingKeyId || !this.signingKeyPemRaw) {
      throw new Error(
        "[CloudflareStreamVideoProvider] CLOUDFLARE_STREAM_SIGNING_KEY_ID / " +
          "CLOUDFLARE_STREAM_SIGNING_KEY_PEM not configured. Cannot mint signed HLS URLs. " +
          "Create a signing key in the Cloudflare Stream dashboard (or via API) and add the " +
          "PEM (base64-decoded) + key id to .env (see .env.example).",
      );
    }

    if (!this.signingKeyCache) {
      // Cloudflare returns the PEM base64-encoded when creating a key via API.
      // The env var may contain the raw PEM (-----BEGIN...) OR a base64 encoding
      // of it. We detect by checking for the PEM header.
      const pemContent = this.signingKeyPemRaw.includes("-----BEGIN")
        ? this.signingKeyPemRaw.trim()
        : Buffer.from(this.signingKeyPemRaw, "base64").toString("utf8").trim();

      try {
        this.signingKeyCache = await importPKCS8(pemContent, "RS256");
      } catch (importErr) {
        throw new Error(
          "[CloudflareStreamVideoProvider] Failed to import CLOUDFLARE_STREAM_SIGNING_KEY_PEM " +
            `as an RS256 private key: ${String(importErr)}. ` +
            "Ensure the key is a valid PKCS#8 PEM (the base64-decoded form of what " +
            "Cloudflare returns when you create a signing key).",
        );
      }
    }

    return { key: this.signingKeyCache, keyId: this.signingKeyId };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // mintSignedHlsUrl — THE CORE: no raw URL ever returned
  // ───────────────────────────────────────────────────────────────────────────

  async mintSignedHlsUrl(input: MintSignedHlsUrlInput): Promise<MintSignedHlsUrlResult> {
    const { assetId, userId, lessonId, ttlSeconds = DEFAULT_HLS_TTL_SECONDS } = input;

    if (!this.accountId) {
      // Validate lazily so we give a clear error
      this.requireApiCredentials();
    }
    const { key, keyId } = await this.requireSigningKey();

    const nowS = Math.floor(Date.now() / 1000);
    const expS = nowS + ttlSeconds;

    // Build and sign the RS256 JWT.
    // Claims:
    //   sub: the Cloudflare Stream video UID (asset id)
    //   kid: the signing key id (in the JOSE header, not the payload)
    //   exp: unix epoch seconds when the token expires
    //   nbf: now (token valid immediately)
    //   Custom claims for per-user scoping / audit (not consumed by CF CDN gating,
    //   but embedded for forensics and CDN log correlation):
    //     userId, lessonId
    //
    // SECURITY: the private key (`key`) signs the JWT; the key NEVER appears in
    // the JWT itself or in any return value. Only the signed token (url) is returned.
    let jwtToken: string;
    try {
      jwtToken = await new SignJWT({
        sub: assetId,
        // Custom claims for per-(user, lesson) scoping — defence-in-depth
        userId,
        lessonId,
      })
        .setProtectedHeader({ alg: "RS256", kid: keyId })
        .setIssuedAt(nowS)
        .setNotBefore(nowS)
        .setExpirationTime(expS)
        .sign(key);
    } catch (signErr) {
      throw new Error(
        "[CloudflareStreamVideoProvider] Failed to sign HLS URL JWT: " +
          `${String(signErr)}`,
      );
    }

    // The Cloudflare Stream signed HLS URL format:
    //   https://customer-<ACCOUNT_ID>.cloudflarestream.com/<JWT>/manifest/video.m3u8
    // Note: the account id here is actually the customer subdomain code.
    // Cloudflare uses the accountId as the subdomain customer code for CDN URLs.
    const url =
      `https://customer-${this.accountId}.cloudflarestream.com/${jwtToken}/manifest/video.m3u8`;

    return {
      url,
      expiresAt: new Date(expS * 1000),
      provider: PROVIDER_NAME,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // verifyWebhookSignature — FAIL CLOSED, constant-time
  // ───────────────────────────────────────────────────────────────────────────

  verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
    if (!this.webhookSecret) {
      this.logger.warn(
        "[CloudflareStreamVideoProvider] verifyWebhookSignature called but " +
          "CLOUDFLARE_STREAM_WEBHOOK_SECRET is not configured, rejecting webhook (fail closed).",
      );
      return false;
    }

    const { rawBody, signatureHeader } = input;

    // Parse the Webhook-Signature header:
    //   "time=1230811200,sig1=60493ec9388b..."
    const parsedSig = parseCloudflareWebhookSignatureHeader(signatureHeader);
    if (!parsedSig) {
      this.logger.warn(
        "[CloudflareStreamVideoProvider] verifyWebhookSignature: could not parse " +
          "Webhook-Signature header, rejecting (fail closed).",
      );
      return false;
    }

    const { time, sig1 } = parsedSig;

    // source_string = "<time>.<rawBody>"
    const rawBodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
    const sourceString = `${time}.${rawBodyStr}`;

    const expectedHex = createHmac("sha256", this.webhookSecret)
      .update(sourceString, "utf8")
      .digest("hex");

    return timingSafeEqualHex(expectedHex, sig1);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // parseTranscodeEvent — normalise CF Stream webhook payload
  // ───────────────────────────────────────────────────────────────────────────

  parseTranscodeEvent(payload: Record<string, unknown>): TranscodeEvent | null {
    // Cloudflare Stream transcode webhook payload (simplified shape):
    // {
    //   uid: "...",             // video UID (= provider_asset_id)
    //   readyToStream: true,   // true when ready to play
    //   state: "ready" | "error" | "pendingupload" | "uploading" | "queued" | "inprogress"
    //   duration: 120,         // seconds (may be null/0 while processing)
    // }
    const cf = payload as CloudflareStreamWebhookPayload;

    const uid = typeof cf.uid === "string" ? cf.uid : null;
    if (!uid) {
      // Not a Cloudflare Stream video event — possibly a ping or unrelated event.
      return null;
    }

    let status: TranscodeEvent["status"];
    if (cf.readyToStream === true || cf.state === "ready") {
      status = "ready";
    } else if (cf.state === "error") {
      status = "errored";
    } else {
      // pendingupload, uploading, queued, inprogress → still processing
      status = "processing";
    }

    const durationS =
      typeof cf.duration === "number" && cf.duration > 0 ? Math.round(cf.duration) : undefined;

    return {
      providerAssetId: uid,
      status,
      durationS,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // createUploadTarget — one-time upload URL via Cloudflare API
  // ───────────────────────────────────────────────────────────────────────────

  async createUploadTarget(input: CreateUploadTargetInput): Promise<CreateUploadTargetResult> {
    const { accountId, apiToken } = this.requireApiCredentials();

    const body: Record<string, unknown> = {
      allowedOrigins: [],
    };
    if (input.maxSizeBytes) {
      body["maxDurationSeconds"] = Math.ceil(input.maxSizeBytes / (1024 * 1024)); // rough heuristic
    }
    if (input.metadata) {
      body["meta"] = input.metadata;
    }

    let response: Response;
    try {
      response = await fetch(
        `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(accountId)}/stream?direct_user=true`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    } catch (networkErr) {
      this.logger.error(
        `[CloudflareStreamVideoProvider] Network error creating upload target: ${String(networkErr)}`,
      );
      throw new Error(
        "[CloudflareStreamVideoProvider] Network error calling Cloudflare Stream API. " +
          "Check connectivity and retry.",
      );
    }

    if (!response.ok) {
      let errText = "";
      try {
        const errJson = (await response.json()) as CloudflareStreamCreateUploadResponse;
        errText = errJson.errors?.[0]?.message ?? response.statusText;
      } catch {
        errText = response.statusText;
      }
      this.logger.error(
        `[CloudflareStreamVideoProvider] API error creating upload target: HTTP ${response.status} · ${errText}`,
      );
      throw new Error(
        `[CloudflareStreamVideoProvider] Cloudflare Stream API returned HTTP ${response.status}: ${errText}`,
      );
    }

    const data = (await response.json()) as CloudflareStreamCreateUploadResponse;
    if (!data.success || !data.result?.uid || !data.result?.uploadURL) {
      throw new Error(
        "[CloudflareStreamVideoProvider] Cloudflare Stream API returned an unexpected response shape " +
          "for createUploadTarget, missing uid or uploadURL.",
      );
    }

    return {
      uploadUrl: data.result.uploadURL,
      providerAssetId: data.result.uid,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (module-private, exported for testability)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses the Cloudflare Stream `Webhook-Signature` header value.
 * Format: "time=<unix_ts>,sig1=<hex>"
 * Returns null if the header is missing, malformed, or either value is absent.
 */
export function parseCloudflareWebhookSignatureHeader(
  header: string | undefined | null,
): { time: string; sig1: string } | null {
  if (!header) return null;

  let time: string | undefined;
  let sig1: string | undefined;

  for (const part of header.split(",")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("time=")) {
      time = trimmed.slice("time=".length).trim();
    } else if (trimmed.startsWith("sig1=")) {
      sig1 = trimmed.slice("sig1=".length).trim();
    }
  }

  if (!time || !sig1) return null;
  return { time, sig1 };
}

/**
 * Constant-time hex string comparison using node:crypto timingSafeEqual.
 * Both strings must be hex-encoded HMAC digests of the same expected length.
 * Returns false if lengths differ (still runs constant-time on `a` to avoid
 * leaking length information through early return timing).
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");

  if (aBuf.length !== bBuf.length) {
    // Lengths differ — definitely not equal. Run a constant-time no-op on `a` to
    // avoid leaking the expected length through early-return timing.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }

  return timingSafeEqual(aBuf, bBuf);
}
