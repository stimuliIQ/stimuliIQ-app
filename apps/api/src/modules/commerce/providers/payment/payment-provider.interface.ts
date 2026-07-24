// apps/api/src/modules/commerce/providers/payment/payment-provider.interface.ts
//
// Vendor-swappable payment interface (CLAUDE.md §3.7: "all external calls go through a
// provider interface — never call a vendor SDK directly from a feature module").
//
// Commerce services depend ONLY on this interface via the PAYMENT_PROVIDER DI token.
// The default Phase-2 implementation is RazorpayPaymentProvider (see
// razorpay-payment.provider.ts). Swapping to Stripe, PayU, or any other gateway later
// means implementing this interface and rebinding the DI token — the CommerceService
// is unaffected.
//
// Reference: docs/04-trd-architecture.md §2.10 (provider table: PaymentProvider →
// default Razorpay, swap Stripe/PayU) + docs/plans/phase-2.md task #4 DoD.
//
// Money convention: ALL amounts are in INTEGER PAISE (CLAUDE.md §3.6).
// Secrets: RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET must NEVER appear in
// any return value, log line, or error message from this interface or its impls.
// RAZORPAY_KEY_ID (the public key) MAY appear in return values — it is sent to the
// checkout client (payments.schemas.ts: CreateRazorpayOrderResponse.keyId).

// ─────────────────────────────────────────────────────────────────────────────
// Input / output shapes (provider-layer, not HTTP DTOs)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  /** Net amount to charge, in INTEGER PAISE. Must be > 0. */
  amountPaise: number;
  /** ISO-4217 currency code (e.g. "INR"). */
  currency: string;
  /** Short receipt reference (max 40 chars per Razorpay). */
  receipt: string;
  /**
   * Arbitrary key/value notes stored on the provider order.
   * Values are strings. DO NOT include secrets or PII beyond correlation IDs.
   */
  notes?: Record<string, string>;
}

export interface CreateOrderResult {
  /** Provider-assigned order identifier (e.g. Razorpay "order_id"). */
  providerOrderId: string;
  /** Net amount confirmed by the provider, in INTEGER PAISE. */
  amountPaise: number;
  /** Currency echoed back by the provider. */
  currency: string;
}

export interface VerifyPaymentSignatureInput {
  /**
   * The provider order id (razorpay_order_id from checkout handler response).
   * Combined with providerPaymentId to recompute the expected HMAC.
   */
  providerOrderId: string;
  /**
   * The provider payment id (razorpay_payment_id from checkout handler response).
   */
  providerPaymentId: string;
  /**
   * The HMAC-SHA256 signature sent by the Razorpay checkout JS (razorpay_signature).
   * Computed by Razorpay as: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET).
   */
  signature: string;
}

export interface VerifyWebhookSignatureInput {
  /**
   * The raw HTTP request body — MUST be the original bytes, NOT the parsed JSON.
   * The commerce controller MUST use a raw-body parser for the webhook route so
   * that this arrives as Buffer or the original string. See backend-builder note in
   * the PaymentProviderModule for the NestJS/Express raw-body wiring.
   */
  rawBody: string | Buffer;
  /**
   * Value of the X-Razorpay-Signature request header.
   */
  signature: string;
}

export interface RefundInput {
  /** The provider-assigned payment id (razorpay_payment_id) to refund. */
  providerPaymentId: string;
  /**
   * Refund amount in INTEGER PAISE. If omitted, the provider issues a full refund
   * for the captured amount of that payment.
   */
  amountPaise?: number;
  /** Key/value notes to attach to the refund at the provider. */
  notes?: Record<string, string>;
  /**
   * Idempotency key forwarded to the provider to prevent duplicate refunds on retry.
   * Must be unique per refund attempt. Callers should derive this from the refund row id.
   */
  idempotencyKey?: string;
}

export interface RefundResult {
  /** Provider-assigned refund identifier. */
  providerRefundId: string;
  /** Refund status string as returned by the provider (e.g. "processed"). */
  status: string;
  /** Refunded amount confirmed by the provider, in INTEGER PAISE. */
  amountPaise: number;
}

export interface FetchPaymentResult {
  /** Provider payment status string (e.g. "captured", "failed"). */
  status: string;
  /** Authorized/captured amount reported by the provider, in INTEGER PAISE. */
  amountPaise: number;
  /**
   * Payment method string as reported by the provider
   * (e.g. "upi", "card", "netbanking"). Optional — not all providers expose this.
   */
  method?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider interface
// ─────────────────────────────────────────────────────────────────────────────

export interface PaymentProvider {
  /**
   * Creates a payment order at the provider and returns the provider's order id.
   *
   * The commerce service calls this when the student initiates checkout. The
   * returned `providerOrderId` is forwarded to the client so it can open the
   * provider's hosted checkout JS (e.g. Razorpay's checkout.js).
   *
   * Idempotency note: callers should pass a stable `receipt` derived from the
   * internal order id so that replayed calls are idempotent at the provider level.
   */
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;

  /**
   * Verifies the HMAC-SHA256 payment signature from the checkout callback.
   *
   * Razorpay's checkout JS calls the `handler` function with three fields
   * (razorpay_order_id, razorpay_payment_id, razorpay_signature). The commerce
   * service must call this method BEFORE marking any payment as captured.
   *
   * Implementation requirements:
   *   - HMAC-SHA256(providerOrderId + "|" + providerPaymentId, RAZORPAY_KEY_SECRET)
   *   - Constant-time comparison via crypto.timingSafeEqual (no timing attacks)
   *   - Returns false (not throw) on mismatch — the service decides the HTTP status
   *
   * This is synchronous and pure — it requires no network call.
   */
  verifyPaymentSignature(input: VerifyPaymentSignatureInput): boolean;

  /**
   * Verifies the HMAC-SHA256 signature of an inbound webhook from the provider.
   *
   * SECURITY — FAIL CLOSED: if RAZORPAY_WEBHOOK_SECRET is not configured, this
   * method MUST return false (never true). The implementation logs a warning:
   * "PaymentProvider: RAZORPAY_WEBHOOK_SECRET not configured — webhook rejected".
   *
   * Raw body requirement (for backend-builder): the commerce webhook controller
   * MUST read the request body as raw bytes BEFORE any JSON parsing. In NestJS
   * with the default Express adapter, apply the `rawBody: true` option to the
   * NestFactory.create() call AND use a custom Body extractor on the webhook route:
   *
   *   // In main.ts:
   *   const app = await NestFactory.create(AppModule, { rawBody: true });
   *
   *   // In the webhook controller method:
   *   @Post('webhook')
   *   async handleWebhook(
   *     @Req() req: RawBodyRequest<Request>,
   *     @Headers('x-razorpay-signature') sig: string,
   *   ) {
   *     const rawBody = req.rawBody; // Buffer, thanks to rawBody: true
   *     const verified = this.paymentProvider.verifyWebhookSignature({ rawBody, signature: sig });
   *     ...
   *   }
   *
   * See: https://docs.nestjs.com/faq/raw-body
   *
   * Implementation requirements:
   *   - HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)
   *   - Constant-time comparison via crypto.timingSafeEqual
   *   - Returns false (not throw) on mismatch or missing secret
   */
  verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean;

  /**
   * Initiates a refund (full or partial) for a captured payment.
   *
   * Called by the commerce service after a refund request has been approved
   * (via the approval workflow). The idempotencyKey prevents duplicate provider
   * refund calls on network retry — callers MUST supply a stable key (e.g. derived
   * from the refund row id in the DB).
   */
  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * Fetches the current payment status from the provider.
   *
   * Used for reconciliation and manual payment verification flows. Optional in
   * the sense that the commerce service can function without it, but providers
   * should implement it for correctness.
   */
  fetchPayment(providerPaymentId: string): Promise<FetchPaymentResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DI token
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NestJS DI injection token for the PaymentProvider.
 *
 * Commerce services import and inject this token — NEVER import
 * RazorpayPaymentProvider or any other concrete class from a feature module.
 *
 * Usage in Wave-4 CommerceModule:
 *
 *   // commerce.module.ts
 *   import { PAYMENT_PROVIDER } from './providers/payment/payment-provider.interface';
 *   import { RazorpayPaymentProvider } from './providers/payment/razorpay-payment.provider';
 *
 *   @Module({
 *     imports: [PaymentProviderModule],
 *     providers: [CommerceService, CommerceRepository, ...],
 *     controllers: [CommerceController],
 *   })
 *   export class CommerceModule {}
 *
 *   // commerce.service.ts
 *   constructor(
 *     @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
 *     ...
 *   ) {}
 */
export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");
