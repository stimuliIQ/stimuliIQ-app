// EMI plans + dunning contract — Phase 9 Completion, T11/T14/T24
// (docs/plans/phase-9-completion.md). Backs `model EmiPlan` + `model EmiInstallment`.
// Distinct from the informal `orders.emi_plan` JSON breakdown
// (commerce/orders.schemas.ts `OrderEmiPlanSchema`, a P2 order-level display hint) —
// this is the FORMAL installment-tracking + dunning model (P9).
//
// Surfaces:
//   - CRM (Finance/Admin): create a plan against a paid/part-paid order, list/get,
//     mark an installment paid (Razorpay TEST charge, backend-builder T24), trigger a
//     manual dunning reminder — /api/v1/crm/emi-plans. Permission: emi.view, emi.manage.
//   - Student (LMS, own-scope): read-only view of their own plan + installment schedule
//     — /api/v1/me/emi-plans.
//
// Money: all amount fields are integer paise + an explicit `currency` (CLAUDE.md §3.6).
// The per-installment schedule is computed server-side from `totalAmountPaise` /
// `numInstallments` — the client never sends per-installment amounts on create.

import { z } from "zod";
import { UuidSchema, IsoDateSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

export const EmiPlanStatusSchema = z.enum(["active", "completed", "defaulted", "cancelled"]);
export type EmiPlanStatus = z.infer<typeof EmiPlanStatusSchema>;

export const EmiInstallmentStatusSchema = z.enum(["pending", "paid", "overdue", "waived", "failed"]);
export type EmiInstallmentStatus = z.infer<typeof EmiInstallmentStatusSchema>;

/**
 * POST /api/v1/crm/emi-plans — the server computes the installment schedule
 * (`totalAmountPaise` split across `numInstallments`, first due on `startDate` then
 * monthly) server-side; the client never sends per-installment amounts/dates.
 */
export const CreateEmiPlanRequestSchema = z
  .object({
    orderId: UuidSchema,
    totalAmountPaise: z.number().int().min(1),
    currency: z.string().length(3).default("INR"),
    numInstallments: z.number().int().min(2).max(24),
    startDate: IsoDateSchema,
  })
  .strict();
export type CreateEmiPlanRequest = z.infer<typeof CreateEmiPlanRequestSchema>;

export const ListEmiPlansQuerySchema = z
  .object({
    orderId: UuidSchema.optional(),
    status: EmiPlanStatusSchema.optional(),
    search: z.string().min(1).max(200).optional().describe("Match by student name / order id prefix."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListEmiPlansQuery = z.infer<typeof ListEmiPlansQuerySchema>;

export const EmiInstallmentSchema = z.object({
  id: UuidSchema,
  emiPlanId: UuidSchema,
  installmentNo: z.number().int().min(1),
  amountPaise: z.number().int().min(0),
  dueDate: IsoDateSchema,
  status: EmiInstallmentStatusSchema,
  paidAt: IsoDateTimeSchema.nullable(),
  paymentId: UuidSchema.nullable(),
  dunningAttempts: z.number().int().min(0),
  lastDunningAt: IsoDateTimeSchema.nullable(),
});
export type EmiInstallment = z.infer<typeof EmiInstallmentSchema>;

export const EmiPlanSummarySchema = z.object({
  id: UuidSchema,
  orderId: UuidSchema,
  studentName: z.string(),
  totalAmountPaise: z.number().int().min(0),
  currency: z.string().length(3),
  numInstallments: z.number().int().min(1),
  status: EmiPlanStatusSchema,
  startDate: IsoDateSchema,
  createdAt: IsoDateTimeSchema,
});
export type EmiPlanSummary = z.infer<typeof EmiPlanSummarySchema>;

export const EmiPlanDetailSchema = EmiPlanSummarySchema.extend({
  installments: z.array(EmiInstallmentSchema),
  updatedAt: IsoDateTimeSchema,
});
export type EmiPlanDetail = z.infer<typeof EmiPlanDetailSchema>;

/**
 * POST /api/v1/crm/emi-plans/:id/installments/:installmentId/mark-paid — idempotent;
 * replaying against an already-paid installment is a no-op 200, not an error. Runs a
 * Razorpay TEST charge (backend-builder T24) and links the resulting `paymentId`.
 */
export const MarkEmiInstallmentPaidRequestSchema = z
  .object({
    paymentId: UuidSchema.optional().describe("If the charge was already captured out-of-band; otherwise the server initiates one."),
  })
  .strict();
export type MarkEmiInstallmentPaidRequest = z.infer<typeof MarkEmiInstallmentPaidRequestSchema>;

/** POST /api/v1/crm/emi-plans/:id/installments/:installmentId/dunning — manual reminder trigger (in addition to the BullMQ-scheduled ones, T18). */
export const TriggerEmiDunningRequestSchema = z.object({}).strict();
export type TriggerEmiDunningRequest = z.infer<typeof TriggerEmiDunningRequestSchema>;
