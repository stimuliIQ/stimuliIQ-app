"use client";

/**
 * EnrollOrderStep — Step 1 of the enrollment funnel.
 *
 * Shows the program price (server-derived), optional coupon code input,
 * and optional EMI selector.
 *
 * Security (AC-21):
 *   - NO client-side math. All amounts come from the server.
 *   - The coupon discount is shown from what the server returned.
 *   - Order amount = server-derived paise from the order response.
 */

import { useId, useState } from "react";
import type { OrderFormData } from "../../../../hooks/use-enroll-funnel";
import type { PublicOrderResponse } from "@repo/types";

interface EnrollOrderStepProps {
  data: OrderFormData;
  onChange: (data: Partial<OrderFormData>) => void;
  errors: Record<string, string>;
  programTitle: string;
  pricePaise: number;
  order: PublicOrderResponse | null;
  globalError?: string;
}

function formatPaise(paise: number): string {
  const rupees = Math.floor(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

export function EnrollOrderStep({
  data,
  onChange,
  errors,
  programTitle,
  pricePaise,
  order,
  globalError,
}: EnrollOrderStepProps) {
  const couponId = useId();
  const [couponInputValue, setCouponInputValue] = useState(data.couponCode ?? "");

  return (
    <div className="flex flex-col gap-4" data-testid="enroll-order-step">
      <p className="text-sm text-fg-muted">
        Review your order before proceeding to payment. Amounts are finalized by the server.
      </p>

      {/* Global error */}
      {globalError ? (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          data-testid="order-global-error"
        >
          {globalError}
        </div>
      ) : null}

      {/* Program summary */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="font-semibold text-fg text-sm">Program</h3>
        <p className="mt-1 text-fg-muted text-sm">{programTitle}</p>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-xl font-bold text-fg">
            {order ? formatPaise(order.amountPaise) : formatPaise(pricePaise)}
          </span>
          {order && order.discountPaise > 0 ? (
            <>
              <span className="text-sm text-fg-muted line-through">
                {formatPaise(pricePaise)}
              </span>
              <span className="text-xs text-success font-medium">
                Save {formatPaise(order.discountPaise)}!
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* Coupon code */}
      <div>
        <label htmlFor={couponId} className="mb-1.5 block text-sm font-medium text-fg">
          Coupon code
          <span className="ml-1 text-fg-subtle text-xs">(optional)</span>
        </label>
        <div className="flex gap-2">
          <input
            id={couponId}
            type="text"
            value={couponInputValue}
            onChange={(e) => setCouponInputValue(e.target.value.toUpperCase())}
            aria-invalid={!!errors.couponCode}
            aria-describedby={errors.couponCode ? `${couponId}-error` : undefined}
            className={[
              "h-11 flex-1 rounded-md border border-border bg-card px-3 text-sm text-fg placeholder:text-fg-subtle",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              errors.couponCode ? "border-danger" : "",
            ].join(" ")}
            placeholder="Enter coupon code"
            data-testid="order-coupon-input"
          />
          <button
            type="button"
            onClick={() => {
              onChange({ couponCode: couponInputValue.trim() || undefined });
            }}
            className="flex min-h-[44px] items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="order-coupon-apply"
          >
            Apply
          </button>
        </div>
        {errors.couponCode ? (
          <p id={`${couponId}-error`} role="alert" className="mt-1.5 text-xs text-danger">
            {errors.couponCode}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-fg-subtle">
          Coupon discounts are computed by the server and reflected in the total above.
        </p>
      </div>

      {/* Order created info */}
      {order ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
          data-testid="order-created"
        >
          Order created. You will be charged{" "}
          <strong>{formatPaise(order.amountPaise)}</strong> {order.currency}.
          Proceeding to payment…
        </div>
      ) : null}

      <p className="text-xs text-fg-subtle">
        Payment is processed securely by Razorpay. Stimuli IQ does not store your
        card details.
      </p>
    </div>
  );
}
