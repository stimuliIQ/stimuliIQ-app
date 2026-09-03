// apps/api/src/modules/campaigns/campaign-schedule.scheduler.ts
//
// Sends campaigns whose scheduled moment has arrived.
//
// WHY THIS EXISTS. `Campaign.scheduleAt` has been in the schema since P6. The CRM's
// campaign builder makes picking a send time a REQUIRED step, the detail drawer renders
// "Scheduled: <date>", the service validates that the date is in the future, and
// `scheduled` is handled as a first-class status throughout `campaigns.service.ts`.
// Nothing polled for it. A campaign saved as scheduled sat at `scheduled` forever and
// went to nobody — the only thing that ever sent one was a human pressing Send. The
// symptom was recorded in `docs/live-issues.md` ("Scheduled campaigns also never fire, as
// nothing polls for them") and the missing piece was always this file.
//
// A date picker that records a date and does nothing with it is the same trap as
// `stats.headline` (P10-2) and the `job_openings` role editor (P14): a control that looks
// like it acts.
//
// SHAPE. Mirrors `EmiDunningScheduler` and `ReportScheduleDispatchScheduler` exactly:
// `setInterval` gated by `isSchedulerEnabled()` and registered with `SchedulerRegistry`,
// so it NEVER fires during unit tests (NODE_ENV=test disables it) and stops cleanly on
// shutdown. Cross-tenant scan, like every other scheduler here.
//
// WHO IT SENDS AS. `sendCampaign` takes an actor for the audit trail, and a cron has no
// human. It uses the campaign's OWN `createdById` — the person who scheduled it IS the
// person who sent it; they chose the moment as much as the content. Attributing it to a
// synthetic "system" actor would lose the only accountable name there is.
//
// FAILURE ISOLATION. One campaign's failure must never block the rest of the batch, and
// must never leave the sweep retrying the same broken campaign every tick forever:
// `sendCampaign` moves a campaign to `sending` before it dispatches anything, so a
// campaign that throws mid-send is no longer `scheduled` and drops out of this query. It
// is then visible in the CRM as `sending` with its metrics, which is a state a human can
// act on — the honest outcome for "we started and something went wrong".

import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { validateEnv } from "../../config/env";
import { isSchedulerEnabled } from "../../config/scheduler";
import { CampaignsRepository } from "./campaigns.repository";
import { CampaignsService } from "./campaigns.service";

const INTERVAL_NAME = "campaign-schedule-scan";
/** Bounded per tick — a defensive ceiling, not an expected steady-state volume. */
const BATCH_LIMIT = 25;

@Injectable()
export class CampaignScheduleScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CampaignScheduleScheduler.name);

  constructor(
    private readonly repo: CampaignsRepository,
    private readonly service: CampaignsService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const env = validateEnv();
    if (!isSchedulerEnabled(env)) {
      this.logger.log(
        "[CampaignScheduleScheduler] SCHEDULER_ENABLED is false (or NODE_ENV=test), scan interval NOT registered.",
      );
      return;
    }

    const intervalMs = env.CAMPAIGN_SCHEDULE_SCAN_INTERVAL_MS;
    const timer = setInterval(() => {
      void this.scanAndSend();
    }, intervalMs);
    timer.unref?.();
    this.schedulerRegistry.addInterval(INTERVAL_NAME, timer);
    this.logger.log(`[CampaignScheduleScheduler] registered, scanning every ${intervalMs}ms.`);
  }

  onApplicationShutdown(): void {
    if (this.schedulerRegistry.doesExist("interval", INTERVAL_NAME)) {
      this.schedulerRegistry.deleteInterval(INTERVAL_NAME);
    }
  }

  /** Public so a test (or a future "run now" trigger) can drive one full tick directly. */
  async scanAndSend(): Promise<void> {
    let due: Awaited<ReturnType<CampaignsRepository["findDueScheduledCampaigns"]>>;
    try {
      due = await this.repo.findDueScheduledCampaigns(new Date(), BATCH_LIMIT);
    } catch (err) {
      this.logger.error(`[CampaignScheduleScheduler] failed to scan for due campaigns: ${String(err)}`);
      return;
    }

    if (due.length === 0) return;
    this.logger.log(`[CampaignScheduleScheduler] ${due.length} scheduled campaign(s) due.`);

    for (const campaign of due) {
      try {
        await this.service.sendCampaign(campaign.tenantId, campaign.createdById, campaign.id);
        this.logger.log(`[CampaignScheduleScheduler] sent scheduled campaign id=${campaign.id}`);
      } catch (err) {
        // Isolated per campaign — see FAILURE ISOLATION in the header for why this does
        // not turn into an infinite retry.
        this.logger.error(
          `[CampaignScheduleScheduler] scheduled send failed for campaign id=${campaign.id}: ${String(err)}`,
        );
      }
    }
  }
}
