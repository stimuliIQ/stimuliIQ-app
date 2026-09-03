"use client";

// PayLinkClient — the whole payment-link experience (lifecycle-redesign):
//   1. Load the order summary via the signed token (GET /public/pay/:token).
//   2. "Pay now" → POST .../checkout → open Razorpay checkout.js.
//   3. Razorpay handler → POST .../verify (signature check + atomic enrollment +
//      invoice + LMS provisioning + receipt email server-side).
//   4. Success screen pointing at the email (invoice + LMS credentials).
//
// Security mirrors the enroll funnel's payment step (AC-18/19/21/41): amounts are
// server-derived, the key is the PUBLIC Razorpay key only, the pay button is
// double-click-safe, and a failed payment offers a retry against the same order.

import * as React from "react";

import { apiClient } from "../../../lib/api-client";
import type { PublicPayLinkOrder, PublicVerifyPaymentResponse } from "@repo/types";

const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
// How long to wait on a checkout.js tag somebody else already inserted before giving
// up and telling the user, rather than waiting forever.
const RAZORPAY_SCRIPT_TIMEOUT_MS = 15_000;

// window.Razorpay's ambient type is declared once in hooks/use-enroll-funnel.ts
// (same script, same option shape) — this page reuses that declaration.

async function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_SCRIPT_SRC}"]`);
    if (existing) {
      // A tag is already in the document, so this promise waits on ITS load rather than
      // adding a second one. It used to poll every 100ms with no exit: if that earlier
      // insertion had failed (blocked, offline, CSP), `window.Razorpay` never appeared and
      // the promise never settled — no resolve, no reject — leaving the Pay button
      // disabled forever with nothing on screen to explain it. Listening to the tag's own
      // events settles on failure too, and the timeout covers a tag that is somehow
      // already past both.
      if (window.Razorpay) return resolve();
      const settled = { done: false };
      const finish = (fn: () => void) => {
        if (settled.done) return;
        settled.done = true;
        clearInterval(poll);
        clearTimeout(timeout);
        fn();
      };
      const fail = () => finish(() => reject(new Error("Failed to load Razorpay checkout.js")));
      existing.addEventListener("load", () => finish(resolve), { once: true });
      existing.addEventListener("error", fail, { once: true });
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
    document.body.appendChild(script);
  });
}

function formatPaise(paise: number): string {
  return `₹${Math.floor(paise / 100).toLocaleString("en-IN")}`;
}

type Phase = "loading" | "ready" | "paying" | "verifying" | "done" | "error";

export function PayLinkClient({ token }: { token: string }) {
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [order, setOrder] = React.useState<PublicPayLinkOrder | null>(null);
  const [result, setResult] = React.useState<PublicVerifyPaymentResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    apiClient.public.payLink
      .getOrder(token)
      .then((o) => {
        if (cancelled) return;
        setOrder(o);
        setPhase(o.status === "created" ? "ready" : "error");
        if (o.status === "paid") setError("This order is already paid. Nothing to do here: check your email for the invoice.");
        else if (o.status !== "created") setError(`This order can no longer be paid (status: ${o.status}).`);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPhase("error");
        setError(
          e && typeof e === "object" && "problem" in e
            ? ((e as { problem: { detail?: string; title?: string } }).problem.detail ??
              (e as { problem: { detail?: string; title?: string } }).problem.title ??
              "This payment link is invalid.")
            : "This payment link is invalid or has expired.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const pay = async () => {
    if (!order) return;
    setPhase("paying");
    setError(null);
    try {
      const [checkout] = await Promise.all([apiClient.public.payLink.checkout(token), loadRazorpayScript()]);
      const razorpay = new window.Razorpay!({
        key: checkout.keyId, // PUBLIC key only
        amount: checkout.amountPaise,
        currency: checkout.currency,
        order_id: checkout.razorpayOrderId,
        name: "stimuliiq",
        description: order.programTitle,
        theme: { color: "#047857" },
        handler: (response) => {
          void (async () => {
            setPhase("verifying");
            try {
              const verified = await apiClient.public.payLink.verify(token, response);
              setResult(verified);
              setPhase("done");
            } catch {
              setPhase("error");
              setError("Payment verification failed. If money was deducted it will be reconciled. Contact support with your order id.");
            }
          })();
        },
        modal: { ondismiss: () => setPhase("ready") },
      });
      razorpay.open();
    } catch (e: unknown) {
      setPhase("ready");
      setError(
        e && typeof e === "object" && "problem" in e
          ? ((e as { problem: { detail?: string } }).problem.detail ?? "Couldn't start the payment. Please try again.")
          : "Couldn't start the payment. Please try again.",
      );
    }
  };

  return (
    <main id="main-content" className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col justify-center gap-6 p-6 py-12">
      <h1 className="text-2xl font-bold text-fg">Complete your payment</h1>

      {phase === "loading" ? (
        <p className="text-sm text-fg-muted" data-testid="pay-link-loading">
          Loading your order…
        </p>
      ) : null}

      {order && phase !== "done" ? (
        <div className="rounded-xl border border-border bg-surface p-5" data-testid="pay-link-summary">
          <p className="text-sm text-fg-muted">Paying as</p>
          <p className="font-medium text-fg">{order.studentName}</p>
          <hr className="my-3 border-border" />
          <p className="font-semibold text-fg">{order.programTitle}</p>
          {order.batchName ? <p className="text-sm text-fg-muted">{order.batchName}</p> : null}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-fg-muted">Amount due</span>
            <span className="text-2xl font-bold text-fg" data-testid="pay-link-amount">
              {formatPaise(order.amountPaise)} {order.currency}
            </span>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          data-testid="pay-link-error"
        >
          {error}
        </div>
      ) : null}

      {phase === "ready" || phase === "paying" ? (
        <button
          type="button"
          onClick={pay}
          disabled={phase === "paying"}
          className="rounded-md bg-brand-500 px-6 py-3 font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="pay-link-pay-button"
        >
          {phase === "paying" ? "Opening secure checkout…" : order ? `Pay ${formatPaise(order.amountPaise)} securely` : "Pay now"}
        </button>
      ) : null}

      {phase === "verifying" ? (
        <p className="text-sm text-fg-muted" role="status" data-testid="pay-link-verifying">
          Verifying your payment…
        </p>
      ) : null}

      {phase === "done" && result ? (
        <div className="flex flex-col gap-3 rounded-xl border border-success/30 bg-success/10 p-5" data-testid="pay-link-success">
          <h2 className="text-lg font-semibold text-success">Payment successful!</h2>
          <p className="text-sm text-fg">
            {result.message} Your invoice and LMS login details are on their way to your email.
          </p>
          <a
            href={result.lmsRedirectUrl}
            className="mt-2 inline-block rounded-md bg-brand-500 px-5 py-2.5 text-center font-medium text-white transition-colors hover:bg-brand-600"
          >
            Go to the LMS
          </a>
        </div>
      ) : null}

      <p className="text-xs text-fg-subtle">
        Payments are processed securely by Razorpay. We never see or store your card details.
      </p>
    </main>
  );
}
