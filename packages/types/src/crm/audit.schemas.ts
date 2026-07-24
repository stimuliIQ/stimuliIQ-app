// Audit logs contract — Phase 1, Wave 2 (docs/plans/phase-1.md task #2).
// Read-only: docs/03 §7.16 "audit logs (who/what/when/before-after)";
// docs/03 §20(b) acceptance criterion. No write API is contracted here —
// every mutating endpoint across the other CRM modules writes its own
// audit-log row server-side; this file only contracts the LIST/READ view.
//
// `before`/`after` are typed `Record<string, unknown>` (server-redacted —
// sensitive fields like password hashes are stripped before the row is
// written, never at read time) rather than `any`, per CLAUDE.md §3.1's
// "no `any` without an inline justification comment" — these payloads are
// genuinely heterogeneous (every entity's full diff shape) and the server
// is the only writer, so a structural `unknown` record is the correct,
// honest type here.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

export const AuditActionSchema = z.enum(["create", "update", "delete", "restore"]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

/** GET /api/v1/crm/audit-logs */
export const ListAuditLogsQuerySchema = z
  .object({
    entity: z.string().min(1).max(60).optional().describe("e.g. `student`, `batch`, `role`."),
    entityId: UuidSchema.optional(),
    actorId: UuidSchema.optional(),
    action: AuditActionSchema.optional(),
    from: IsoDateTimeSchema.optional().describe("Inclusive lower bound on createdAt."),
    to: IsoDateTimeSchema.optional().describe("Inclusive upper bound on createdAt."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuerySchema>;

export const AuditLogEntrySchema = z.object({
  id: UuidSchema,
  actorId: UuidSchema.nullable().describe("Null for system-initiated actions (e.g. scheduled jobs)."),
  actorName: z.string().nullable(),
  entity: z.string(),
  entityId: UuidSchema,
  action: AuditActionSchema,
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
