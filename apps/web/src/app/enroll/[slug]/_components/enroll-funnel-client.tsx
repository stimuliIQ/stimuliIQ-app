"use client";

/**
 * EnrollFunnelClient — client component that wires the enrollment funnel.
 *
 * Renders the correct step (register → order → payment → success) based on
 * useEnrollFunnel state. No business logic here — delegates to the hook.
 *
 * a11y (AC-39):
 *   - Heading receives programmatic focus on step change.
 *   - Screen-reader live region announces step name.
 *   - All interactive elements are keyboard-accessible.
 */

import { useEffect, useRef } from "react";
import { isCompleteLocalPhone } from "@repo/ui";
import { useEnrollFunnel } from "../../../../hooks/use-enroll-funnel";
import { EnrollRegisterStep } from "./enroll-register-step";
import { EnrollOrderStep } from "./enroll-order-step";
import { EnrollPaymentStep } from "./enroll-payment-step";
import { EnrollSuccessStep } from "./enroll-success-step";

interface EnrollFunnelClientProps {
  programId: string;
  programTitle: string;
  pricePaise: number;
  emiDisplay?: string;
  slug: string;
}

const STEP_LABELS: Record<string, string> = {
  register: "Step 1 of 3: Create Account",
  order: "Step 2 of 3: Review Order",
  payment: "Step 3 of 3: Payment",
  success: "Enrollment Complete",
};

export function EnrollFunnelClient({
  programId,
  programTitle,
  pricePaise,
  emiDisplay,
  slug: _slug,
}: EnrollFunnelClientProps) {
  const {
    step,
    funnelState,
    order,
    checkout,
    registerData,
    setRegisterData,
    orderData,
    setOrderData,
    registerErrors,
    orderErrors,
    submitRegister,
    requestOtp,
    submitOrder,
    submitPayment,
    retryPayment,
    resetFunnel,
  } = useEnrollFunnel(programId);

  // Focus management on step change (AC-39)
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevStepRef = useRef(step);

  useEffect(() => {
    if (prevStepRef.current !== step && headingRef.current) {
      headingRef.current.focus();
    }
    prevStepRef.current = step;
  }, [step]);

  const isLoading = funnelState.kind === "loading";
  const globalError =
    funnelState.kind === "error" ? funnelState.message : undefined;
  const paymentFailed =
    funnelState.kind === "payment_failed" ? funnelState.message : undefined;

  const stepLabel = STEP_LABELS[step] ?? step;

  // "Create Account & Continue" stays disabled until the register step has
  // everything RegisterStepSchema requires. Presentation only — submitRegister
  // re-validates and owns the inline field errors.
  const canCreateAccount =
    registerData.name.trim().length > 0 &&
    registerData.email.trim().length > 0 &&
    isCompleteLocalPhone(registerData.phone) &&
    /^\d{6}$/.test(registerData.otpCode) &&
    registerData.password.length > 0 &&
    registerData.tosAccepted &&
    registerData.captchaToken.length > 0;

  return (
    <div
      className="rounded-xl border border-border bg-card p-6 shadow-sm md:p-8"
      data-testid="enroll-funnel"
    >
      {/* SR step announcement */}
      <p
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {stepLabel}
      </p>

      {/* Step heading — receives focus on step change (AC-39) */}
      {step !== "success" ? (
        <div className="mb-6 flex items-center gap-4">
          {/* Step indicator */}
          <div aria-hidden="true" className="flex gap-2">
            {(["register", "order", "payment"] as const).map((s, i) => (
              <div
                key={s}
                className={[
                  "flex size-7 items-center justify-center rounded-full text-xs font-semibold",
                  step === s
                    ? "bg-brand-500 text-white"
                    : i < (["register", "order", "payment"] as const).indexOf(step)
                    ? "bg-brand-500 text-white"
                    : "border border-border bg-card text-fg-subtle",
                ].join(" ")}
              >
                {i + 1}
              </div>
            ))}
          </div>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold text-fg outline-none focus-visible:ring-0"
          >
            {stepLabel}
          </h2>
        </div>
      ) : null}

      {/* Loading overlay message */}
      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm text-fg-muted"
          data-testid="funnel-loading"
        >
          <svg aria-hidden="true" className="size-4 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          {funnelState.message}
        </div>
      ) : null}

      {/* Step content */}
      {step === "register" ? (
        <div className="flex flex-col gap-6">
          <EnrollRegisterStep
            data={registerData}
            onChange={setRegisterData}
            errors={registerErrors}
            onRequestOtp={requestOtp}
            isLoading={isLoading}
            globalError={globalError}
          />
          {!canCreateAccount && !isLoading ? (
            <p aria-live="polite" className="text-sm text-fg-muted" data-testid="register-blocked-hint">
              Fill in every field, verify your phone with the OTP, accept the terms, and complete
              the verification to continue.
            </p>
          ) : null}
          <button
            type="button"
            onClick={submitRegister}
            disabled={isLoading || !canCreateAccount}
            aria-busy={isLoading}
            aria-disabled={isLoading || !canCreateAccount}
            className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-brand-500 px-6 text-base font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            data-testid="register-submit-btn"
          >
            {isLoading ? "Creating account…" : "Create Account & Continue"}
          </button>
        </div>
      ) : null}

      {step === "order" ? (
        <div className="flex flex-col gap-6">
          <EnrollOrderStep
            data={orderData}
            onChange={setOrderData}
            errors={orderErrors}
            programTitle={programTitle}
            pricePaise={pricePaise}
            emiDisplay={emiDisplay}
            order={order}
            globalError={globalError}
          />
          <button
            type="button"
            onClick={submitOrder}
            disabled={isLoading}
            aria-busy={isLoading}
            className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-brand-500 px-6 text-base font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            data-testid="confirm-order-btn"
          >
            {isLoading ? "Creating order…" : "Confirm & Proceed to Payment"}
          </button>
        </div>
      ) : null}

      {step === "payment" && order && checkout ? (
        <EnrollPaymentStep
          order={order}
          checkout={checkout}
          programTitle={programTitle}
          isLoading={isLoading}
          funnelError={globalError}
          paymentFailed={paymentFailed}
          onPay={submitPayment}
          onRetry={retryPayment}
        />
      ) : null}

      {step === "success" && funnelState.kind === "success" ? (
        <EnrollSuccessStep result={funnelState.result} />
      ) : null}

      {/* Reset funnel (development / after error) */}
      {step !== "success" && globalError ? (
        <button
          type="button"
          onClick={resetFunnel}
          className="mt-4 block w-full text-center text-sm text-fg-subtle underline hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="reset-funnel-btn"
        >
          Start over
        </button>
      ) : null}
    </div>
  );
}

EnrollFunnelClient.displayName = "EnrollFunnelClient";
