// apps/api/src/modules/lms/providers/video/mux-video.provider.ts
//
// Mux implementation of VideoProvider (docs/04-trd-architecture.md §2.10 "swap target").
// Bound to the VIDEO_PROVIDER DI token when VIDEO_PROVIDER=mux.
// Feature modules NEVER import this class directly — they inject VIDEO_PROVIDER.
//
// ─── SIGNED PLAYBACK URL STRATEGY ────────────────────────────────────────────
//
// Mux uses RS256 JWTs appended as a query parameter to the HLS manifest URL.
// Reference: https://www.mux.com/docs/guides/secure-video-playback
//
//   1. Create a URL signing key pair in the Mux dashboard (Settings > Signing Keys).
//      The private key (base64-encoded PKCS#8) is stored in MUX_SIGNING_KEY_PRIVATE.
//      The key id is stored in MUX_SIGNING_KEY_ID.
//   2. The asset must be created with `playback_policy: ['signed']` and a `playback_id`
//      must exist. The `assetId` input to mintSignedHlsUrl MUST be the Mux playback_id
//      (not the asset id) — the caller is responsible for storing the playback_id in
//      `videos.provider_asset_id`.
//   3. JWT claims (RS256):
//        sub: the Mux playback_id
//        aud: "v" (video asset audience)
//        exp: unix epoch seconds
//        kid: MUX_SIGNING_KEY_ID (in the JOSE header)
//        (custom) userId, lessonId for per-user scoping / audit
//   4. The signed HLS URL format:
//        https://stream.mux.com/<PLAYBACK_ID>.m3u8?token=<JWT>
//
// Signing uses `jose` (already a project dependency — see apps/api/package.json).
//
// ─── WEBHOOK VERIFICATION ─────────────────────────────────────────────────────
//
// Mux sends a `Mux-Signature` header: "t=<timestamp>,v1=<hex>"
//
// Verification:
//   source_string = `${timestamp}.${rawBody}`
//   expected_hex  = HMAC-SHA256(source_string, MUX_WEBHOOK_SECRET)
//   compare constant-time: expected_hex === v1
//
// FAIL CLOSED: if MUX_WEBHOOK_SECRET is absent, return false.
//
// ─── SECURITY INVARIANTS ──────────────────────────────────────────────────────
//
//   - MUX_TOKEN_ID / MUX_TOKEN_SECRET: Basic auth for the Mux API; never returned/logged.
//   - MUX_SIGNING_KEY_PRIVATE: the RS256 private key; never returned, never logged.
//     The SIGNED URL is returned; the key that produced it is NOT.
//   - MUX_WEBHOOK_SECRET: used only in verifyWebhookSignature; never logged or returned.
//   - All comparisons via node:crypto timingSafeEqual (constant-time).
//   - Constructor MUST NOT throw when keys are absent (lazy-validation, same as P2 Razorpay).

import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
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
import { timingSafeEqualHex } from "./cloudflare-stream-video.provider";

// ─────────────────────────────────────────────────────────────────────────────
// Mux API response shapes (internal, not exported)
// ─────────────────────────────────────────────────────────────────────────────

interface MuxCreateAssetResponse {
  data: {
    id: string;
    playback_ids?: Array<{ id: string; policy: string }>;
  };
}

interface MuxWebhookPayload {
  // Mux webhook event structure
  type?: string; // e.g. "video.asset.ready", "video.asset.errored"
  object?: {
    type?: string;
    id?: string; // asset id
  };
  data?: {
    id?: string;            // asset id
    playback_ids?: Array<{ id: string; policy: string }>;
    duration?: number;      // seconds (float)
    status?: string;        // "ready" | "errored" | "preparing"
    errors?: unknown;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MUX_API_BASE = "https://api.mux.com";
const PROVIDER_NAME = "mux" as const;

@Injectable()
export class MuxVideoProvider implements VideoProvider {
  private readonly logger = new Logger(MuxVideoProvider.name);

  // All key material resolved from env at construction; stored private readonly.
  // Never returned or logged. May be undefined: app boots without video config.
  private readonly tokenId: string | undefined;
  private readonly tokenSecret: string | undefined;
  private readonly signingKeyId: string | undefined;
  // Mux provides the private key as a base64-encoded PKCS#8 PEM.
  private readonly signingKeyPrivateRaw: string | undefined;
  private readonly webhookSecret: string | undefined;

  // Memoized jose CryptoKey derived from signingKeyPrivateRaw (imported once on first use).
  private signingKeyCache: CryptoKey | undefined;

  constructor() {
    const env = validateEnv();
    this.tokenId = env.MUX_TOKEN_ID;
    this.tokenSecret = env.MUX_TOKEN_SECRET;
    this.signingKeyId = env.MUX_SIGNING_KEY_ID;
    this.signingKeyPrivateRaw = env.MUX_SIGNING_KEY_PRIVATE;
    this.webhookSecret = env.MUX_WEBHOOK_SECRET;

    const missingKeys: string[] = [];
    if (!this.tokenId) missingKeys.push("MUX_TOKEN_ID");
    if (!this.tokenSecret) missingKeys.push("MUX_TOKEN_SECRET");
    if (!this.signingKeyId) missingKeys.push("MUX_SIGNING_KEY_ID");
    if (!this.signingKeyPrivateRaw) missingKeys.push("MUX_SIGNING_KEY_PRIVATE");

    if (missingKeys.length > 0) {
      this.logger.warn(
        `[MuxVideoProvider] Missing env vars: ${missingKeys.join(", ")}. ` +
          "Video streaming (mintSignedHlsUrl) will fail until these are set. " +
          "App boot continues. Set VIDEO_PROVIDER=noop in .env for local dev.",
      );
    }
    if (!this.webhookSecret) {
      this.logger.warn(
        "[MuxVideoProvider] MUX_WEBHOOK_SECRET is not configured. " +
          "Webhook signature verification will FAIL CLOSED, all incoming transcode webhooks " +
          "will be rejected until this secret is set.",
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: lazy key validation helpers
  // ───────────────────────────────────────────────────────────────────────────

  private requireApiCredentials(): { tokenId: string; tokenSecret: string } {
    if (!this.tokenId || !this.tokenSecret) {
      throw new Error(
        "[MuxVideoProvider] MUX_TOKEN_ID / MUX_TOKEN_SECRET not configured, " +
          "cannot perform this Mux API operation. " +
          "Add them to .env (see .env.example) or set VIDEO_PROVIDER=noop for local dev.",
      );
    }
    return { tokenId: this.tokenId, tokenSecret: this.tokenSecret };
  }

  private async requireSigningKey(): Promise<{ key: CryptoKey; keyId: string }> {
    if (!this.signingKeyId || !this.signingKeyPrivateRaw) {
      throw new Error(
        "[MuxVideoProvider] MUX_SIGNING_KEY_ID / MUX_SIGNING_KEY_PRIVATE not configured, " +
          "cannot mint signed playback URLs. " +
          "Create a URL signing key in the Mux dashboard (Settings > URL Signing Keys) " +
          "and add the base64-decoded private key + key id to .env (see .env.example).",
      );
    }

    if (!this.signingKeyCache) {
      // Mux provides the private key as a base64-encoded PKCS#8 PEM.
      // Decode from base64, then import as RS256 PKCS#8.
      const pemContent = this.signingKeyPrivateRaw.includes("-----BEGIN")
        ? this.signingKeyPrivateRaw.trim()
        : Buffer.from(this.signingKeyPrivateRaw, "base64").toString("utf8").trim();

      try {
        this.signingKeyCache = await importPKCS8(pemContent, "RS256");
      } catch (importErr) {
        throw new Error(
          "[MuxVideoProvider] Failed to import MUX_SIGNING_KEY_PRIVATE as RS256 private key: " +
            `${String(importErr)}. ` +
            "Ensure the key is a valid PKCS#8 PEM in either raw PEM or base64-encoded form.",
        );
      }
    }

    return { key: this.signingKeyCache, keyId: this.signingKeyId };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // mintSignedHlsUrl — RS256 JWT → signed playback URL; no raw URL returned
  // ───────────────────────────────────────────────────────────────────────────

  async mintSignedHlsUrl(input: MintSignedHlsUrlInput): Promise<MintSignedHlsUrlResult> {
    const { assetId, userId, lessonId, ttlSeconds = DEFAULT_HLS_TTL_SECONDS } = input;

    // `assetId` for Mux is the playback_id (stored in videos.provider_asset_id).
    // The caller (LmsService) stores the playback_id at upload/registration time.
    const { key, keyId } = await this.requireSigningKey();

    const nowS = Math.floor(Date.now() / 1000);
    const expS = nowS + ttlSeconds;

    // Mux JWT claims for video playback:
    //   sub: playback_id
    //   aud: "v" (video audience — distinguishes from thumbnail "t", GIF "g", etc.)
    //   exp: unix epoch seconds
    //   kid: MUX_SIGNING_KEY_ID (in the JOSE protected header)
    //   Custom: userId, lessonId for per-user scoping / audit
    let jwtToken: string;
    try {
      jwtToken = await new SignJWT({
        sub: assetId,
        aud: "v",
        // Custom claims for per-(user, lesson) scoping — not consumed by Mux CDN
        // gating but embedded for forensic tracing:
        userId,
        lessonId,
      })
        .setProtectedHeader({ alg: "RS256", kid: keyId })
        .setIssuedAt(nowS)
        .setExpirationTime(expS)
        .sign(key);
    } catch (signErr) {
      throw new Error(
        `[MuxVideoProvider] Failed to sign playback URL JWT: ${String(signErr)}`,
      );
    }

    // Mux signed HLS URL: append token query parameter to the playback URL.
    // The playback_id is the assetId here.
    const url = `https://stream.mux.com/${encodeURIComponent(assetId)}.m3u8?token=${jwtToken}`;

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
        "[MuxVideoProvider] verifyWebhookSignature called but " +
          "MUX_WEBHOOK_SECRET is not configured, rejecting webhook (fail closed).",
      );
      return false;
    }

    const { rawBody, signatureHeader } = input;

    // Parse the Mux-Signature header: "t=<timestamp>,v1=<hex>"
    const parsedSig = parseMuxWebhookSignatureHeader(signatureHeader);
    if (!parsedSig) {
      this.logger.warn(
        "[MuxVideoProvider] verifyWebhookSignature: could not parse Mux-Signature header, " +
          "rejecting (fail closed).",
      );
      return false;
    }

    const { timestamp, v1 } = parsedSig;

    // source_string = "<timestamp>.<rawBody>"
    const rawBodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
    const sourceString = `${timestamp}.${rawBodyStr}`;

    const expectedHex = createHmac("sha256", this.webhookSecret)
      .update(sourceString, "utf8")
      .digest("hex");

    return timingSafeEqualHex(expectedHex, v1);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // parseTranscodeEvent — normalise Mux webhook payload
  // ───────────────────────────────────────────────────────────────────────────

  parseTranscodeEvent(payload: Record<string, unknown>): TranscodeEvent | null {
    // Mux webhook payload shape:
    // {
    //   type: "video.asset.ready" | "video.asset.errored" | "video.asset.created" | ...
    //   object: { type: "asset", id: "<asset_id>" }
    //   data: { id: "<asset_id>", duration: 120.5, status: "ready" | "errored", ... }
    // }
    const mux = payload as MuxWebhookPayload;
    const eventType = typeof mux.type === "string" ? mux.type : null;

    if (!eventType || !eventType.startsWith("video.asset")) {
      // Not a video asset event (e.g. video.live_stream.* — skip gracefully).
      return null;
    }

    // Extract the asset id from data.id or object.id
    const assetId =
      (typeof mux.data?.id === "string" ? mux.data.id : null) ??
      (typeof mux.object?.id === "string" ? mux.object.id : null);

    if (!assetId) {
      // Unexpected payload shape — skip rather than throw.
      this.logger.warn(
        `[MuxVideoProvider] parseTranscodeEvent: received event type '${eventType}' ` +
          "but could not extract asset id from payload. Skipping.",
      );
      return null;
    }

    let status: TranscodeEvent["status"];
    if (eventType === "video.asset.ready" || mux.data?.status === "ready") {
      status = "ready";
    } else if (eventType === "video.asset.errored" || mux.data?.status === "errored") {
      status = "errored";
    } else {
      // video.asset.created, video.asset.updated while preparing → still processing
      status = "processing";
    }

    const durationRaw = mux.data?.duration;
    const durationS =
      typeof durationRaw === "number" && durationRaw > 0
        ? Math.round(durationRaw)
        : undefined;

    return {
      providerAssetId: assetId,
      status,
      durationS,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // createUploadTarget — direct upload via Mux API
  // ───────────────────────────────────────────────────────────────────────────

  async createUploadTarget(input: CreateUploadTargetInput): Promise<CreateUploadTargetResult> {
    const { tokenId, tokenSecret } = this.requireApiCredentials();
    const credentials = Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64");

    const body: Record<string, unknown> = {
      cors_origin: "*",
      new_asset_settings: {
        playback_policy: ["signed"],
      },
    };
    if (input.metadata) {
      const settings = body["new_asset_settings"] as Record<string, unknown>;
      settings["passthrough"] = JSON.stringify(input.metadata);
    }

    let response: Response;
    try {
      response = await fetch(`${MUX_API_BASE}/video/v1/uploads`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      this.logger.error(
        `[MuxVideoProvider] Network error creating upload target: ${String(networkErr)}`,
      );
      throw new Error(
        "[MuxVideoProvider] Network error calling Mux API. Check connectivity and retry.",
      );
    }

    if (!response.ok) {
      let errText = "";
      try {
        const errJson = (await response.json()) as { error?: { messages?: string[] } };
        errText = errJson.error?.messages?.[0] ?? response.statusText;
      } catch {
        errText = response.statusText;
      }
      this.logger.error(
        `[MuxVideoProvider] API error creating upload target: HTTP ${response.status} · ${errText}`,
      );
      throw new Error(`[MuxVideoProvider] Mux API returned HTTP ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as MuxCreateAssetResponse;
    if (!data.data?.id) {
      throw new Error(
        "[MuxVideoProvider] Mux API returned an unexpected response shape for createUploadTarget " +
          "Missing data.id.",
      );
    }

    // For Mux direct uploads, the upload URL is in the response (url field).
    // The asset id is in data.id; the actual playback_id comes in a later webhook.
    // We store data.id temporarily and update to playback_id on `video.asset.ready`.
    const dataWithUrl = data.data as Record<string, unknown>;
    const uploadUrl = typeof dataWithUrl["url"] === "string" ? dataWithUrl["url"] : "";

    return {
      uploadUrl,
      providerAssetId: data.data.id,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (module-private, exported for testability)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses the Mux `Mux-Signature` header value.
 * Format: "t=<unix_ts>,v1=<hex>"
 * Returns null if the header is missing, malformed, or either value is absent.
 */
export function parseMuxWebhookSignatureHeader(
  header: string | undefined | null,
): { timestamp: string; v1: string } | null {
  if (!header) return null;

  let timestamp: string | undefined;
  let v1: string | undefined;

  for (const part of header.split(",")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("t=")) {
      timestamp = trimmed.slice("t=".length).trim();
    } else if (trimmed.startsWith("v1=")) {
      v1 = trimmed.slice("v1=".length).trim();
    }
  }

  if (!timestamp || !v1) return null;
  return { timestamp, v1 };
}
