"use client";

/**
 * EnrollPaymentStep — Step 2 of the enrollment funnel.
 *
 * Shows the checkout summary and a "Pay Now" button that opens Razorpay.
 *
 * Security (AC-18, AC-19, AC-21, AC-41):
 *   - Pay button disabled while in-flight (double-click-safe).
 *   - Amount shown is from the server-derived order response (no client math).
 *   - Razorpay checkout.js loaded dynamically by useEnrollFunnel.
 *   - keyId in checkout is the PUBLIC Razorpay key only.
 *   - On payment failure: shows retry path with the SAME idempotency key.
 */

import type { PublicOrderResponse, PublicCheckoutResponse } from "@repo/types";

interface EnrollPaymentStepProps {
  order: PublicOrderResponse;
  checkout: PublicCheckoutResponse;
  programTitle: string;
  isLoading: boolean;
  funnelError?: string;
  paymentFailed?: string;
  onPay: () => Promise<void>;
  onRetry: () => Promise<void>;
}

function formatPaise(paise: number): string {
  const rupees = Math.floor(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

export function EnrollPaymentStep({
  order,
  checkout,
  programTitle,
  isLoading,
  funnelError,
  paymentFailed,
  onPay,
  onRetry,
}: EnrollPaymentStepProps) {
  return (
    <div className="flex flex-col gap-6" data-testid="enroll-payment-step">
      {/* Order summary */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="font-semibold text-fg text-sm mb-2">Order Summary</h3>
        <p className="text-sm text-fg-muted">{programTitle}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-fg-muted">Amount due</span>
          <span className="text-xl font-bold text-fg" data-testid="payment-amount">
            {formatPaise(order.amountPaise)} {order.currency}
          </span>
        </div>
        {order.discountPaise > 0 ? (
          <p className="mt-1 text-xs text-success">
            Includes coupon discount of {formatPaise(order.discountPaise)}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-fg-subtle">
          Order ID: <code className="font-mono">{checkout.orderId}</code>
        </p>
      </div>

      {/* Error states */}
      {funnelError ? (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          data-testid="payment-error"
        >
          {funnelError}
        </div>
      ) : null}

      {/* Payment failed — retry path (AC-19) */}
      {paymentFailed ? (
        <div className="flex flex-col gap-3 rounded-md border border-warning/30 bg-warning/10 p-4">
          <p role="alert" className="text-sm text-warning-fg font-medium">
            {paymentFailed}
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={isLoading}
            aria-busy={isLoading}
            className="flex min-h-[44px] w-full items-center justify-center rounded-md border border-brand-500 px-6 text-sm font-semibold text-brand-500 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="retry-payment-btn"
          >
            {isLoading ? "Retrying…" : "Retry Payment"}
          </button>
          <p className="text-xs text-fg-subtle text-center">
            Retrying uses the same order, so you will not be double-charged.
          </p>
        </div>
      ) : null}

      {/* Pay Now button */}
      {!paymentFailed ? (
        <button
          type="button"
          onClick={onPay}
          disabled={isLoading}
          aria-busy={isLoading}
          aria-disabled={isLoading}
          className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-brand-500 px-6 text-base font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          data-testid="pay-now-btn"
        >
          {isLoading ? (
            <>
              <svg aria-hidden="true" className="mr-2 size-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Processing…
            </>
          ) : (
            `Pay ${formatPaise(order.amountPaise)}`
          )}
        </button>
      ) : null}

      <p className="text-xs text-center text-fg-subtle">
        Secured by Razorpay · UPI, Cards, Net Banking accepted ·
        Your card details are never stored by Stimuli IQ.
      </p>
    </div>
  );
}
