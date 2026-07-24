// apps/api/src/modules/dpdp/dpdp.service.ts
//
// Business logic for the DPDP ("right to be forgotten") erasure action (Phase-7 Wave 2
// security hardening batch B, item 2b — docs/plans/phase-7.md task #13,
// docs/specs/phase-7-analytics-hardening.md WS-E AC-64/65/66, Rule H-5).
//
// SCOPE (deliberately narrow — read this before extending):
//   This does NOT delete the subject's live business rows (User, enrollments, orders,
//   certificates) — per AC-64's edge case, those are legitimate financial/academic
//   records and stay intact. This action ONLY redacts direct-identifier PII (email,
//   phone, name) inside EXISTING `audit_logs` before/after snapshots that predate the
//   write-time masking added alongside this file (see
//   apps/api/src/prisma/audit.extension.ts's PII_FIELD_REGISTRY — every NEW audit row is
//   already masked at write time; this job is the one-time catch-up for HISTORICAL rows,
//   plus the durable mechanism an erasure request invokes going forward for any row that
//   slips through — e.g. a row written by a future caller who forgot to route through the
//   extended Prisma client).
//
// The append-only guarantee (Rule H-5) is preserved: `audit_logs` ROWS are never deleted
// here, only specific PII field VALUES inside their JSON snapshots are overwritten with
// the SAME masking transform the write-time path uses (never a plain deletion of the
// field either — a masked placeholder survives, so a future reader still sees "this row
// had a phone number", just not which one).
//
// MATCHING STRATEGY (AC-64/66):
//   - Any audit_logs row where `entity = 'User' AND entity_id = subjectUserId` is
//     ALWAYS redacted (it is unambiguously "about" the subject).
//   - For every OTHER PII-bearing model (Lead, NotificationSuppression, CampaignRecipient,
//     ReportSchedule), a row is redacted when a registered field's RAW value equals one of
//     the subject's own current email/phone, OR the snapshot carries a `userId` field
//     that equals the subjectUserId (NotificationSuppression rows carry this).
//   - `name` fields are never used to MATCH a row (too many false positives on common
//     names) — they are only ever a field that gets masked once a row is already
//     confirmed to be about the subject by one of the rules above.
//
// IDEMPOTENCY: running this twice for the same subject is safe. A field that is already
// masked no longer matches its original raw-value shape, so `maskPiiValue` re-applied to
// an already-masked value is a no-op (the masked form doesn't match the email/phone regex
// the masker itself looks for) — the second run finds nothing left to change on rows it
// already touched.

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { DpdpErasureResponse } from "@repo/types";
import { DpdpRepository, type CandidateAuditRow } from "./dpdp.repository";
import { PII_FIELD_REGISTRY, maskPiiValue } from "../../prisma/audit.extension";

@Injectable()
export class DpdpService {
  private readonly logger = new Logger(DpdpService.name);

  constructor(private readonly repo: DpdpRepository) {}

  async eraseSubjectPii(
    tenantId: string,
    actorId: string,
    subjectUserId: string,
    ip?: string,
  ): Promise<DpdpErasureResponse> {
    const subject = await this.repo.findSubject(tenantId, subjectUserId);
    if (!subject) {
      throw new NotFoundException({ code: "dpdp.subject_not_found", title: "Subject not found" });
    }

    const identifierValues = new Set<string>();
    if (subject.email) identifierValues.add(subject.email);
    if (subject.phone) identifierValues.add(subject.phone);

    const rows = await this.repo.findCandidateAuditRows(tenantId);
    let redactedRowCount = 0;

    for (const row of rows) {
      const outcome = redactCandidateRow(row, subjectUserId, identifierValues);
      if (outcome.changed) {
        await this.repo.redactAuditRow(row.id, outcome.before, outcome.after);
        redactedRowCount++;
      }
    }

    await this.repo.recordErasureAudit({ tenantId, actorId, subjectUserId, redactedRowCount, ip });

    this.logger.log(
      `[DpdpService] erasure processed subjectUserId=${subjectUserId.slice(0, 8)}... redactedRowCount=${redactedRowCount}`,
    );

    return {
      subjectUserId,
      redactedRowCount,
      alreadyRedacted: redactedRowCount === 0,
      processedAt: new Date().toISOString(),
    };
  }
}

// ─── Pure redaction logic (exported for direct unit testing) ─────────────────────────

interface RedactOutcome {
  before: unknown;
  after: unknown;
  changed: boolean;
}

export function redactCandidateRow(
  row: CandidateAuditRow,
  subjectUserId: string,
  identifierValues: ReadonlySet<string>,
): RedactOutcome {
  const registry = PII_FIELD_REGISTRY[row.entity];
  if (!registry) {
    return { before: row.before, after: row.after, changed: false };
  }

  const isSubjectOwnUserRow = row.entity === "User" && row.entityId === subjectUserId;

  const beforeResult = redactSnapshot(registry, row.before, subjectUserId, identifierValues, isSubjectOwnUserRow);
  const afterResult = redactSnapshot(registry, row.after, subjectUserId, identifierValues, isSubjectOwnUserRow);

  return {
    before: beforeResult.snapshot,
    after: afterResult.snapshot,
    changed: beforeResult.changed || afterResult.changed,
  };
}

function redactSnapshot(
  registry: Readonly<Record<string, "email" | "phone" | "contact" | "name">>,
  snapshot: unknown,
  subjectUserId: string,
  identifierValues: ReadonlySet<string>,
  forceRedact: boolean,
): { snapshot: unknown; changed: boolean } {
  if (!snapshot || typeof snapshot !== "object") {
    return { snapshot, changed: false };
  }
  const obj = snapshot as Record<string, unknown>;

  const matchesByIdentifierValue = Object.entries(registry).some(([field, kind]) => {
    if (kind === "name") return false; // never match-by-value on name (see file header).
    const value = obj[field];
    return typeof value === "string" && identifierValues.has(value);
  });
  const matchesByEmbeddedUserId = typeof obj["userId"] === "string" && obj["userId"] === subjectUserId;

  if (!forceRedact && !matchesByIdentifierValue && !matchesByEmbeddedUserId) {
    return { snapshot, changed: false };
  }

  let changed = false;
  const out: Record<string, unknown> = { ...obj };
  for (const [field, kind] of Object.entries(registry)) {
    if (field in out) {
      const original = out[field];
      const masked = maskPiiValue(kind, original);
      if (masked !== original) {
        out[field] = masked;
        changed = true;
      }
    }
  }
  return { snapshot: out, changed };
}
