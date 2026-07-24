// apps/api/src/modules/dpdp/dpdp.service.spec.ts
//
// Unit tests for DpdpService (Phase-7 Wave 2 security hardening batch B, item 2b —
// docs/plans/phase-7.md task #13, AC-64/65/66).
//
// Coverage:
//   - AC-64: erasure redacts a subject's PII inside audit_logs before/after snapshots,
//     across the OWN User row (matched by entityId) AND correlated rows on OTHER models
//     (matched by raw email/phone value, or an embedded userId field) — never a delete.
//   - AC-64: the erasure action itself writes a new audit_logs row.
//   - AC-66: unregistered models/rows are left untouched (no silent over-reach).
//   - Idempotency: a second erasure run for the same subject finds nothing left to
//     change on rows it already redacted.
//   - 404 when the subject does not exist in the caller's tenant.

import { NotFoundException } from "@nestjs/common";
import { DpdpService, redactCandidateRow } from "./dpdp.service";
import { DpdpRepository, type CandidateAuditRow } from "./dpdp.repository";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<DpdpRepository> {
  return {
    findSubject: jest.fn(),
    findCandidateAuditRows: jest.fn(),
    redactAuditRow: jest.fn(),
    recordErasureAudit: jest.fn(),
  } as unknown as Mocked<DpdpRepository>;
}

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR_ID = "22222222-2222-2222-2222-222222222222";
const SUBJECT_ID = "33333333-3333-3333-3333-333333333333";

describe("DpdpService.eraseSubjectPii", () => {
  let service: DpdpService;
  let repo: Mocked<DpdpRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new DpdpService(repo as unknown as DpdpRepository);
  });

  it("404s when the subject does not exist in the caller's tenant", async () => {
    repo.findSubject.mockResolvedValue(null);

    await expect(service.eraseSubjectPii(TENANT_ID, ACTOR_ID, SUBJECT_ID)).rejects.toThrow(NotFoundException);
    expect(repo.findCandidateAuditRows).not.toHaveBeenCalled();
  });

  it("redacts the subject's OWN User audit row (matched by entityId) and writes the erasure audit row", async () => {
    repo.findSubject.mockResolvedValue({
      id: SUBJECT_ID,
      email: "subject@example.com",
      phone: "+919876543210",
      name: "Subject Name",
    });
    const userRow: CandidateAuditRow = {
      id: "audit-1",
      entity: "User",
      entityId: SUBJECT_ID,
      before: null,
      after: { id: SUBJECT_ID, tenantId: TENANT_ID, email: "subject@example.com", phone: "+919876543210", name: "Subject Name", status: "active" },
    };
    repo.findCandidateAuditRows.mockResolvedValue([userRow]);

    const result = await service.eraseSubjectPii(TENANT_ID, ACTOR_ID, SUBJECT_ID, "1.2.3.4");

    expect(repo.redactAuditRow).toHaveBeenCalledTimes(1);
    const [, , after] = repo.redactAuditRow.mock.calls[0] as [string, unknown, Record<string, unknown>];
    expect(after.email).not.toBe("subject@example.com");
    expect(after.name).not.toBe("Subject Name");
    expect(after.status).toBe("active"); // non-PII field untouched

    expect(repo.recordErasureAudit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, actorId: ACTOR_ID, subjectUserId: SUBJECT_ID, redactedRowCount: 1, ip: "1.2.3.4" }),
    );

    expect(result).toEqual({
      subjectUserId: SUBJECT_ID,
      redactedRowCount: 1,
      alreadyRedacted: false,
      processedAt: expect.any(String),
    });
  });

  it("redacts a correlated Lead row matched by the subject's raw email (not by entityId)", async () => {
    repo.findSubject.mockResolvedValue({ id: SUBJECT_ID, email: "subject@example.com", phone: null, name: null });
    const leadRow: CandidateAuditRow = {
      id: "audit-2",
      entity: "Lead",
      entityId: "lead-1", // NOT the subject's userId — correlated via email value instead.
      before: null,
      after: { id: "lead-1", tenantId: TENANT_ID, name: "Lead Name", email: "subject@example.com", stage: "new" },
    };
    repo.findCandidateAuditRows.mockResolvedValue([leadRow]);

    await service.eraseSubjectPii(TENANT_ID, ACTOR_ID, SUBJECT_ID);

    expect(repo.redactAuditRow).toHaveBeenCalledTimes(1);
    const [, , after] = repo.redactAuditRow.mock.calls[0] as [string, unknown, Record<string, unknown>];
    expect(after.email).not.toBe("subject@example.com");
    expect(after.name).not.toBe("Lead Name"); // once matched, ALL registered fields on that row are masked
    expect(after.stage).toBe("new");
  });

  it("redacts a NotificationSuppression row matched by its embedded userId field", async () => {
    repo.findSubject.mockResolvedValue({ id: SUBJECT_ID, email: null, phone: null, name: null });
    const suppressionRow: CandidateAuditRow = {
      id: "audit-3",
      entity: "NotificationSuppression",
      entityId: "supp-1",
      before: null,
      after: { id: "supp-1", tenantId: TENANT_ID, userId: SUBJECT_ID, email: "other-address@example.com", channel: "email" },
    };
    repo.findCandidateAuditRows.mockResolvedValue([suppressionRow]);

    await service.eraseSubjectPii(TENANT_ID, ACTOR_ID, SUBJECT_ID);

    expect(repo.redactAuditRow).toHaveBeenCalledTimes(1);
  });

  it("does NOT touch an unrelated row for a different subject (no false-positive redaction)", async () => {
    repo.findSubject.mockResolvedValue({ id: SUBJECT_ID, email: "subject@example.com", phone: null, name: null });
    const unrelatedLead: CandidateAuditRow = {
      id: "audit-4",
      entity: "Lead",
      entityId: "lead-2",
      before: null,
      after: { id: "lead-2", tenantId: TENANT_ID, name: "Someone Else", email: "someone-else@example.com", stage: "new" },
    };
    repo.findCandidateAuditRows.mockResolvedValue([unrelatedLead]);

    const result = await service.eraseSubjectPii(TENANT_ID, ACTOR_ID, SUBJECT_ID);

    expect(repo.redactAuditRow).not.toHaveBeenCalled();
    expect(result.redactedRowCount).toBe(0);
    expect(result.alreadyRedacted).toBe(true);
  });

  it("is idempotent: a second run over already-redacted rows changes nothing further", async () => {
    repo.findSubject.mockResolvedValue({
      id: SUBJECT_ID,
      email: "subject@example.com",
      phone: "+919876543210",
      name: "Subject Name",
    });
    // Simulate a row that was ALREADY redacted by a prior run (values in masked shape).
    const alreadyRedactedRow: CandidateAuditRow = {
      id: "audit-1",
      entity: "User",
      entityId: SUBJECT_ID,
      before: null,
      after: { id: SUBJECT_ID, tenantId: TENANT_ID, email: "s***@e***.com", phone: "+91XXXXXX3210", name: "S***", status: "active" },
    };
    repo.findCandidateAuditRows.mockResolvedValue([alreadyRedactedRow]);

    const result = await service.eraseSubjectPii(TENANT_ID, ACTOR_ID, SUBJECT_ID);

    // entity===User && entityId===subjectUserId still forces an attempt, but every field
    // is already in its masked form, so maskPiiValue is a no-op for each — nothing changes.
    expect(repo.redactAuditRow).not.toHaveBeenCalled();
    expect(result.redactedRowCount).toBe(0);
    expect(result.alreadyRedacted).toBe(true);
  });

  it("skips a candidate row whose entity has no PII registry entry (AC-66 defensive default)", async () => {
    repo.findSubject.mockResolvedValue({ id: SUBJECT_ID, email: "subject@example.com", phone: null, name: null });
    const outcome = redactCandidateRow(
      { id: "audit-5", entity: "SomeFutureModel", entityId: "x", before: null, after: { email: "subject@example.com" } },
      SUBJECT_ID,
      new Set(["subject@example.com"]),
    );
    expect(outcome.changed).toBe(false);
  });
});
