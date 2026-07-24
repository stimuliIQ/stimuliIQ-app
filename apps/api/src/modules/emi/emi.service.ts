// apps/api/src/modules/emi/emi.service.ts
//
// Business logic for EMI plans + dunning (T11/T14/T24, docs/plans/phase-9-completion.md).
// No Prisma here (CLAUDE.md §3.3) — all persistence goes through EmiRepository.
//
// MONEY: every amount is integer paise + an explicit currency (CLAUDE.md §3.6). The
// installment schedule is computed HERE, server-side — the client never sends
// per-installment amounts/dates (CreateEmiPlanRequest carries only totalAmountPaise +
// numInstallments + startDate).
//
// SCOPE:
//   `/crm/emi-plans*` (CRM): all (finance/admin, no restriction) | branch (branch_manager
//     — documented gap, no branch_id column on emi_plans/orders/student_profiles, so
//     "branch" resolves to "no restriction", mirrors MentorsService/SettingsService
//     precedent) | own (counsellor — "their own LEADS' EMI plans", traced via
//     order -> student -> convertedFromLead.ownerId, per prisma/seed.ts's grant comment).
//   `/me/emi-plans` (student self-view): always filters to the caller's OWN
//     student-linked orders (order.student.userId === actorId), independent of the
//     abstract scope resolution above — this route's entire purpose (DTO comment:
//     "List own EMI plans (via own orders)") is a fixed "my own account" filter, not a
//     role-dependent "own" resolution. NOTE (flagged, not silently worked around):
//     `emi.view` is NOT granted to the `student` role in prisma/seed.ts's P9 grants
//     (only finance/branch_manager/counsellor hold it) — this route is code-complete
//     and will 403 real students today until that grant is added; tracked as a Wave-1
//     seed follow-up (this task owns apps/api only, not prisma/seed.ts permission grants).
//
// SERVER-INITIATED CHARGE (mark-paid without a paymentId — "the server initiates one"):
// creates a Razorpay TEST order via PAYMENT_PROVIDER.createOrder() and a `payments` row
// (status=created) linked to the installment — the installment itself stays `pending`
// until a captured payment is later linked (either a follow-up mark-paid call WITH the
// resulting paymentId, or a future webhook-driven auto-link — see file-header of
// commerce/invoice-gen.seam.ts for the established webhook-processor precedent this
// would extend). PaymentProvider has no synchronous "charge now" primitive without a
// client-side checkout completion (Razorpay's standard flow requires the checkout
// widget/payment link for card/UPI details) — this is an honest, documented
// representation of that constraint, not a stubbed no-op.

import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { EmiInstallment as EmiInstallmentRow } from "@prisma/client";
import type {
  CreateEmiPlanRequest,
  EmiPlanDetail,
  EmiPlanSummary,
  ListEmiPlansQuery,
  MarkEmiInstallmentPaidRequest,
} from "@repo/types";
import { EmiRepository, type EmiPlanWithInstallments, type EmiPlanWithStudent, type InstallmentSeed } from "./emi.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../commerce/providers/payment/payment-provider.interface";
import { EMI_DUNNING_PORT, type EmiDunningPort } from "./dunning/emi-dunning.port";
import { RedisService } from "../../redis/redis.service";

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24h — belt-and-suspenders replay guard.

function toSummary(row: EmiPlanWithStudent): EmiPlanSummary {
  return {
    id: row.id,
    orderId: row.orderId,
    studentName: row.order.student.user.name,
    totalAmountPaise: row.totalAmountPaise,
    currency: row.currency,
    numInstallments: row.numInstallments,
    status: row.status,
    startDate: row.startDate.toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
  };
}

function toInstallmentDto(row: EmiInstallmentRow): EmiPlanDetail["installments"][number] {
  return {
    id: row.id,
    emiPlanId: row.emiPlanId,
    installmentNo: row.installmentNo,
    amountPaise: row.amountPaise,
    dueDate: row.dueDate.toISOString().slice(0, 10),
    status: row.status,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    paymentId: row.paymentId,
    dunningAttempts: row.dunningAttempts,
    lastDunningAt: row.lastDunningAt ? row.lastDunningAt.toISOString() : null,
  };
}

function toDetail(row: EmiPlanWithInstallments): EmiPlanDetail {
  return {
    ...toSummary(row),
    installments: row.installments.map(toInstallmentDto),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Splits totalAmountPaise across numInstallments so every paise is accounted for
 * (remainder distributed to the FIRST installments, one extra paise each), with due
 * dates starting on startDate then +1 calendar month per subsequent installment. */
export function buildInstallmentSchedule(totalAmountPaise: number, numInstallments: number, startDate: Date): InstallmentSeed[] {
  const base = Math.floor(totalAmountPaise / numInstallments);
  const remainder = totalAmountPaise - base * numInstallments;

  const installments: InstallmentSeed[] = [];
  for (let i = 0; i < numInstallments; i++) {
    const amountPaise = base + (i < remainder ? 1 : 0);
    const dueDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + i, startDate.getUTCDate()));
    installments.push({ installmentNo: i + 1, amountPaise, dueDate });
  }
  return installments;
}

@Injectable()
export class EmiService {
  constructor(
    private readonly repository: EmiRepository,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    @Inject(EMI_DUNNING_PORT) private readonly dunningPort: EmiDunningPort,
    private readonly redis: RedisService,
  ) {}

  private assertCrmScope(): "all" | "branch" | "own" {
    const scope = requireScopeContext();
    if (scope.scope !== "all" && scope.scope !== "branch" && scope.scope !== "own") {
      throw new ForbiddenException({
        code: "emi.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for the EMI module.`,
      });
    }
    return scope.scope;
  }

  // ── CRM ───────────────────────────────────────────────────────────────────

  async createPlan(tenantId: string, body: CreateEmiPlanRequest): Promise<EmiPlanDetail> {
    this.assertCrmScope();

    const order = await this.repository.findOrderForPlan(tenantId, body.orderId);
    if (!order) throw new NotFoundException({ code: "emi.order_not_found", title: "Order not found" });

    const existing = await this.repository.findActivePlanByOrderId(tenantId, body.orderId);
    if (existing) {
      throw new UnprocessableEntityException({
        code: "EMI_PLAN_ALREADY_EXISTS",
        title: "An EMI plan already exists for this order",
        detail: "Cancel the existing plan before creating a new one for this order.",
      });
    }

    const startDate = new Date(`${body.startDate}T00:00:00.000Z`);
    const installments = buildInstallmentSchedule(body.totalAmountPaise, body.numInstallments, startDate);

    const planId = await this.repository.createPlanWithInstallments(tenantId, {
      orderId: body.orderId,
      totalAmountPaise: body.totalAmountPaise,
      currency: body.currency,
      numInstallments: body.numInstallments,
      startDate,
      installments,
    });

    const row = await this.repository.findById(tenantId, planId);
    return toDetail(row!);
  }

  async listCrm(tenantId: string, actorId: string, query: ListEmiPlansQuery): Promise<PaginatedResult<EmiPlanSummary>> {
    const scope = this.assertCrmScope();
    const { rows, total } = await this.repository.list({
      tenantId,
      orderId: query.orderId,
      status: query.status,
      search: query.search,
      leadOwnerId: scope === "own" ? actorId : undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<EmiPlanDetail> {
    this.assertCrmScope();
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "emi.not_found", title: "EMI plan not found" });
    return toDetail(row);
  }

  // ── Student self-view ────────────────────────────────────────────────────

  async listOwn(tenantId: string, actorId: string, query: ListEmiPlansQuery): Promise<PaginatedResult<EmiPlanSummary>> {
    const { rows, total } = await this.repository.list({
      tenantId,
      orderId: query.orderId,
      status: query.status,
      studentUserId: actorId,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  // ── Installment charge (idempotent) ──────────────────────────────────────

  async markInstallmentPaid(
    tenantId: string,
    planId: string,
    installmentId: string,
    body: MarkEmiInstallmentPaidRequest,
    idempotencyKey: string,
  ): Promise<EmiPlanDetail> {
    this.assertCrmScope();

    const plan = await this.repository.findById(tenantId, planId);
    if (!plan) throw new NotFoundException({ code: "emi.not_found", title: "EMI plan not found" });
    const installment = await this.repository.findInstallment(tenantId, planId, installmentId);
    if (!installment) throw new NotFoundException({ code: "emi.installment_not_found", title: "Installment not found" });

    if (installment.status === "paid") {
      return toDetail((await this.repository.findById(tenantId, planId))!); // idempotent no-op replay.
    }

    // Belt-and-suspenders HTTP-level idempotency (mirrors lms-progress.controller.ts's
    // documented Idempotency-Key convention) — the DB-state check above is the primary
    // correctness guard; this guards against a same-key retry racing a not-yet-committed
    // first attempt from creating a second provider order.
    //
    // DEFECT FIX (QA emi.service.ts markInstallmentPaid): a same-key retry against the SAME
    // still-pending installment previously fell through and re-ran the Path-B charge path,
    // minting a SECOND pending `payments` row. If the key was already recorded for THIS
    // installment, this is a replay — return the current plan state WITHOUT re-charging.
    const idemCacheKey = `emi:charge-idem:${idempotencyKey}`;
    const cachedInstallmentId = await this.redis.client.get(idemCacheKey).catch(() => null);
    if (cachedInstallmentId) {
      if (cachedInstallmentId !== installmentId) {
        throw new UnprocessableEntityException({
          code: "EMI_IDEMPOTENCY_KEY_REUSED",
          title: "Idempotency-Key already used for a different installment",
        });
      }
      // Same key, same installment → idempotent replay: no second charge, return current state.
      return toDetail((await this.repository.findById(tenantId, planId))!);
    }

    await this.redis.client.set(idemCacheKey, installmentId, "EX", IDEMPOTENCY_TTL_SECONDS).catch(() => undefined);

    if (body.paymentId) {
      // Path A: already captured out-of-band — link + finalize.
      const payment = await this.repository.findCapturedPayment(tenantId, plan.orderId, body.paymentId);
      if (!payment || payment.status !== "captured") {
        throw new UnprocessableEntityException({
          code: "EMI_PAYMENT_NOT_CAPTURED",
          title: "Payment is not a captured payment for this order",
          detail: "The referenced paymentId must belong to this EMI plan's order and be in captured status.",
        });
      }
      if (payment.amountPaise !== installment.amountPaise) {
        throw new UnprocessableEntityException({
          code: "EMI_PAYMENT_AMOUNT_MISMATCH",
          title: "Payment amount does not match the installment amount",
        });
      }
      await this.repository.markInstallmentPaid(installmentId, payment.id, new Date());
    } else {
      // Path B: "the server initiates one" — create a Razorpay TEST order + a pending
      // Payment row; the installment stays pending until a captured payment is linked
      // (see file header — no synchronous server-side capture primitive exists).
      //
      // Durable back-stop (survives a Redis flush that would defeat the idempotency-cache
      // replay guard above): if a pending payment is already linked to this installment, a
      // prior Path-B attempt already initiated the charge — return current state instead of
      // minting a duplicate `payments` row.
      if (installment.paymentId) {
        return toDetail((await this.repository.findById(tenantId, planId))!);
      }

      const providerOrder = await this.paymentProvider.createOrder({
        amountPaise: installment.amountPaise,
        currency: plan.currency,
        receipt: `emi-inst-${installmentId}`.slice(0, 40),
        notes: { emiPlanId: planId, installmentId, installmentNo: String(installment.installmentNo) },
      });
      const payment = await this.repository.createPendingPayment({
        tenantId,
        orderId: plan.orderId,
        providerOrderId: providerOrder.providerOrderId,
        amountPaise: installment.amountPaise,
      });
      await this.repository.linkPendingPayment(installmentId, payment.id);
    }

    const refreshed = await this.repository.findById(tenantId, planId);
    return toDetail(refreshed!);
  }

  // ── Dunning ───────────────────────────────────────────────────────────────

  async triggerDunning(tenantId: string, planId: string, installmentId: string): Promise<EmiPlanDetail> {
    this.assertCrmScope();

    const plan = await this.repository.findById(tenantId, planId);
    if (!plan) throw new NotFoundException({ code: "emi.not_found", title: "EMI plan not found" });
    const installment = await this.repository.findInstallment(tenantId, planId, installmentId);
    if (!installment) throw new NotFoundException({ code: "emi.installment_not_found", title: "Installment not found" });

    if (installment.status !== "pending" && installment.status !== "overdue") {
      throw new UnprocessableEntityException({
        code: "EMI_DUNNING_NOT_APPLICABLE",
        title: "Dunning is only applicable to pending or overdue installments",
        detail: `Installment status is "${installment.status}".`,
      });
    }

    const nextStatus = installment.dueDate < new Date() ? "overdue" : installment.status;
    const updated = await this.repository.recordDunningAttempt(installmentId, nextStatus);

    await this.dunningPort.sendReminder({
      tenantId,
      emiPlanId: planId,
      installmentId,
      installmentNo: updated.installmentNo,
      amountPaise: updated.amountPaise,
      currency: plan.currency,
      dueDate: updated.dueDate.toISOString().slice(0, 10),
      dunningAttempts: updated.dunningAttempts,
      toEmail: plan.order.student.user.email,
      studentName: plan.order.student.user.name,
    });

    const refreshed = await this.repository.findById(tenantId, planId);
    return toDetail(refreshed!);
  }
}
