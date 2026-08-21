// Payment-link contracts (lifecycle-redesign: staff sends a student a secure
// Razorpay link to pay an open order remotely).
//
// Two surfaces share these:
//   • CRM (staff):  POST /api/v1/commerce/orders/:id/payment-link → mints a SIGNED
//     token URL (HMAC over tenantId+orderId+expiry — see apps/api .../pay-link.util.ts)
//     pointing at the public web app's /pay/:token page.
//   • Public (student, NO login): GET /api/v1/public/pay/:token → order summary;
//     POST .../checkout + .../verify reuse the enroll funnel's PublicCheckoutResponse
//     and PublicVerifyPayment contracts — the token replaces the session as the
//     own-scope proof.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { OrderStatusSchema } from "./orders.schemas.js";

/** Response of POST /api/v1/commerce/orders/:id/payment-link (staff-side mint). */
export const CreatePaymentLinkResponseSchema = z.object({
  /** Absolute URL to send to the student (…/pay/<token> on the public web app). */
  url: z.string().url().describe("Shareable payment URL for the student."),
  /** The raw signed token (embedded in `url`; exposed for tests/diagnostics). */
  token: z.string().min(1),
  expiresAt: IsoDateTimeSchema.describe("When the link stops working (embedded in the signature)."),
});
export type CreatePaymentLinkResponse = z.infer<typeof CreatePaymentLinkResponseSchema>;

/**
 * POST /api/v1/commerce/orders/payment-links/send — email payment link(s) to the
 * student instead of copy-pasting them (call-center flow: "send it to them now").
 * All orders must belong to ONE student and be in `created` (payable) status.
 * One order → a single-payment email; several → one email listing every pending
 * program with its own Pay button plus the total, so the student can pay each
 * individually from the same message.
 */
export const SendPaymentLinksRequestSchema = z
  .object({
    orderIds: z.array(UuidSchema).min(1).max(10).describe("Open orders to include. All for the same student."),
  })
  .strict();
export type SendPaymentLinksRequest = z.infer<typeof SendPaymentLinksRequestSchema>;

export const SendPaymentLinksResponseSchema = z.object({
  email: z.string().email().describe("The student address the payment email was sent to."),
  count: z.number().int().min(1).describe("How many payment links the email contains."),
  totalAmountPaise: z.number().int().min(0).describe("Sum of the included orders' amounts."),
});
export type SendPaymentLinksResponse = z.infer<typeof SendPaymentLinksResponseSchema>;

/**
 * Response of GET /api/v1/public/pay/:token — the minimal order summary the public
 * pay page renders before opening Razorpay checkout. Deliberately lean: first name
 * + program + amount; no email/phone/ids beyond the order id the token already binds.
 */
export const PublicPayLinkOrderSchema = z.object({
  orderId: UuidSchema,
  studentName: z.string().describe("Display name for the 'Paying as …' line."),
  programTitle: z.string(),
  batchName: z.string(),
  amountPaise: z.number().int().min(0),
  currency: z.string().length(3),
  status: OrderStatusSchema.describe("Live order status, 'created' is the only payable state."),
  expiresAt: IsoDateTimeSchema.describe("Link expiry (from the signed token)."),
});
export type PublicPayLinkOrder = z.infer<typeof PublicPayLinkOrderSchema>;
