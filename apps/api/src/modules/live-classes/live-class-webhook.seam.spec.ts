// apps/api/src/modules/live-classes/live-class-webhook.seam.spec.ts
//
// Unit tests for SyncLiveClassWebhookProcessorAdapter (docs/plans/phase-9-completion.md
// T20). Covers: meeting_started/ended status transitions, participant_joined attendance
// auto-sync (resolved by email -> enrollment -> upsertLiveAttendance, idempotent),
// recording_ready sets recordingUrl, and unresolvable providerMeetingId is a safe no-op.

import { SyncLiveClassWebhookProcessorAdapter } from "./live-class-webhook.seam";
import { LiveClassesRepository, type LiveClassRow } from "./live-classes.repository";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<LiveClassesRepository> {
  return {
    findByProviderMeetingId: jest.fn(),
    update: jest.fn(),
    findActiveEnrollmentForBatchByEmail: jest.fn(),
    upsertLiveAttendance: jest.fn(),
  } as unknown as Mocked<LiveClassesRepository>;
}

const ROW: LiveClassRow = {
  id: "lc-1",
  tenantId: "tenant-1",
  batchId: "batch-1",
  batchName: "Batch A",
  branchId: "branch-1",
  programId: "program-1",
  programTitle: "Full Stack",
  title: "Week 3",
  provider: "zoom",
  providerMeetingId: "zoom-123",
  joinUrl: null,
  startsAt: new Date("2026-01-01T10:00:00Z"),
  endsAt: new Date("2026-01-01T11:00:00Z"),
  status: "scheduled",
  recordingUrl: null,
  hostUserId: "faculty-1",
  hostName: "Prof. Rao",
  attendeeCount: 0,
  createdAt: new Date("2025-12-01T00:00:00Z"),
  updatedAt: new Date("2025-12-01T00:00:00Z"),
  deletedAt: null,
};

describe("SyncLiveClassWebhookProcessorAdapter", () => {
  let repo: Mocked<LiveClassesRepository>;
  let adapter: SyncLiveClassWebhookProcessorAdapter;

  beforeEach(() => {
    repo = mockRepository();
    adapter = new SyncLiveClassWebhookProcessorAdapter(repo as unknown as LiveClassesRepository);
  });

  it("unresolvable providerMeetingId -> safe no-op (never throws)", async () => {
    repo.findByProviderMeetingId.mockResolvedValue(null);
    await expect(
      adapter.process({ type: "meeting_started", providerMeetingId: "unknown-id", occurredAt: new Date() }),
    ).resolves.toBeUndefined();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("meeting_started transitions scheduled -> live", async () => {
    repo.findByProviderMeetingId.mockResolvedValue(ROW);
    await adapter.process({ type: "meeting_started", providerMeetingId: "zoom-123", occurredAt: new Date() });
    expect(repo.update).toHaveBeenCalledWith("lc-1", { status: "live" });
  });

  it("meeting_ended transitions live -> completed", async () => {
    repo.findByProviderMeetingId.mockResolvedValue({ ...ROW, status: "live" });
    await adapter.process({ type: "meeting_ended", providerMeetingId: "zoom-123", occurredAt: new Date() });
    expect(repo.update).toHaveBeenCalledWith("lc-1", { status: "completed" });
  });

  it("participant_joined resolves enrollment by email and writes attendance (source=live implicit in repo)", async () => {
    repo.findByProviderMeetingId.mockResolvedValue(ROW);
    repo.findActiveEnrollmentForBatchByEmail.mockResolvedValue({ enrollmentId: "enr-1" });

    const occurredAt = new Date("2026-01-01T10:02:00Z");
    await adapter.process({
      type: "participant_joined",
      providerMeetingId: "zoom-123",
      occurredAt,
      participant: { email: "student@test.com", name: "Student One" },
    });

    expect(repo.findActiveEnrollmentForBatchByEmail).toHaveBeenCalledWith("tenant-1", "batch-1", "student@test.com");
    expect(repo.upsertLiveAttendance).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      enrollmentId: "enr-1",
      liveClassId: "lc-1",
      markedAt: occurredAt,
    });
  });

  it("participant_joined with no matching enrollment -> safe no-op", async () => {
    repo.findByProviderMeetingId.mockResolvedValue(ROW);
    repo.findActiveEnrollmentForBatchByEmail.mockResolvedValue(null);

    await adapter.process({
      type: "participant_joined",
      providerMeetingId: "zoom-123",
      occurredAt: new Date(),
      participant: { email: "not-enrolled@test.com" },
    });

    expect(repo.upsertLiveAttendance).not.toHaveBeenCalled();
  });

  it("participant_joined with no participant email -> safe no-op (cannot resolve internal user)", async () => {
    repo.findByProviderMeetingId.mockResolvedValue(ROW);
    await adapter.process({ type: "participant_joined", providerMeetingId: "zoom-123", occurredAt: new Date() });
    expect(repo.findActiveEnrollmentForBatchByEmail).not.toHaveBeenCalled();
    expect(repo.upsertLiveAttendance).not.toHaveBeenCalled();
  });

  it("recording_ready sets recordingUrl (idempotent no-op when already set to the same value)", async () => {
    repo.findByProviderMeetingId.mockResolvedValue(ROW);
    await adapter.process({
      type: "recording_ready",
      providerMeetingId: "zoom-123",
      occurredAt: new Date(),
      recording: { downloadUrl: "https://zoom.example/recording/abc" },
    });
    expect(repo.update).toHaveBeenCalledWith("lc-1", { recordingUrl: "https://zoom.example/recording/abc" });

    repo.update.mockClear();
    repo.findByProviderMeetingId.mockResolvedValue({ ...ROW, recordingUrl: "https://zoom.example/recording/abc" });
    await adapter.process({
      type: "recording_ready",
      providerMeetingId: "zoom-123",
      occurredAt: new Date(),
      recording: { downloadUrl: "https://zoom.example/recording/abc" },
    });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
