// apps/api/src/modules/emi/dto/index.ts
//
// Re-exports the Phase-9 Completion EMI plans + dunning zod schemas from @repo/types
// (docs/04-trd-architecture.md §2.2 module template, T11/T14/T24). Never redeclare a
// shape here — single source of truth stays in packages/types/src/commerce/emi.schemas.ts.

export {
  EmiPlanStatusSchema,
  type EmiPlanStatus,
  EmiInstallmentStatusSchema,
  type EmiInstallmentStatus,
  CreateEmiPlanRequestSchema,
  type CreateEmiPlanRequest,
  ListEmiPlansQuerySchema,
  type ListEmiPlansQuery,
  EmiInstallmentSchema,
  type EmiInstallment,
  EmiPlanSummarySchema,
  type EmiPlanSummary,
  EmiPlanDetailSchema,
  type EmiPlanDetail,
  MarkEmiInstallmentPaidRequestSchema,
  type MarkEmiInstallmentPaidRequest,
  TriggerEmiDunningRequestSchema,
  type TriggerEmiDunningRequest,
} from "@repo/types";
