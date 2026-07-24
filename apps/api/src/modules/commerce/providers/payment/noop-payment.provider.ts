// apps/api/src/modules/commerce/providers/payment/noop-payment.provider.ts
//
// Test / sandbox double for PaymentProvider. Used in unit tests and local dev
// environments where no real Razorpay credentials are present or desired.
//
// Behaviour:
//   - createOrder: returns a predictable fake provider order id without any
//     network call. The caller can pass any amountPaise/currency/receipt.
//   - verifyPaymentSignature: performs the real HMAC-SHA256 verification using
//     a configurable test secret (TEST_SIGNATURE_SECRET). This means test suites
//     can derive valid and invalid signatures deterministically.
//   - verifyWebhookSignature: same as above but using TEST_WEBHOOK_SECRET.
//   - refund: returns a predictable fake refund result.
//   - fetchPayment: returns a configurable canned response.
//
// Usage in tests (bind via the DI token):
//
//   const noopProvider = new NoopPaymentProvider();
//   // or with a custom test secret:
//   const noopProvider = new NoopPaymentProvider({ signatureSecret: 'my-test-key' });
//
// This class is NEVER bound in production — PaymentProviderModule binds
// RazorpayPaymentProvider for all non-test environments.

import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { timingSafeEqualStrings } from "./razorpay-payment.provider";
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

export interface NoopPaymentProviderOptions {
  /**
   * Secret used for HMAC-SHA256 in verifyPaymentSignature.
   * Defaults to "test-key-secret". Override per test suite for isolation.
   */
  signatureSecret?: string;
  /**
   * Secret used for HMAC-SHA256 in verifyWebhookSignature.
   * Defaults to "test-webhook-secret". If set to undefined, simulates the
   * "not configured" fail-closed behaviour.
   */
  webhookSecret?: string;
  /**
   * When true, simulates the RAZORPAY_WEBHOOK_SECRET being absent (not configured).
   * verifyWebhookSignature will return false (fail closed) regardless of input.
   * Default: false.
   */
  simulateWebhookSecretAbsent?: boolean;
}

const DEFAULT_SIGNATURE_SECRET = "test-key-secret";
const DEFAULT_WEBHOOK_SECRET = "test-webhook-secret";

@Injectable()
export class NoopPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(NoopPaymentProvider.name);
  private readonly signatureSecret: string;
  private readonly webhookSecret: string | undefined;
  private readonly simulateWebhookSecretAbsent: boolean;

  constructor(options: NoopPaymentProviderOptions = {}) {
    this.signatureSecret = options.signatureSecret ?? DEFAULT_SIGNATURE_SECRET;
    this.simulateWebhookSecretAbsent = options.simulateWebhookSecretAbsent ?? false;
    this.webhookSecret = this.simulateWebhookSecretAbsent
      ? undefined
      : (options.webhookSecret ?? DEFAULT_WEBHOOK_SECRET);

    this.logger.warn(
      "[NoopPaymentProvider] Running with the no-op/test payment provider. " +
        "No real charges will be made. Do NOT use this in production.",
    );
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const fakeOrderId = `order_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.logger.log(
      `[NoopPaymentProvider] createOrder: fake order ${fakeOrderId} for ${input.amountPaise} paise`,
    );
    return {
      providerOrderId: fakeOrderId,
      amountPaise: input.amountPaise,
      currency: input.currency,
    };
  }

  verifyPaymentSignature(input: VerifyPaymentSignatureInput): boolean {
    // Use real HMAC logic with the test secret so tests can derive valid/invalid sigs.
    const message = `${input.providerOrderId}|${input.providerPaymentId}`;
    const expectedHex = createHmac("sha256", this.signatureSecret)
      .update(message, "utf8")
      .digest("hex");
    return timingSafeEqualStrings(expectedHex, input.signature);
  }

  verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
    if (this.simulateWebhookSecretAbsent || !this.webhookSecret) {
      this.logger.warn(
        "[NoopPaymentProvider] verifyWebhookSignature: webhook secret absent — " +
          "returning false (fail closed).",
      );
      return false;
    }
    const expectedHex = createHmac("sha256", this.webhookSecret)
      .update(input.rawBody)
      .digest("hex");
    return timingSafeEqualStrings(expectedHex, input.signature);
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const fakeRefundId = `rfnd_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const amount = input.amountPaise ?? 0;
    this.logger.log(
      `[NoopPaymentProvider] refund: fake refund ${fakeRefundId} for ${amount} paise ` +
        `on payment ${input.providerPaymentId}`,
    );
    return {
      providerRefundId: fakeRefundId,
      status: "processed",
      amountPaise: amount,
    };
  }

  async fetchPayment(providerPaymentId: string): Promise<FetchPaymentResult> {
    this.logger.log(
      `[NoopPaymentProvider] fetchPayment: returning canned 'captured' status for ${providerPaymentId}`,
    );
    return {
      status: "captured",
      amountPaise: 0,
      method: "test",
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Test helpers — static methods for deriving HMAC values in test fixtures.
  // These do NOT belong on the interface; they are test-double utilities only.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Computes the expected HMAC-SHA256 payment signature for a given
   * orderId/paymentId pair using a test secret.
   *
   * Use this in test suites to build valid and invalid signature fixtures:
   *
   *   const validSig = NoopPaymentProvider.makePaymentSignature('order_1', 'pay_1');
   *   const badSig   = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
   */
  static makePaymentSignature(
    orderId: string,
    paymentId: string,
    secret: string = DEFAULT_SIGNATURE_SECRET,
  ): string {
    return createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`, "utf8")
      .digest("hex");
  }

  /**
   * Computes the expected HMAC-SHA256 webhook signature for a given raw body
   * using a test secret.
   *
   *   const rawBody = '{"event":"payment.captured","payload":{...}}';
   *   const validSig = NoopPaymentProvider.makeWebhookSignature(rawBody);
   */
  static makeWebhookSignature(
    rawBody: string | Buffer,
    secret: string = DEFAULT_WEBHOOK_SECRET,
  ): string {
    return createHmac("sha256", secret).update(rawBody).digest("hex");
  }
}
