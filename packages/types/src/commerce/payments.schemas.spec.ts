// Manual payment entry — the "money has already arrived" rule.
//
// `POST /commerce/payments/manual` does not merely record a fact: it captures the payment,
// marks the order paid, creates the enrollment and raises an invoice, immediately. So a
// `paidAt` in the future would enroll and invoice a student for money nobody has taken, and
// put income in the ledger on a date that has not happened.
//
// The rule lives in the shared schema rather than the date picker, which is what these
// tests pin: the CRM's `max` attribute stops the common case, but it is bypassed by typing,
// and the API has other callers.

import { describe, expect, it } from "vitest";
import { ManualPaymentRequestSchema } from "./payments.schemas.js";

const BASE = {
  orderId: "11111111-1111-4111-8111-111111111111",
  amountPaise: 250_000,
  method: "NEFT",
  reference: "UTR123456789",
};

/** An ISO instant `ms` from now — positive is the future. */
function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe("ManualPaymentRequestSchema — paidAt", () => {
  it("accepts a payment received in the past", () => {
    const result = ManualPaymentRequestSchema.safeParse({ ...BASE, paidAt: iso(-24 * 60 * 60 * 1000) });
    expect(result.success).toBe(true);
  });

  it("accepts an omitted paidAt — the server stamps now", () => {
    const result = ManualPaymentRequestSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });

  it("rejects a payment dated in the future", () => {
    const result = ManualPaymentRequestSchema.safeParse({ ...BASE, paidAt: iso(24 * 60 * 60 * 1000) });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("can't be recorded as received in the future");
  });

  it("rejects even a few hours ahead — this is not a rounding rule", () => {
    const result = ManualPaymentRequestSchema.safeParse({ ...BASE, paidAt: iso(3 * 60 * 60 * 1000) });
    expect(result.success).toBe(false);
  });

  // The timestamp comes from the STAFF MEMBER'S clock and is judged against the server's.
  // An unsynced laptop drifting a minute is ordinary; rejecting "now" for those users would
  // read as a bug, not a rule.
  it("tolerates small clock skew so picking the current minute always works", () => {
    const result = ManualPaymentRequestSchema.safeParse({ ...BASE, paidAt: iso(60 * 1000) });
    expect(result.success).toBe(true);
  });

  it("still rejects a non-ISO string, without double-reporting it as a future date", () => {
    const result = ManualPaymentRequestSchema.safeParse({ ...BASE, paidAt: "2026-07-09T10:30" });
    expect(result.success).toBe(false);
    const message = JSON.stringify(result.error?.issues);
    expect(message).not.toContain("in the future");
  });
});
