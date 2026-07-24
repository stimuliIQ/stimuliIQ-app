// apps/api/src/modules/lms/providers/video/video-provider.interface.ts
//
// Vendor-swappable video provider interface (CLAUDE.md §3.7: "all external calls go
// through a provider interface — never call a vendor SDK directly from a feature module").
//
// LMS services depend ONLY on this interface via the VIDEO_PROVIDER DI token.
// The default Phase-3 implementation is CloudflareStreamVideoProvider (Cloudflare
// Stream with RS256 signed HLS tokens). Swapping to Mux means implementing this
// interface and rebinding the DI token — LmsService is unaffected.
//
// References:
//   docs/04-trd-architecture.md §2.10 (provider table: VideoProvider → Cloudflare Stream, swap Mux)
//   docs/04-trd-architecture.md §2.12 (video streaming architecture: short-lived signed HLS URL)
//   docs/04-trd-architecture.md §7    (signed media security checklist)
//   docs/plans/phase-3.md task #4 DoD
//
// ─── SECURITY CONTRACT ───────────────────────────────────────────────────────
//
// 1. mintSignedHlsUrl MUST return a SHORT-LIVED SIGNED URL only. No raw manifest
//    URL, no unsigned CDN link, and no provider_asset_id must ever reach the client.
//    The TTL is ≤ 300 s by default (5 min); the backend configures it server-side.
//
// 2. verifyWebhookSignature MUST FAIL CLOSED: if the webhook secret is not configured,
//    return false, NEVER true. The implementation logs a warning. Callers must treat
//    false as a rejected webhook (HTTP 401/400).
//
// 3. All signing keys, API tokens, and webhook secrets are consumed only inside
//    the concrete provider classes. They must NEVER appear in any return value, log
//    line, error message, or thrown string from this interface or its implementations.
//
// 4. parseTranscodeEvent normalises provider-specific payloads so the backend never
//    branches on the provider name. The provider_asset_id in the event payload is
//    used only to look up the internal DB row; it must not be forwarded to the client.
//
// 5. The constructor MUST NOT throw when keys are absent (lazy validation). The app
//    must boot with VIDEO_PROVIDER=noop and no video keys configured. Keys are
//    validated lazily at call time (fail-closed pattern from P2 Razorpay provider).

// ─────────────────────────────────────────────────────────────────────────────
// Input / output shapes (provider-layer, not HTTP DTOs)
// ─────────────────────────────────────────────────────────────────────────────

export interface MintSignedHlsUrlInput {
  /**
   * The provider-internal asset/video identifier (stored in `videos.provider_asset_id`).
   * For Cloudflare Stream: the Stream video UID.
   * For Mux: the Mux playback ID (not asset ID — the playback ID is what's signed).
   *
   * This field MUST NEVER appear in the response or be forwarded to the client.
   * It is the server's internal reference only.
   */
  assetId: string;

  /**
   * The authenticated student's user id (UUID). Embedded in the JWT claims
   * for audit/forensics; ensures the signed token is scoped to this user.
   * Included as a custom claim so the provider CDN's logs can trace which user
   * streamed which video.
   */
  userId: string;

  /**
   * The lesson id (UUID). Embedded in the JWT claims alongside userId so the
   * token is tied to a specific (user, lesson) pair, not just the asset.
   */
  lessonId: string;

  /**
   * Token lifetime in seconds. Defaults to DEFAULT_HLS_TTL_SECONDS (300 = 5 min).
   * The backend always supplies a server-side constant — never a client-supplied value.
   */
  ttlSeconds?: number;
}

export interface MintSignedHlsUrlResult {
  /**
   * A SHORT-LIVED SIGNED HLS manifest URL. This is the ONLY URL that should
   * be returned to the client. It expires at `expiresAt` and must NOT be cached.
   *
   * Cloudflare Stream: https://customer-<CODE>.cloudflarestream.com/<TOKEN>/manifest/video.m3u8
   * Mux:               https://stream.mux.com/<PLAYBACK_ID>.m3u8?token=<JWT>
   * Noop:              https://noop.video.local/hls/<ASSET_ID>/manifest.m3u8?token=noop-signed-<...>
   */
  url: string;

  /**
   * Absolute UTC datetime when `url` expires. The player should re-call the
   * stream-url endpoint before or at this time.
   */
  expiresAt: Date;

  /**
   * Which provider produced this URL. Used by the backend to populate the
   * `StreamUrlResponse.provider` field. Never a decision branch for the client.
   */
  provider: "noop" | "cloudflare_stream" | "mux";
}

export interface VerifyWebhookSignatureInput {
  /**
   * The raw HTTP request body — MUST be the original bytes received from the
   * provider, NOT the parsed JSON. See RAW-BODY NOTE below.
   *
   * For Cloudflare Stream: the signature source string is `<time>.<body>` using
   * the `time` value extracted from the Webhook-Signature header.
   * For Mux: the source string is `<timestamp>.<body>` using the `t=` value from
   * the Mux-Signature header.
   * For Noop: body is compared against a HMAC using the test webhook secret.
   *
   * ─── RAW-BODY NOTE FOR WAVE-4 BACKEND-BUILDER ────────────────────────────
   * The transcode webhook controller (POST /api/v1/lms/videos/webhook) MUST:
   *
   * 1. In apps/api/src/main.ts — enable rawBody:
   *      const app = await NestFactory.create(AppModule, { rawBody: true });
   *      (This is already required for the P2 Razorpay webhook and should be
   *      present. If not, add it once and it covers all webhook routes.)
   *
   * 2. In the webhook controller method, use RawBodyRequest:
   *      import { RawBodyRequest } from '@nestjs/common';
   *      import type { Request } from 'express';
   *
   *      @Post('videos/webhook')
   *      @HttpCode(200)
   *      @Public()
   *      async handleTranscodeWebhook(
   *        @Req() req: RawBodyRequest<Request>,
   *        @Headers('webhook-signature') cfSig: string,    // Cloudflare Stream
   *        // OR: @Headers('mux-signature') muxSig: string // Mux
   *      ): Promise<{ received: boolean }> {
   *        const rawBody = req.rawBody;
   *        if (!rawBody) throw new BadRequestException('Raw body unavailable');
   *        const verified = this.videoProvider.verifyWebhookSignature({
   *          rawBody,
   *          signatureHeader: cfSig,
   *        });
   *        if (!verified) throw new UnauthorizedException('Webhook signature invalid');
   *        const event = this.videoProvider.parseTranscodeEvent(
   *          req.body as Record<string, unknown>
   *        );
   *        // ... update videos.status via the VideoWebhookProcessorPort (ADR-0020)
   *        return { received: true };
   *      }
   *
   * 3. The webhook route MUST be:
   *      a) Excluded from JwtAuthGuard via @Public() — the HMAC signature IS the auth.
   *      b) Excluded from the CSRF middleware (called by the provider server, not a browser).
   *         Apply CSRF exclusion by path pattern in CsrfMiddleware.configure().
   *      c) NOT subject to any rate limiter that would reject the provider's retry attempts.
   * ─────────────────────────────────────────────────────────────────────────
   */
  rawBody: string | Buffer;

  /**
   * The value of the provider's signature header, verbatim.
   *
   * Cloudflare Stream: value of the `Webhook-Signature` header,
   *   e.g. "time=1230811200,sig1=60493ec9388b..."
   * Mux: value of the `Mux-Signature` header,
   *   e.g. "t=1565220904,v1=20c75c1180c701ee..."
   * Noop: any string (a test HMAC over rawBody with the test webhook secret).
   */
  signatureHeader: string;
}

export interface TranscodeEvent {
  /**
   * The provider's internal asset/video identifier. The backend uses this to
   * look up the `videos` row (by `provider_asset_id`) and update its status.
   * MUST NOT be forwarded to the client.
   */
  providerAssetId: string;

  /**
   * Normalised transcode status. Maps the provider's status string to one of
   * the three DB values: processing | ready | errored.
   *
   * Cloudflare Stream: `readyToStream` → "ready", `state === "error"` → "errored",
   *   else → "processing".
   * Mux: `video.asset.ready` → "ready", `video.asset.errored` → "errored",
   *   else → "processing".
   */
  status: "processing" | "ready" | "errored";

  /**
   * Video duration in seconds, if available. Null while processing or if the
   * provider did not include it in the webhook payload.
   */
  durationS?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional: upload/registration seam (CRM / faculty upload flow — P3+)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateUploadTargetInput {
  /**
   * Maximum allowed upload size in bytes. Provider may enforce or ignore.
   */
  maxSizeBytes?: number;
  /**
   * Arbitrary metadata to attach to the asset at the provider (not PII).
   */
  metadata?: Record<string, string>;
}

export interface CreateUploadTargetResult {
  /**
   * The provider-specific upload URL (e.g. Cloudflare Stream's one-time upload URL).
   * The client POSTs the video file to this URL — it is short-lived and single-use.
   * NEVER store or log this URL after returning it; it contains upload credentials.
   */
  uploadUrl: string;

  /**
   * The provider's asset id that will be assigned to the uploaded video. Store
   * this in `videos.provider_asset_id` BEFORE the upload completes so the
   * transcode webhook can match it.
   */
  providerAssetId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider interface
// ─────────────────────────────────────────────────────────────────────────────

export interface VideoProvider {
  /**
   * Mints a SHORT-LIVED SIGNED HLS manifest URL scoped to (userId, lessonId).
   *
   * This is the core of the video streaming security model:
   *   - The returned URL is the ONLY way a client can initiate HLS playback.
   *   - It is signed using the provider's signing key (RS256 JWT).
   *   - It expires in ttlSeconds (default ≤ 300 s).
   *   - The signature embeds userId + lessonId so the provider CDN can enforce
   *     per-user scoping at the CDN level (though the backend enrollment-gate
   *     is the primary security control — this is defence-in-depth).
   *   - NO raw manifest URL, NO unsigned CDN link ever leaves this method.
   *
   * The LMS service (Wave-4) MUST:
   *   1. Verify active enrollment before calling this method (enrollment-scope).
   *   2. Check RBAC (`videos.stream`, scope=own) before calling this method.
   *   3. Write an audit-log row after a successful mint.
   *   4. Never cache the returned URL — re-mint on expiry.
   *   5. Never log the returned URL value (it is a credential).
   *   6. Return 503 if this method throws (fail-closed, never return a raw URL).
   *
   * FAIL CLOSED: if signing keys are not configured, this MUST throw (not return
   * a raw/unsigned fallback). The backend catches the throw and returns 503.
   */
  mintSignedHlsUrl(input: MintSignedHlsUrlInput): Promise<MintSignedHlsUrlResult>;

  /**
   * Verifies the HMAC signature of an inbound transcode status webhook.
   *
   * SECURITY — FAIL CLOSED: if the webhook secret is not configured, this method
   * MUST return false (never true). The implementation logs a warning:
   * "VideoProvider: webhook secret not configured — webhook rejected (fail closed)".
   *
   * MUST use constant-time comparison (node:crypto timingSafeEqual) to prevent
   * timing-based secret oracle attacks.
   *
   * Provider-specific signature verification:
   *   Cloudflare Stream — Webhook-Signature: time=<ts>,sig1=<hex>
   *     source_string = `${time}.${rawBody}`
   *     expected = HMAC-SHA256(source_string, CLOUDFLARE_STREAM_WEBHOOK_SECRET)
   *     compare hex against sig1
   *   Mux — Mux-Signature: t=<ts>,v1=<hex>
   *     source_string = `${ts}.${rawBody}`
   *     expected = HMAC-SHA256(source_string, MUX_WEBHOOK_SECRET)
   *     compare hex against v1
   *   Noop — HMAC-SHA256(rawBody, test_webhook_secret) for test determinism.
   *
   * See the RAW-BODY NOTE in VerifyWebhookSignatureInput for the NestJS wiring.
   */
  verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean;

  /**
   * Parses a provider-specific transcode status webhook payload into a normalised
   * TranscodeEvent. Called after verifyWebhookSignature returns true.
   *
   * The backend (Wave-4, VideoWebhookProcessorPort) uses the result to update
   * `videos.status` (processing → ready | errored) and `videos.duration_s`.
   *
   * Cloudflare Stream event shape (simplified):
   *   { uid: string; readyToStream: boolean; state: string; duration: number }
   *
   * Mux event shape (simplified):
   *   { type: "video.asset.ready" | "video.asset.errored"; object: { id: string };
   *     data: { duration: number } }
   *
   * Returns null if the payload does not represent a transcode event (e.g. an
   * unrelated event type). The backend should skip null results idempotently.
   *
   * MUST NOT throw on unexpected payload shapes — parse defensively.
   */
  parseTranscodeEvent(payload: Record<string, unknown>): TranscodeEvent | null;

  /**
   * Creates a provider-side upload target (a one-time upload URL + the future
   * provider asset id). Used by the CRM / faculty upload flow.
   *
   * This is OPTIONAL in P3 (the upload UI is a later wave). Implementations
   * MUST either implement it properly or throw with a clear "not implemented"
   * message. The interface defines it now so the LMS module can call it without
   * a breaking change when the CRM upload UI lands.
   *
   * FAIL CLOSED: if API credentials are not configured, throw at call time
   * (the same lazy-validation pattern as mintSignedHlsUrl).
   */
  createUploadTarget(input: CreateUploadTargetInput): Promise<CreateUploadTargetResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DI token
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NestJS DI injection token for the VideoProvider.
 *
 * LMS services import and inject this token — NEVER import
 * CloudflareStreamVideoProvider, MuxVideoProvider, or any other concrete class
 * from a feature module.
 *
 * The VideoProviderModule binds this token to the adapter selected by the
 * VIDEO_PROVIDER env variable (see video-provider.module.ts).
 *
 * Usage in Wave-4 LmsModule:
 *
 *   // lms.module.ts
 *   import { VideoProviderModule } from './providers/video/video-provider.module';
 *
 *   @Module({
 *     imports: [VideoProviderModule, ...],
 *     providers: [LmsService, LmsRepository, ...],
 *     controllers: [LmsController],
 *   })
 *   export class LmsModule {}
 *
 *   // lms.service.ts (stream-url endpoint handler)
 *   import { Inject } from '@nestjs/common';
 *   import { VIDEO_PROVIDER, VideoProvider } from './providers/video/video-provider.interface';
 *
 *   @Injectable()
 *   export class LmsService {
 *     constructor(
 *       @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
 *       ...
 *     ) {}
 *
 *     async mintStreamUrl(
 *       userId: string,
 *       lessonId: string,
 *       enrollment: Enrollment,  // already verified by resolveEnrollmentForLesson()
 *     ): Promise<StreamUrlResponse> {
 *       // ENROLLMENT + RBAC check MUST happen BEFORE calling mintSignedHlsUrl.
 *       // resolveEnrollmentForLesson() throws 403 if not enrolled.
 *       // This method is only reached for verified enrolled students (or preview lessons).
 *
 *       const video = await this.lmsRepository.getVideoForLesson(lessonId);
 *       if (!video || video.status !== 'ready') {
 *         throw new ServiceUnavailableException('Video not ready for streaming');
 *       }
 *
 *       // Mint the signed HLS URL — fail-closed if unconfigured (throws → 503).
 *       const result = await this.videoProvider.mintSignedHlsUrl({
 *         assetId: video.providerAssetId,
 *         userId,
 *         lessonId,
 *         ttlSeconds: HLS_TTL_SECONDS, // server constant, e.g. 300
 *       });
 *
 *       // Audit the mint (every stream-url access is auditable).
 *       await this.auditService.log({
 *         action: 'video.stream_url.mint',
 *         resourceType: 'Lesson',
 *         resourceId: lessonId,
 *         actorId: userId,
 *       });
 *
 *       return {
 *         url: result.url,
 *         expiresAt: result.expiresAt.toISOString(),
 *         provider: result.provider,
 *         watermark: {
 *           text: `${student.name} · ${student.studentCode}`,
 *           studentId: userId,
 *         },
 *       };
 *     }
 *   }
 *
 * Test wiring (unit tests — bind the Noop provider):
 *
 *   const noopVideo = new NoopVideoProvider();
 *   const module = await Test.createTestingModule({
 *     providers: [
 *       LmsService,
 *       { provide: VIDEO_PROVIDER, useValue: noopVideo },
 *       // ...other deps...
 *     ],
 *   }).compile();
 */
export const VIDEO_PROVIDER = Symbol("VIDEO_PROVIDER");

/**
 * Default TTL (seconds) for signed HLS URLs when no ttlSeconds is provided.
 * 300 s = 5 minutes — satisfies the "≤ 5 min" requirement in docs/02 §21 and
 * docs/plans/phase-3.md §Risks #2.
 */
export const DEFAULT_HLS_TTL_SECONDS = 300;
