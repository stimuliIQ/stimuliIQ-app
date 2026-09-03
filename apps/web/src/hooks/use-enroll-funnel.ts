"use client";

/**
 * useEnrollFunnel — all I/O + state for the Enroll → Register/Login → Order →
 * Razorpay checkout → Verify → Success + LMS handoff funnel.
 *
 * Steps:
 *   0: register (or login if already has account)
 *   1: order (create order, optional coupon + EMI)
 *   2: payment (Razorpay checkout)
 *   3: success (LMS handoff)
 *
 * Security guarantees enforced here:
 *   1. NO money math — amounts come from the server (AC-21)
 *   2. Idempotency key generated ONCE at funnel entry; REUSED on retries (AC-17)
 *   3. Pay button disabled while in-flight (double-click-safe — AC-18/AC-19)
 *   4. Razorpay checkout.js loaded dynamically (no npm dep — just a script tag)
 *   5. Only PUBLIC keyId from checkout response used (never keySecret — AC-41)
 *   6. NO secret in this hook or any component it renders
 *   7. verify() carries Razorpay fields verbatim from the handler callback
 *   8. LMS redirect URL comes from the server verify response (AC-23)
 *
 * Does NOT import Razorpay as a module — loads checkout.js via a <script> tag
 * (see loadRazorpayScript utility).
 */

import { useState, useCallback, useRef } from "react";
import { z } from "zod";
import { PHONE_LOCAL_LENGTH, PHONE_LENGTH_MESSAGE, toE164Phone } from "@repo/ui";
import { apiClient } from "../lib/api-client";
import type {
  PublicOrderResponse,
  PublicCheckoutResponse,
  PublicVerifyPaymentResponse,
} from "@repo/types";

// ---------------------------------------------------------------------------
// Razorpay global type (declared here, script loaded dynamically)
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name?: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (response: RazorpayHandlerResponse) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayHandlerResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
}

// ---------------------------------------------------------------------------
// Load Razorpay checkout.js (no npm dep — official script tag, AC-41)
// ---------------------------------------------------------------------------

const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
// How long to wait on a checkout.js tag somebody else already inserted before giving
// up and telling the user, rather than waiting forever.
const RAZORPAY_SCRIPT_TIMEOUT_MS = 15_000;

async function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_SCRIPT_SRC}"]`,
    );
    if (existingScript) {
      // Already loading — wait on THAT tag rather than adding a second one. The bare
      // poll this replaces had no exit condition: a failed earlier insertion left the
      // promise pending forever, so the checkout button stayed disabled with no error.
      if (window.Razorpay) {
        resolve();
        return;
      }
      const settled = { done: false };
      const finish = (fn: () => void) => {
        if (settled.done) return;
        settled.done = true;
        clearInterval(poll);
        clearTimeout(timeout);
        fn();
      };
      const fail = () => finish(() => reject(new Error("Failed to load Razorpay checkout.js")));
      existingScript.addEventListener("load", () => finish(resolve), { once: true });
      existingScript.addEventListener("error", fail, { once: true });
      const poll = setInterval(() => {
        if (window.Razorpay) finish(resolve);
      }, 100);
      const timeout = setTimeout(fail, RAZORPAY_SCRIPT_TIMEOUT_MS);
      return;
    }

    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout.js"));
    document.head.appendChild(script);
  });
}

// ---------------------------------------------------------------------------
// Form schemas
// ---------------------------------------------------------------------------

export const RegisterStepSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  email: z.string().email("Valid email required").max(254),
  phone: z.string().regex(new RegExp(`^\\d{${PHONE_LOCAL_LENGTH}}$`), PHONE_LENGTH_MESSAGE),
  otpCode: z.string().regex(/^\d{6}$/, "Enter the 6-digit OTP"),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(128),
  tosAccepted: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms of Service" }),
  }),
  marketingOptIn: z.boolean(),
  captchaToken: z.string().min(1, "Please complete the captcha"),
});

export const OrderStepSchema = z.object({
  programId: z.string().min(1, "Program ID is required"),
  couponCode: z.string().max(50).optional(),
  emiPlan: z.string().optional(),
});

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type FunnelStep = "register" | "order" | "payment" | "success";

export interface RegisterFormData {
  name: string;
  email: string;
  phone: string;
  otpCode: string;
  password: string;
  tosAccepted: boolean;
  marketingOptIn: boolean;
  captchaToken: string;
  _hp_email: string;
}

export interface OrderFormData {
  programId: string;
  couponCode?: string;
  emiPlan?: string;
}

type FunnelState =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "success"; result: PublicVerifyPaymentResponse }
  | { kind: "payment_failed"; message: string };

export interface UseEnrollFunnelReturn {
  step: FunnelStep;
  funnelState: FunnelState;
  order: PublicOrderResponse | null;
  checkout: PublicCheckoutResponse | null;

  registerData: RegisterFormData;
  setRegisterData: (data: Partial<RegisterFormData>) => void;

  orderData: OrderFormData;
  setOrderData: (data: Partial<OrderFormData>) => void;

  registerErrors: Record<string, string>;
  orderErrors: Record<string, string>;

  /** Step actions */
  submitRegister: () => Promise<void>;
  /**
   * Requests an OTP. Resolves `true` when the code was actually sent.
   *
   * It returns a result rather than throwing because the failure is already reported
   * through `funnelState` — but the CALLER still needs to know, and previously could
   * not: this resolved void either way, so the register step flipped its "OTP sent"
   * confirmation on unconditionally and rendered it next to the error banner.
   */
  requestOtp: (phone: string) => Promise<boolean>;
  submitOrder: () => Promise<void>;
  submitPayment: () => Promise<void>;
  retryPayment: () => Promise<void>;
  resetFunnel: () => void;
}

const TOS_VERSION =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TOS_VERSION ?? "v1.0")
    : "v1.0";

const INITIAL_REGISTER: RegisterFormData = {
  name: "",
  email: "",
  phone: "",
  otpCode: "",
  password: "",
  tosAccepted: false,
  marketingOptIn: false,
  captchaToken: "",
  _hp_email: "",
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEnrollFunnel(programId: string): UseEnrollFunnelReturn {
  const [step, setStep] = useState<FunnelStep>("register");
  const [funnelState, setFunnelState] = useState<FunnelState>({ kind: "idle" });
  const [order, setOrder] = useState<PublicOrderResponse | null>(null);
  const [checkout, setCheckout] = useState<PublicCheckoutResponse | null>(null);

  const [registerData, setRegisterDataState] = useState<RegisterFormData>(INITIAL_REGISTER);
  const [orderData, setOrderDataState] = useState<OrderFormData>({ programId });

  const [registerErrors, setRegisterErrors] = useState<Record<string, string>>({});
  const [orderErrors, setOrderErrors] = useState<Record<string, string>>({});

  // Idempotency key — generated ONCE at funnel entry, reused for ALL retries (AC-17)
  const idempotencyKeyRef = useRef<string>(
    // crypto.randomUUID() is available in modern browsers and Node.js 19+
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  // Synchronous re-entry guard for the money operations (order + payment). State does
  // not update between two calls in the same tick (stale closure), so a ref is required
  // to make the pay button truly double-click-safe (the backend idempotency key is the
  // ultimate safety net; this prevents duplicate in-flight requests — AC-16/AC-18).
  const submittingRef = useRef(false);

  const setRegisterData = useCallback((data: Partial<RegisterFormData>) => {
    setRegisterDataState((prev) => ({ ...prev, ...data }));
    const keys = Object.keys(data);
    setRegisterErrors((prev) => {
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  }, []);

  const setOrderData = useCallback((data: Partial<OrderFormData>) => {
    setOrderDataState((prev) => ({ ...prev, ...data }));
    const keys = Object.keys(data);
    setOrderErrors((prev) => {
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // OTP request (uses existing auth API)
  // ---------------------------------------------------------------------------

  const requestOtp = useCallback(async (phone: string): Promise<boolean> => {
    setFunnelState({ kind: "loading", message: "Sending OTP…" });
    try {
      // Normalised here (not in the component) so the OTP is minted against the
      // exact same E.164 value `register` later verifies against.
      await apiClient.auth.otpRequest({ phone: toE164Phone(phone) });
      setFunnelState({ kind: "idle" });
      return true;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to send OTP. Try again.";
      setFunnelState({ kind: "error", message });
      return false;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Step 1: Register (P-6)
  // ---------------------------------------------------------------------------

  const submitRegister = useCallback(async () => {
    // Honeypot check
    if (registerData._hp_email && registerData._hp_email.length > 0) {
      // Silently advance (bot — don't block the funnel flow visibly)
      setStep("order");
      return;
    }

    // Validate
    const result = RegisterStepSchema.safeParse({
      name: registerData.name,
      email: registerData.email,
      phone: registerData.phone,
      otpCode: registerData.otpCode,
      password: registerData.password,
      tosAccepted: registerData.tosAccepted || undefined,
      marketingOptIn: registerData.marketingOptIn,
      captchaToken: registerData.captchaToken,
    });
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? "field");
        errors[key] = issue.message;
      }
      setRegisterErrors(errors);
      return;
    }

    setFunnelState({ kind: "loading", message: "Creating your account…" });

    try {
      await apiClient.public.auth.register({
        name: registerData.name,
        email: registerData.email,
        // Same normalisation as `requestOtp` — the backend matches the OTP
        // against the phone it was issued for, so both must be identical.
        phone: toE164Phone(registerData.phone),
        otpCode: registerData.otpCode,
        password: registerData.password,
        consent: {
          marketingOptIn: registerData.marketingOptIn,
          tosVersion: TOS_VERSION,
        },
        captchaToken: registerData.captchaToken || "noop",
      });

      setFunnelState({ kind: "idle" });
      setStep("order");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Registration failed. Please try again.";
      setFunnelState({ kind: "error", message });
    }
  }, [registerData]);

  // ---------------------------------------------------------------------------
  // Step 2: Create Order (P-7)
  // ---------------------------------------------------------------------------

  const submitOrder = useCallback(async () => {
    // Validate
    const result = OrderStepSchema.safeParse(orderData);
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? "field");
        errors[key] = issue.message;
      }
      setOrderErrors(errors);
      return;
    }

    if (submittingRef.current) return; // double-click guard (ref is synchronous)
    submittingRef.current = true;
    setFunnelState({ kind: "loading", message: "Creating your order…" });

    try {
      // IDEMPOTENT: same key on retries → returns existing order (AC-17)
      const orderResponse = await apiClient.public.enroll.createOrder(
        {
          programId: orderData.programId,
          couponCode: orderData.couponCode || undefined,
          // emiPlan omitted for P5 (display-only)
        },
        idempotencyKeyRef.current,
      );

      setOrder(orderResponse);

      // Immediately initiate checkout so the user can proceed to payment (P-8)
      const checkoutResponse = await apiClient.public.enroll.checkout(
        { orderId: orderResponse.orderId },
        idempotencyKeyRef.current,
      );

      setCheckout(checkoutResponse);
      setFunnelState({ kind: "idle" });
      setStep("payment");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Order creation failed. Please try again.";
      setFunnelState({ kind: "error", message });
    } finally {
      submittingRef.current = false;
    }
  }, [orderData]);

  // ---------------------------------------------------------------------------
  // Step 3: Razorpay checkout + Verify (P-8, P-9)
  // ---------------------------------------------------------------------------

  const submitPayment = useCallback(async () => {
    if (!checkout || !order) return;
    if (submittingRef.current) return; // double-click guard (ref is synchronous)
    submittingRef.current = true;

    setFunnelState({ kind: "loading", message: "Opening payment…" });

    try {
      // Load Razorpay checkout.js (no npm dep — script tag, AC-41)
      await loadRazorpayScript();

      if (!window.Razorpay) {
        throw new Error("Razorpay checkout could not be loaded. Please refresh and try again.");
      }

      await new Promise<void>((resolve, reject) => {
        // PUBLIC keyId ONLY — never keySecret (AC-41)
        const razorpay = new window.Razorpay!({
          key: checkout.keyId, // PUBLIC Razorpay key id (rzp_test_... or rzp_live_...)
          amount: checkout.amountPaise, // Server-derived (AC-21, never from client)
          currency: checkout.currency,
          order_id: checkout.razorpayOrderId,
          name: "Stimuli IQ",
          description: "Program enrollment",
          theme: { color: "#047857" },
          handler: async (response: RazorpayHandlerResponse) => {
            // Payment succeeded on Razorpay side — now verify server-side (P-9)
            setFunnelState({ kind: "loading", message: "Verifying payment…" });

            try {
              // Pass Razorpay fields verbatim — no client-side signature computation
              // IDEMPOTENT: same key → replay → no double-enrollment (AC-18)
              const verifyResult = await apiClient.public.enroll.verify(
                {
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_signature: response.razorpay_signature,
                },
                idempotencyKeyRef.current,
              );

              setFunnelState({ kind: "success", result: verifyResult });
              setStep("success");
              resolve();
            } catch (verifyErr: unknown) {
              const message =
                verifyErr instanceof Error
                  ? verifyErr.message
                  : "Payment verification failed. Please contact support.";
              setFunnelState({ kind: "error", message });
              reject(new Error(message));
            }
          },
          modal: {
            ondismiss: () => {
              // User closed the Razorpay modal without completing payment
              setFunnelState({ kind: "payment_failed", message: "Payment was cancelled. You can retry using the button below." });
              resolve(); // don't reject — this is user-initiated cancellation
            },
          },
        });

        razorpay.open();
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Payment failed. Please try again.";
      setFunnelState({ kind: "error", message });
    } finally {
      submittingRef.current = false;
    }
  }, [checkout, order]);

  // ---------------------------------------------------------------------------
  // Retry payment — reuses same idempotency key (AC-19)
  // ---------------------------------------------------------------------------

  const retryPayment = useCallback(async () => {
    // Without an order there is nothing to retry. The guard used to be
    // `if (!order || !checkout)` and then dereferenced `order!.orderId` INSIDE that same
    // branch — so the one case it was written to catch, a genuinely missing order, threw
    // a TypeError out of an async callback with nothing to catch it: no error state, no
    // message, a dead button. Only a missing CHECKOUT is retryable here.
    if (!order) {
      setFunnelState({
        kind: "error",
        message: "This enrolment has no payment to retry. Start again from the top.",
      });
      return;
    }

    if (!checkout) {
      // Re-checkout with the existing order (same idempotency key → existing order)
      setFunnelState({ kind: "loading", message: "Re-opening payment…" });
      try {
        const checkoutResponse = await apiClient.public.enroll.checkout(
          { orderId: order.orderId },
          idempotencyKeyRef.current, // SAME key → no new Razorpay order if already exists
        );
        setCheckout(checkoutResponse);
        setFunnelState({ kind: "idle" });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to retry payment. Please try again.";
        setFunnelState({ kind: "error", message });
        return;
      }
    }

    // Reset payment-failed state then trigger checkout
    setFunnelState({ kind: "idle" });
    await submitPayment();
  }, [order, checkout, submitPayment]);

  // ---------------------------------------------------------------------------
  // Reset funnel
  // ---------------------------------------------------------------------------

  const resetFunnel = useCallback(() => {
    setStep("register");
    setFunnelState({ kind: "idle" });
    setOrder(null);
    setCheckout(null);
    setRegisterDataState(INITIAL_REGISTER);
    setOrderDataState({ programId });
    setRegisterErrors({});
    setOrderErrors({});
    // Generate a NEW idempotency key on funnel reset (new funnel session)
    idempotencyKeyRef.current =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, [programId]);

  return {
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
  };
}
