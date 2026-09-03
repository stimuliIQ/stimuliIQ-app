"use client";

/**
 * CouponValidator — client component for the coupon field on the Pricing page.
 *
 * Calls POST /api/v1/public/coupons/validate via the public SDK.
 * Displays the discounted paise from the server (never does client-side math).
 *
 * Security (AC-21, AC-41):
 *   - Amount math is NEVER done on the client. We display what the server returns.
 *   - Captcha: TurnstileWidget (Task #8) wired in. The token is passed with every
 *     validate call. In dev (no NEXT_PUBLIC_TURNSTILE_SITE_KEY), TurnstileWidget
 *     fires onToken("noop") immediately — the Noop CaptchaProvider accepts it.
 *     In prod with a real site key, the widget fires the Turnstile token; if the
 *     token is invalid, the backend returns 422 (fail-closed, AC-44).
 *
 * Money rule: we receive paise from the API and render the display string.
 * No arithmetic on paise in this component.
 */

import { useState, useId } from "react";
import { apiClient } from "../../../lib/api-client";
import { TurnstileWidget } from "../../../components/captcha/turnstile-widget";
import { useCaptchaToken } from "../../../hooks/use-captcha-token";
import type { PublicCouponDiscountResponse } from "@repo/types";

interface CouponValidatorProps {
  programId: string;
}

type ValidationState =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "valid"; result: PublicCouponDiscountResponse }
  | { kind: "invalid"; message: string };

/** Render paise as ₹X,XXX (DISPLAY ONLY — no math) */
function renderPaise(paise: number): string {
  const rupees = Math.floor(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

export function CouponValidator({ programId }: CouponValidatorProps) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<ValidationState>({ kind: "idle" });
  const inputId = useId();
  const errorId = useId();
  const resultId = useId();

  // Turnstile captcha token (real token in prod, "noop" in dev — AC-44)
  const { token: captchaToken, setToken, resetToken } = useCaptchaToken();

  const validate = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setState({ kind: "validating" });

    try {
      // captchaToken from TurnstileWidget (real token in prod, "noop" in dev).
      // In prod, if the token is absent/invalid, the backend returns 422 (fail-closed, AC-44).
      const result = await apiClient.public.coupons.validate({
        code: trimmed,
        programId,
        captchaToken: captchaToken ?? "noop",
      });
      // Reset captcha after use so next validation gets a fresh token
      resetToken();
      setState({ kind: "valid", result });
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Invalid or expired coupon. Please check the code and try again.";
      setState({ kind: "invalid", message });
    }
  };

  const reset = () => {
    setCode("");
    setState({ kind: "idle" });
  };

  const isValidating = state.kind === "validating";
  const isValid = state.kind === "valid";
  const isInvalid = state.kind === "invalid";

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="coupon-validator"
      aria-label="Coupon code field"
    >
      <div className="flex gap-2">
        <div className="flex-1">
          <label
            htmlFor={inputId}
            className="mb-1 block text-sm font-medium text-fg"
          >
            Have a coupon code?
          </label>
          <input
            id={inputId}
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (state.kind !== "idle") setState({ kind: "idle" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") validate();
            }}
            placeholder="Enter coupon code"
            aria-describedby={
              isInvalid ? errorId : isValid ? resultId : undefined
            }
            aria-invalid={isInvalid}
            disabled={isValid}
            className={[
              "h-[44px] w-full rounded-md border px-3 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              "transition-colors disabled:bg-surface disabled:cursor-not-allowed",
              isInvalid ? "border-danger" : "border-border",
            ].join(" ")}
          />
        </div>
        <button
          type="button"
          onClick={isValid ? reset : validate}
          disabled={isValidating || (!code.trim() && !isValid)}
          aria-label={isValid ? "Remove coupon" : "Apply coupon"}
          className={[
            "mt-6 flex min-h-[44px] items-center rounded-md px-4 text-sm font-semibold",
            "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            isValid
              ? "border border-border bg-surface text-fg hover:bg-surface"
              : "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700",
          ].join(" ")}
        >
          {isValidating ? "Checking…" : isValid ? "Remove" : "Apply"}
        </button>
      </div>

      {/* Error message */}
      {isInvalid ? (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-danger"
          data-testid="coupon-error"
        >
          {state.message}
        </p>
      ) : null}

      {/* Success: display discounted amounts (from server — no client math) */}
      {isValid ? (
        <div
          id={resultId}
          role="status"
          aria-live="polite"
          className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm"
          data-testid="coupon-success"
        >
          <p className="font-semibold text-success">
            Coupon <code className="font-mono">{state.result.displayCode}</code> applied!
          </p>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-fg-muted line-through">
              {renderPaise(state.result.originalPaise)}
            </span>
            <span className="text-xl font-bold text-fg">
              {renderPaise(state.result.finalPaise)}
            </span>
            <span className="text-xs text-success">
              You save {renderPaise(state.result.discountPaise)}!
            </span>
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            Final price at checkout: {renderPaise(state.result.finalPaise)}
          </p>
        </div>
      ) : null}

      {/* Turnstile captcha widget. `appearance="interaction-only"` keeps it out of the
          way until Cloudflare actually needs the visitor to do something — which is what
          this form wanted. It was previously wrapped in a `display:none` div, and a
          Turnstile widget that is never laid out never runs its challenge, so no token
          was ever minted and POST /public/coupons/validate fail-closed on every real
          apply. (It passed in dev only because the noop captcha provider accepts
          anything.) See the `appearance` prop's own doc comment in turnstile-widget.tsx,
          which names this exact mistake. */}
      <TurnstileWidget
        appearance="interaction-only"
        onToken={setToken}
        onExpire={resetToken}
        onError={resetToken}
        data-testid="coupon-captcha"
      />
      <p className="text-xs text-fg-subtle">
        Coupon validation is rate-limited and captcha-protected to prevent abuse.
      </p>
    </div>
  );
}
