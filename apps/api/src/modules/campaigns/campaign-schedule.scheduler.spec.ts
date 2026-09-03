// apps/api/src/modules/campaigns/campaign-schedule.scheduler.spec.ts
//
// `Campaign.scheduleAt` was written, validated, displayed and handled as a first-class
// status since P6, and nothing ever polled for it — a campaign saved as scheduled went to
// nobody, while the CRM builder made picking a date a required step. These pin the sweep
// that closes it, and the two properties that make it safe to run every minute.

import { SchedulerRegistry } from "@nestjs/schedule";
import { CampaignScheduleScheduler } from "./campaign-schedule.scheduler";
import type { CampaignsRepository } from "./campaigns.repository";
import type { CampaignsService } from "./campaigns.service";

function makeScheduler(overrides: {
  findDueScheduledCampaigns?: jest.Mock;
  sendCampaign?: jest.Mock;
} = {}) {
  const findDueScheduledCampaigns = overrides.findDueScheduledCampaigns ?? jest.fn().mockResolvedValue([]);
  const sendCampaign = overrides.sendCampaign ?? jest.fn().mockResolvedValue(undefined);
  const scheduler = new CampaignScheduleScheduler(
    { findDueScheduledCampaigns } as unknown as CampaignsRepository,
    { sendCampaign } as unknown as CampaignsService,
    new SchedulerRegistry(),
  );
  return { scheduler, findDueScheduledCampaigns, sendCampaign };
}

describe("CampaignScheduleScheduler", () => {
  it("sends every campaign the query returns", async () => {
    const { scheduler, sendCampaign } = makeScheduler({
      findDueScheduledCampaigns: jest.fn().mockResolvedValue([
        { id: "camp-1", tenantId: "tenant-1", createdById: "user-a" },
        { id: "camp-2", tenantId: "tenant-1", createdById: "user-b" },
      ]),
    });

    await scheduler.scanAndSend();

    expect(sendCampaign).toHaveBeenCalledTimes(2);
    // Attributed to whoever SCHEDULED it, not to a synthetic system actor: they chose the
    // moment as much as the content, and it is the only accountable name there is.
    expect(sendCampaign).toHaveBeenNthCalledWith(1, "tenant-1", "user-a", "camp-1");
    expect(sendCampaign).toHaveBeenNthCalledWith(2, "tenant-1", "user-b", "camp-2");
  });

  it("does nothing, quietly, when nothing is due", async () => {
    const { scheduler, sendCampaign } = makeScheduler();
    await scheduler.scanAndSend();
    expect(sendCampaign).not.toHaveBeenCalled();
  });

  // One bad campaign must not strand the rest of the batch behind it.
  it("keeps going when one campaign's send throws", async () => {
    const sendCampaign = jest
      .fn()
      .mockRejectedValueOnce(new Error("template missing a DLT id"))
      .mockResolvedValueOnce(undefined);
    const { scheduler } = makeScheduler({
      findDueScheduledCampaigns: jest.fn().mockResolvedValue([
        { id: "broken", tenantId: "tenant-1", createdById: "user-a" },
        { id: "fine", tenantId: "tenant-1", createdById: "user-a" },
      ]),
      sendCampaign,
    });

    await expect(scheduler.scanAndSend()).resolves.toBeUndefined();
    expect(sendCampaign).toHaveBeenCalledTimes(2);
  });

  it("survives the scan query itself failing", async () => {
    const { scheduler, sendCampaign } = makeScheduler({
      findDueScheduledCampaigns: jest.fn().mockRejectedValue(new Error("db unreachable")),
    });

    await expect(scheduler.scanAndSend()).resolves.toBeUndefined();
    expect(sendCampaign).not.toHaveBeenCalled();
  });

  // The interval must never be registered under NODE_ENV=test — the whole unit suite
  // would otherwise start firing real sends at whatever database it is pointed at.
  it("registers no interval when the scheduler is disabled", () => {
    const registry = new SchedulerRegistry();
    const scheduler = new CampaignScheduleScheduler(
      { findDueScheduledCampaigns: jest.fn() } as unknown as CampaignsRepository,
      { sendCampaign: jest.fn() } as unknown as CampaignsService,
      registry,
    );

    scheduler.onModuleInit();

    expect(registry.doesExist("interval", "campaign-schedule-scan")).toBe(false);
  });
});
