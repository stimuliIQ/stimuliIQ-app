// apps/api/src/modules/emi/emi-dunning.scheduler.ts
//
// Scheduled auto-dunning for overdue EMI installments (T24, docs/plans/
// phase-9-completion.md: "dunning reminders enqueued via BullMQ" — this is the
// AUTOMATIC half; POST .../installments/:id/dunning on EmiController is the MANUAL
// half the DTO's own comment calls out: "in addition to the BullMQ-scheduled ones").
//
// Mirrors ReportScheduleDispatchScheduler exactly (docs/plans/phase-7.md Wave 2 task
// #11 precedent): `setInterval` gated by `isSchedulerEnabled()` + `SchedulerRegistry`
// so it NEVER fires during unit tests (NODE_ENV=test -> disabled by default).
//
// System-wide scan (no tenant_id filter — mirrors ReportSchedulesRepository.
// findDueCandidates' identical precedent; single-tenant deployment today, see
// memory "Multi-tenancy still hardcoded").
//
// CAP: an installment stops being auto-dunned once `dunning_attempts` reaches
// MAX_AUTO_DUNNING_ATTEMPTS (5) — it stays visible as `overdue` for staff (who can still
// manually trigger further reminders via the CRM endpoint) but auto-reminders stop to
// avoid spamming an unresponsive student indefinitely.

import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { validateEnv } from "../../config/env";
import { isSchedulerEnabled } from "../../config/scheduler";
import { EmiRepository } from "./emi.repository";
import { EMI_DUNNING_PORT, type EmiDunningPort } from "./dunning/emi-dunning.port";

const INTERVAL_NAME = "emi-dunning-scan";
const MAX_AUTO_DUNNING_ATTEMPTS = 5;
const BATCH_LIMIT = 200;

@Injectable()
export class EmiDunningScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EmiDunningScheduler.name);

  constructor(
    private readonly repo: EmiRepository,
    @Inject(EMI_DUNNING_PORT) private readonly dunningPort: EmiDunningPort,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const env = validateEnv();
    if (!isSchedulerEnabled(env)) {
      this.logger.log("[EmiDunningScheduler] SCHEDULER_ENABLED is false (or NODE_ENV=test), scan interval NOT registered.");
      return;
    }

    const intervalMs = env.EMI_DUNNING_SCAN_INTERVAL_MS;
    const timer = setInterval(() => {
      void this.scanAndDun();
    }, intervalMs);
    timer.unref?.();
    this.schedulerRegistry.addInterval(INTERVAL_NAME, timer);
    this.logger.log(`[EmiDunningScheduler] registered, scanning every ${intervalMs}ms.`);
  }

  onApplicationShutdown(): void {
    if (this.schedulerRegistry.doesExist("interval", INTERVAL_NAME)) {
      this.schedulerRegistry.deleteInterval(INTERVAL_NAME);
    }
  }

  /** Public (not private) so tests/a manual "run now" trigger can invoke a full tick directly. */
  async scanAndDun(): Promise<void> {
    const now = new Date();
    let overdue: Awaited<ReturnType<EmiRepository["findOverdueCandidates"]>>;
    try {
      overdue = await this.repo.findOverdueCandidates(now, MAX_AUTO_DUNNING_ATTEMPTS, BATCH_LIMIT);
    } catch (err) {
      this.logger.error(`[EmiDunningScheduler] failed to scan overdue installments: ${String(err)}`);
      return;
    }

    for (const installment of overdue) {
      try {
        const updated = await this.repo.recordDunningAttempt(installment.id, "overdue");
        await this.dunningPort.sendReminder({
          tenantId: installment.tenantId,
          emiPlanId: installment.emiPlanId,
          installmentId: installment.id,
          installmentNo: updated.installmentNo,
          amountPaise: updated.amountPaise,
          currency: installment.emiPlan.currency,
          dueDate: updated.dueDate.toISOString().slice(0, 10),
          dunningAttempts: updated.dunningAttempts,
          toEmail: installment.emiPlan.order.student.user.email,
          studentName: installment.emiPlan.order.student.user.name,
        });
      } catch (err) {
        // Isolate each installment's failure — one bad row must never block the rest of the batch.
        this.logger.error(`[EmiDunningScheduler] unexpected error dunning installment=${installment.id}: ${String(err)}`);
      }
    }
  }
}
