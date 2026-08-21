// apps/api/src/modules/notifications/dispatch/bullmq-notification-dispatch.adapter.spec.ts
//
// Unit test for BullMqNotificationDispatchAdapter (docs/plans/phase-9-completion.md
// T18 / R1). `bullmq`'s `Queue` class is MOCKED, this suite asserts the producer-side
// contract (enqueue with the right name/jobId/options, return fast) WITHOUT opening any
// real Redis connection.

const addMock = jest.fn().mockResolvedValue({ id: "job-1" });

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({
    name,
    add: addMock,
  })),
}));

jest.mock("../../../config/env", () => ({
  validateEnv: () => ({ REDIS_URL: "redis://localhost:6379" }),
}));

import { BullMqNotificationDispatchAdapter } from "./bullmq-notification-dispatch.adapter";
import type { ChannelSendJob } from "./notification-dispatch.port";

describe("BullMqNotificationDispatchAdapter", () => {
  beforeEach(() => {
    addMock.mockClear();
  });

  it("enqueues the job with jobId=dedupeKey and the fire-and-forget job options", async () => {
    const adapter = new BullMqNotificationDispatchAdapter();
    const job: ChannelSendJob = {
      channel: "email",
      dedupeKey: "notif-1:email",
      toEmail: "student@example.com",
      subject: "Hi",
      body: "<p>hi</p>",
    };

    const result = await adapter.dispatch(job);

    expect(addMock).toHaveBeenCalledTimes(1);
    const [name, data, opts] = addMock.mock.calls[0] as [string, ChannelSendJob, Record<string, unknown>];
    expect(name).toBe("email");
    expect(data).toBe(job);
    expect(opts.jobId).toBe("notif-1:email");
    expect(opts.attempts).toBeGreaterThan(1);

    // Producer returns fast, accepted for async processing, not a delivery guarantee.
    expect(result).toEqual({ dispatched: true, skipped: false });
  });

  it("never blocks on the actual provider call (no MailProvider/SmsProvider dependency)", () => {
    // BullMqNotificationDispatchAdapter has zero constructor dependencies on
    // MAIL_PROVIDER/WHATSAPP_PROVIDER/SMS_PROVIDER, the real send happens in the worker.
    expect(() => new BullMqNotificationDispatchAdapter()).not.toThrow();
  });
});
