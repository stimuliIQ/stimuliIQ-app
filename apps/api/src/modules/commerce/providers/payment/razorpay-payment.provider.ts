// apps/api/src/modules/commerce/providers/payment/razorpay-payment.provider.ts
//
// Razorpay implementation of PaymentProvider (docs/04-trd-architecture.md §2.10,
// docs/plans/phase-2.md task #4). Bound to the PAYMENT_PROVIDER DI token in
// PaymentProviderModule — feature modules NEVER import this class directly.
//
// Design decisions (docs/plans/phase-2.md task #4 instruction):
//   - NO new npm dependencies. All Razorpay API calls use Node's built-in `fetch`
//     with HTTP Basic auth (key_id:key_secret). All signature/webhook verification
//     uses Node's built-in `crypto` (createHmac + timingSafeEqual). This avoids
//     adding the `razorpay` npm SDK and its transitive dependencies.
//   - createOrder → POST https://api.razorpay.com/v1/orders
//   - refund      → POST https://api.razorpay.com/v1/payments/:id/refund
//   - fetchPayment→ GET  https://api.razorpay.com/v1/payments/:id
//   - verifyPaymentSignature: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
//   - verifyWebhookSignature: HMAC-SHA256(rawBody, WEBHOOK_SECRET); FAIL CLOSED if
//     WEBHOOK_SECRET is absent (never returns true on unconfigured secret).
//
// Security invariants:
//   - KEY_SECRET and WEBHOOK_SECRET are consumed only inside this file.
//   - They are never logged, never returned from any method, never included in any
//     error message or thrown string.
//   - KEY_ID (public) is exposed through createOrder result → CreateRazorpayOrderResponse
//     which is safe per payments.schemas.ts design note.
//   - All signature comparisons use crypto.timingSafeEqual (constant-time).

import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  PaymentProvider,
  CreateOrderInput,
  CreateOrderResult,
  VerifyPaymentSignatureInput,
  VerifyWebhookSignatureInput,
  RefundInput,
  RefundResult,
  FetchPaymentResult,
} from "./payment-provider.interface";
import { validateEnv } from "../../../../config/env";

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay REST API response shapes (internal, not exported)
// ─────────────────────────────────────────────────────────────────────────────

interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

interface RazorpayRefundResponse {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
}

interface RazorpayPaymentResponse {
  id: string;
  amount: number;
  status: string;
  method?: string;
}

interface RazorpayErrorResponse {
  error?: {
    code?: string;
    description?: string;
    source?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider implementation
// ─────────────────────────────────────────────────────────────────────────────

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

@Injectable()
export class RazorpayPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(RazorpayPaymentProvider.name);

  // Resolved once from the zod-validated env at construction time.
  // KEY_SECRET and WEBHOOK_SECRET stored as private readonly — never returned.
  // All three may be undefined: the app must BOOT without payment config (dev,
  // Phase-0, integration tests of unrelated modules), so we do NOT throw at
  // construction — we warn, and validate LAZILY when a payment operation that
  // actually needs a key is invoked (see requireKeys()). Signature/webhook
  // verification without a secret FAILS CLOSED (returns false), never accepts.
  private readonly keyId: string | undefined;
  private readonly keySecret: string | undefined;
  private readonly webhookSecret: string | undefined;

  constructor() {
    const env = validateEnv();
    this.keyId = env.RAZORPAY_KEY_ID;
    this.keySecret = env.RAZORPAY_KEY_SECRET;
    // WEBHOOK_SECRET is optional in the schema (not yet provided by the user at P2 start).
    // When absent, verifyWebhookSignature FAILS CLOSED per the interface contract.
    this.webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;

    if (!this.keyId || !this.keySecret) {
      this.logger.warn(
        "[RazorpayPaymentProvider] RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured. " +
          "Payment operations (createOrder/refund/verify) will fail until these are set " +
          "in .env (see .env.example). App boot continues.",
      );
    }
    if (!this.webhookSecret) {
      this.logger.warn(
        "[RazorpayPaymentProvider] RAZORPAY_WEBHOOK_SECRET is not configured. " +
          "Webhook signature verification will FAIL CLOSED — all incoming webhooks " +
          "will be rejected until this secret is set. Set it via the Razorpay dashboard " +
          "and add it to .env (see .env.example).",
      );
    }
  }

  /**
   * Lazily assert the Razorpay API keys are present before an operation that
   * cannot proceed without them (createOrder / refund / fetchPayment). Throws a
   * clear config error at CALL time rather than at boot, so the app runs in envs
   * without payment configured.
   */
  private requireKeys(): { keyId: string; keySecret: string } {
    if (!this.keyId || !this.keySecret) {
      throw new Error(
        "[RazorpayPaymentProvider] RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured — " +
          "cannot perform this payment operation. Add them to .env (see .env.example).",
      );
    }
    return { keyId: this.keyId, keySecret: this.keySecret };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // createOrder
  // ───────────────────────────────────────────────────────────────────────────

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const { amountPaise, currency, receipt, notes } = input;

    // Receipt max 40 chars per Razorpay API. Truncate rather than throw — the
    // internal order id (UUID, 36 chars) fits well within this limit.
    const safeReceipt = receipt.slice(0, 40);

    const body: Record<string, unknown> = {
      amount: amountPaise, // Razorpay expects amount in smallest currency unit (paise for INR)
      currency,
      receipt: safeReceipt,
    };
    if (notes && Object.keys(notes).length > 0) {
      body["notes"] = notes;
    }

    const response = await this.razorpayFetch<RazorpayOrderResponse>(
      "POST",
      "/orders",
      body,
    );

    return {
      providerOrderId: response.id,
      amountPaise: response.amount,
      currency: response.currency,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // verifyPaymentSignature (sync, no network)
  // ───────────────────────────────────────────────────────────────────────────

  verifyPaymentSignature(input: VerifyPaymentSignatureInput): boolean {
    const { providerOrderId, providerPaymentId, signature } = input;

    // FAIL CLOSED: without KEY_SECRET we cannot verify — reject rather than accept.
    if (!this.keySecret) {
      this.logger.warn(
        "[RazorpayPaymentProvider] verifyPaymentSignature called but " +
          "RAZORPAY_KEY_SECRET is not configured — rejecting (fail closed).",
      );
      return false;
    }

    // Razorpay checkout signature: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
    const message = `${providerOrderId}|${providerPaymentId}`;
    const expectedHex = createHmac("sha256", this.keySecret)
      .update(message, "utf8")
      .digest("hex");

    // Constant-time comparison — prevents timing attacks that could infer the secret.
    return timingSafeEqualStrings(expectedHex, signature);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // verifyWebhookSignature (sync, no network) — FAIL CLOSED
  // ───────────────────────────────────────────────────────────────────────────

  verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
    // FAIL CLOSED: if the webhook secret is not configured, reject ALL webhooks.
    // This is the safe default — accepting unverified webhooks would allow anyone
    // to forge payment events.
    if (!this.webhookSecret) {
      this.logger.warn(
        "[RazorpayPaymentProvider] verifyWebhookSignature called but " +
          "RAZORPAY_WEBHOOK_SECRET is not configured — rejecting webhook (fail closed).",
      );
      return false;
    }

    const { rawBody, signature } = input;

    // Razorpay webhook signature: HMAC-SHA256(rawBody, WEBHOOK_SECRET)
    // rawBody MUST be the original bytes from the request — do NOT pass the parsed JSON.
    // If rawBody is a Buffer, pass it directly to update(). If it's a string (e.g. from
    // JSON.stringify), it must be the exact original bytes as a UTF-8 string.
    const expectedHex = createHmac("sha256", this.webhookSecret)
      .update(rawBody)
      .digest("hex");

    return timingSafeEqualStrings(expectedHex, signature);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // refund
  // ───────────────────────────────────────────────────────────────────────────

  async refund(input: RefundInput): Promise<RefundResult> {
    const { providerPaymentId, amountPaise, notes, idempotencyKey } = input;

    const body: Record<string, unknown> = {};
    if (amountPaise !== undefined) {
      body["amount"] = amountPaise;
    }
    if (notes && Object.keys(notes).length > 0) {
      body["notes"] = notes;
    }

    const extraHeaders: Record<string, string> = {};
    if (idempotencyKey) {
      // Razorpay supports idempotency via X-Razorpay-Idempotency-Key header
      extraHeaders["X-Razorpay-Idempotency-Key"] = idempotencyKey;
    }

    const response = await this.razorpayFetch<RazorpayRefundResponse>(
      "POST",
      `/payments/${encodeURIComponent(providerPaymentId)}/refund`,
      body,
      extraHeaders,
    );

    return {
      providerRefundId: response.id,
      status: response.status,
      amountPaise: response.amount,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // fetchPayment
  // ───────────────────────────────────────────────────────────────────────────

  async fetchPayment(providerPaymentId: string): Promise<FetchPaymentResult> {
    const response = await this.razorpayFetch<RazorpayPaymentResponse>(
      "GET",
      `/payments/${encodeURIComponent(providerPaymentId)}`,
    );

    return {
      status: response.status,
      amountPaise: response.amount,
      method: response.method,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: authenticated Razorpay REST fetch
  // ───────────────────────────────────────────────────────────────────────────

  private async razorpayFetch<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    // Basic auth: key_id:key_secret — NEVER log the auth header.
    // requireKeys() throws a clear config error if keys are absent (lazy validation).
    const { keyId, keySecret } = this.requireKeys();
    const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const headers: Record<string, string> = {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extraHeaders,
    };

    const init: RequestInit = {
      method,
      headers,
    };
    if (body !== undefined && method === "POST") {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(`${RAZORPAY_API_BASE}${path}`, init);
    } catch (networkErr) {
      // Network-level failure (DNS, timeout, etc.) — log without exposing secrets.
      this.logger.error(
        `[RazorpayPaymentProvider] Network error on ${method} ${path}: ${String(networkErr)}`,
      );
      throw new Error(
        `[RazorpayPaymentProvider] Network error calling Razorpay (${method} ${path}). ` +
          "Check connectivity and retry.",
      );
    }

    if (!response.ok) {
      // Parse error body for logging — but sanitize: do NOT log the Authorization header.
      let errText = "";
      try {
        const errJson = (await response.json()) as RazorpayErrorResponse;
        // Include only the provider's error description, never our own credentials.
        errText = errJson.error?.description ?? response.statusText;
      } catch {
        errText = response.statusText;
      }

      this.logger.error(
        `[RazorpayPaymentProvider] API error on ${method} ${path}: ` +
          `HTTP ${response.status} — ${errText}`,
      );

      throw new Error(
        `[RazorpayPaymentProvider] Razorpay API returned HTTP ${response.status}: ${errText}`,
      );
    }

    return response.json() as Promise<T>;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constant-time hex string comparison using crypto.timingSafeEqual.
 *
 * timingSafeEqual requires both Buffers to be the same length. If they differ
 * in length the operation itself would be a timing leak (the check could short-
 * circuit before the comparison). We pad by always comparing as Buffers of the
 * same byte length — if lengths differ we still return false, but only after
 * the constant-time comparison of the full expected string to itself, preventing
 * length-based timing leaks.
 *
 * This function is exported for testability.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  // Encode both as UTF-8 buffers for timingSafeEqual.
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");

  if (aBuf.length !== bBuf.length) {
    // Lengths differ — definitely not equal. We still run a constant-time
    // compare on the expected value against itself to avoid leaking the length
    // of the expected digest through early returns.
    timingSafeEqual(aBuf, aBuf); // no-op result; ensures CPU time is constant
    return false;
  }

  return timingSafeEqual(aBuf, bBuf);
}
