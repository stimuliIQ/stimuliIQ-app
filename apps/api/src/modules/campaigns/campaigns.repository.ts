// apps/api/src/modules/campaigns/campaigns.repository.ts
//
// Prisma data access ONLY for campaigns (docs/04-trd-architecture.md §2.1).
// CampaignsService is the ONLY caller. Every query is tenant-scoped.
// No business logic here — only data access + scope filters.
//
// DATA-SCOPE (campaigns.view/create/edit/send/delete — all seeded as scope="all"):
//   The campaigns permission is Marketing/Owner/Admin only, all at scope="all".
//   There is no branch/assigned/own scoping for campaigns in P6; every query simply
//   applies tenant_id. The requireScopeContext() call in each method validates that
//   ScopeInterceptor has run (fail-closed for unanticipated paths).
//
// IDEMPOTENCY:
//   - campaign_recipients has a partial-unique on
//     (campaign_id, COALESCE(lead_id, student_id, user_id)) WHERE deleted_at IS NULL.
//     insertRecipient() catches Prisma P2002 and returns null for a no-op duplicate.
//   - Webhook updates check the current status before writing; updates to already-final
//     rows are silently skipped (idempotent no-op, AC-38).
//   - provider_message_id has an index (@@index([providerMessageId])) for fast lookup.

import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CampaignChannel, CampaignStatus, RecipientStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

// ─────────────────────────────────────────────────────────────────────────────
// Row types (internal; service maps to DTO shapes)
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignTemplateRow {
  id: string;
  tenantId: string;
  channel: CampaignChannel;
  name: string;
  subject: string | null;
  body: string;
  dltTemplateId: string | null;
  variables: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CampaignRow {
  id: string;
  tenantId: string;
  channel: CampaignChannel;
  templateId: string;
  name: string;
  segment: unknown;
  scheduleAt: Date | null;
  status: CampaignStatus;
  metrics: unknown;
  createdById: string;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  template: CampaignTemplateRow;
}

export interface CampaignRecipientRow {
  id: string;
  tenantId: string;
  campaignId: string;
  leadId: string | null;
  studentId: string | null;
  userId: string | null;
  to: string;
  status: RecipientStatus;
  providerMessageId: string | null;
  error: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface SuppressionCheckInput {
  tenantId: string;
  channel: string;
  email?: string | null;
  phone?: string | null;
  userId?: string | null;
}

export interface LeadForSegment {
  id: string;
  email: string | null;
  phone: string;
  marketingOptIn: boolean | null;
}

export interface StudentForSegment {
  id: string;
  userId: string;
  email: string | null;
  phone: string | null;
  marketingOptIn: boolean | null;
}


@Injectable()
export class CampaignsRepository {
  private readonly logger = new Logger(CampaignsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Campaign Templates ───────────────────────────────────────────────────

  async createTemplate(tenantId: string, data: {
    channel: CampaignChannel;
    name: string;
    subject?: string | null;
    body: string;
    dltTemplateId?: string | null;
    variables: unknown[];
  }): Promise<CampaignTemplateRow> {
    const row = await this.prisma.client.campaignTemplate.create({
      data: {
        tenantId,
        channel: data.channel,
        name: data.name,
        subject: data.subject ?? null,
        body: data.body,
        dltTemplateId: data.dltTemplateId ?? null,
        variables: data.variables as Prisma.JsonArray,
      },
    });
    return row as unknown as CampaignTemplateRow;
  }

  async findTemplateById(tenantId: string, id: string): Promise<CampaignTemplateRow | null> {
    const row = await this.prisma.client.campaignTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    return row as unknown as CampaignTemplateRow | null;
  }

  async listTemplates(tenantId: string, opts: {
    channel?: CampaignChannel;
    page: number;
    pageSize: number;
  }): Promise<{ rows: CampaignTemplateRow[]; total: number }> {
    const where: Prisma.CampaignTemplateWhereInput = {
      tenantId,
      deletedAt: null,
      ...(opts.channel ? { channel: opts.channel } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.campaignTemplate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
      }),
      this.prisma.client.campaignTemplate.count({ where }),
    ]);

    return { rows: rows as unknown as CampaignTemplateRow[], total };
  }

  async updateTemplate(tenantId: string, id: string, data: {
    name?: string;
    subject?: string | null;
    body?: string;
    dltTemplateId?: string | null;
    variables?: unknown[];
  }): Promise<CampaignTemplateRow | null> {
    const existing = await this.findTemplateById(tenantId, id);
    if (!existing) return null;

    const updated = await this.prisma.client.campaignTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.subject !== undefined ? { subject: data.subject } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.dltTemplateId !== undefined ? { dltTemplateId: data.dltTemplateId } : {}),
        ...(data.variables !== undefined ? { variables: data.variables as Prisma.JsonArray } : {}),
      },
    });
    return updated as unknown as CampaignTemplateRow;
  }

  async softDeleteTemplate(tenantId: string, id: string): Promise<CampaignTemplateRow | null> {
    const existing = await this.findTemplateById(tenantId, id);
    if (!existing) return null;
    const deleted = await this.prisma.client.campaignTemplate.delete({ where: { id } });
    return deleted as unknown as CampaignTemplateRow;
  }

  // ─── Campaigns ────────────────────────────────────────────────────────────

  async createCampaign(tenantId: string, data: {
    channel: CampaignChannel;
    templateId: string;
    name: string;
    segment: unknown;
    scheduleAt?: Date | null;
    createdById: string;
  }): Promise<CampaignRow> {
    const row = await this.prisma.client.campaign.create({
      data: {
        tenantId,
        channel: data.channel,
        templateId: data.templateId,
        name: data.name,
        segment: data.segment as Prisma.JsonObject,
        scheduleAt: data.scheduleAt ?? null,
        status: "draft",
        metrics: { total: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, suppressed: 0 },
        createdById: data.createdById,
      },
      include: {
        template: true,
        createdBy: { select: { name: true } },
      },
    });
    return this.mapCampaignRow(row);
  }

  async findCampaignById(tenantId: string, id: string): Promise<CampaignRow | null> {
    const row = await this.prisma.client.campaign.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        template: true,
        createdBy: { select: { name: true } },
      },
    });
    if (!row) return null;
    return this.mapCampaignRow(row);
  }

  async listCampaigns(tenantId: string, opts: {
    status?: CampaignStatus;
    channel?: CampaignChannel;
    page: number;
    pageSize: number;
  }): Promise<{ rows: CampaignRow[]; total: number }> {
    const where: Prisma.CampaignWhereInput = {
      tenantId,
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.channel ? { channel: opts.channel } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.campaign.findMany({
        where,
        include: {
          template: true,
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
      }),
      this.prisma.client.campaign.count({ where }),
    ]);

    return { rows: rows.map((r) => this.mapCampaignRow(r)), total };
  }

  async updateCampaignStatus(
    tenantId: string,
    id: string,
    status: CampaignStatus,
    extra?: Partial<{
      sentAt: Date;
      pausedAt: Date;
      cancelledAt: Date;
    }>,
  ): Promise<CampaignRow | null> {
    const existing = await this.findCampaignById(tenantId, id);
    if (!existing) return null;

    const updated = await this.prisma.client.campaign.update({
      where: { id },
      data: { status },
      include: {
        template: true,
        createdBy: { select: { name: true } },
      },
    });
    void extra; // extra timestamps tracked via metrics JSON or audit log
    return this.mapCampaignRow(updated);
  }

  async updateCampaignFields(tenantId: string, id: string, data: {
    name?: string;
    templateId?: string;
    segment?: unknown;
    scheduleAt?: Date | null;
  }): Promise<CampaignRow | null> {
    const existing = await this.findCampaignById(tenantId, id);
    if (!existing) return null;

    const updated = await this.prisma.client.campaign.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.templateId !== undefined ? { templateId: data.templateId } : {}),
        ...(data.segment !== undefined ? { segment: data.segment as Prisma.JsonObject } : {}),
        ...(data.scheduleAt !== undefined ? { scheduleAt: data.scheduleAt } : {}),
      },
      include: {
        template: true,
        createdBy: { select: { name: true } },
      },
    });
    return this.mapCampaignRow(updated);
  }

  async updateCampaignMetrics(
    tenantId: string,
    id: string,
    metrics: Record<string, number>,
  ): Promise<void> {
    await this.prisma.client.campaign.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { metrics: metrics as Prisma.JsonObject },
    });
  }

  async softDeleteCampaign(tenantId: string, id: string): Promise<CampaignRow | null> {
    const existing = await this.findCampaignById(tenantId, id);
    if (!existing) return null;
    const deleted = await this.prisma.client.campaign.delete({ where: { id } });
    return { ...existing, deletedAt: new Date() };
    void deleted;
  }

  // ─── Campaign Recipients ──────────────────────────────────────────────────

  /**
   * Insert a single recipient row. Returns null if the partial-unique constraint fires
   * (same campaign + same recipient entity already exists — idempotent duplicate, AC-28).
   * Callers treat null as a silent no-op.
   */
  async insertRecipient(tenantId: string, data: {
    campaignId: string;
    leadId?: string | null;
    studentId?: string | null;
    userId?: string | null;
    to: string;
  }): Promise<CampaignRecipientRow | null> {
    try {
      const row = await this.prisma.client.campaignRecipient.create({
        data: {
          tenantId,
          campaignId: data.campaignId,
          leadId: data.leadId ?? null,
          studentId: data.studentId ?? null,
          userId: data.userId ?? null,
          to: data.to,
          status: "queued",
        },
      });
      return row as unknown as CampaignRecipientRow;
    } catch (err) {
      // P2002 = Prisma unique constraint violation (the partial-unique on campaign+recipient).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        this.logger.debug(
          `[CampaignsRepo] insertRecipient: duplicate (campaign=${data.campaignId}) — no-op.`,
        );
        return null;
      }
      throw err;
    }
  }

  /**
   * T5/R2 (docs/plans/phase-9-completion.md): bounded by `limit` (`take:`) — the caller
   * (CampaignsService.dispatchQueuedRecipients) processes queued recipients in a single
   * synchronous request, so an unbounded fetch here would let one HTTP request loop over
   * an arbitrarily large campaign. `orderBy: createdAt asc` guarantees each capped call
   * makes forward progress (earliest-queued rows first) rather than reprocessing the same
   * page. `limit` is required (no unbounded default) so every call site must pick a cap
   * explicitly — see CAMPAIGN_SEND_BATCH_SIZE (config/env.ts).
   */
  async findQueuedRecipients(
    campaignId: string,
    tenantId: string,
    limit: number,
  ): Promise<CampaignRecipientRow[]> {
    const rows = await this.prisma.client.campaignRecipient.findMany({
      where: { campaignId, tenantId, status: "queued", deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return rows as unknown as CampaignRecipientRow[];
  }

  /** T5/R2: total queued-recipient count, used to log how many remain after a capped batch. */
  async countQueuedRecipients(campaignId: string, tenantId: string): Promise<number> {
    return this.prisma.client.campaignRecipient.count({
      where: { campaignId, tenantId, status: "queued", deletedAt: null },
    });
  }

  async findRecipientsByStatus(
    campaignId: string,
    tenantId: string,
    opts: { status?: RecipientStatus; page: number; pageSize: number },
  ): Promise<{ rows: CampaignRecipientRow[]; total: number }> {
    const where: Prisma.CampaignRecipientWhereInput = {
      campaignId,
      tenantId,
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.campaignRecipient.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
      }),
      this.prisma.client.campaignRecipient.count({ where }),
    ]);
    return { rows: rows as unknown as CampaignRecipientRow[], total };
  }

  async findRecipientById(
    tenantId: string,
    id: string,
  ): Promise<CampaignRecipientRow | null> {
    const row = await this.prisma.client.campaignRecipient.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    return row as unknown as CampaignRecipientRow | null;
  }

  /**
   * Lookup a recipient by provider_message_id for webhook ingestion.
   * Used by handleWebhookEvent to find the row to update.
   */
  async findRecipientByProviderMessageId(
    providerMessageId: string,
  ): Promise<CampaignRecipientRow | null> {
    const row = await this.prisma.client.campaignRecipient.findFirst({
      where: { providerMessageId, deletedAt: null },
    });
    return row as unknown as CampaignRecipientRow | null;
  }

  /**
   * Update a recipient's status + timestamps after dispatch or webhook receipt.
   * Idempotent: if the row is already in a final state (delivered/read/failed),
   * this does NOT downgrade the status (AC-38: duplicate webhook = no-op).
   *
   * The final-state guard is applied by the caller (CampaignsService) before calling this.
   */
  async updateRecipientStatus(
    tenantId: string,
    id: string,
    data: {
      status: RecipientStatus;
      providerMessageId?: string;
      error?: string | null;
      sentAt?: Date | null;
      deliveredAt?: Date | null;
      readAt?: Date | null;
    },
  ): Promise<CampaignRecipientRow | null> {
    try {
      const updated = await this.prisma.client.campaignRecipient.update({
        where: { id },
        data: {
          status: data.status,
          ...(data.providerMessageId !== undefined ? { providerMessageId: data.providerMessageId } : {}),
          ...(data.error !== undefined ? { error: data.error } : {}),
          ...(data.sentAt !== undefined ? { sentAt: data.sentAt } : {}),
          ...(data.deliveredAt !== undefined ? { deliveredAt: data.deliveredAt } : {}),
          ...(data.readAt !== undefined ? { readAt: data.readAt } : {}),
        },
      });
      return updated as unknown as CampaignRecipientRow;
    } catch {
      return null;
    }
  }

  /**
   * Bulk-update all 'queued' recipients for a campaign to 'failed'
   * with a given error. Used for campaign cancel (AC-36).
   */
  async bulkFailQueuedRecipients(
    campaignId: string,
    tenantId: string,
    error: string,
  ): Promise<number> {
    const result = await this.prisma.client.campaignRecipient.updateMany({
      where: { campaignId, tenantId, status: "queued", deletedAt: null },
      data: { status: "failed", error },
    });
    return result.count;
  }

  /**
   * Count recipients by status for a campaign (used to recompute metrics).
   */
  async countRecipientsByStatus(
    campaignId: string,
    tenantId: string,
  ): Promise<Record<RecipientStatus | "total" | "suppressed", number>> {
    const groups = await this.prisma.client.campaignRecipient.groupBy({
      by: ["status"],
      where: { campaignId, tenantId, deletedAt: null },
      _count: { status: true },
    });

    const counts: Record<string, number> = {
      total: 0,
      queued: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      suppressed: 0,
    };

    for (const g of groups) {
      counts[g.status] = g._count.status;
      counts["total"] = (counts["total"] ?? 0) + g._count.status;
    }

    // Count suppressed (a subset of failed where error='suppressed')
    const suppressedCount = await this.prisma.client.campaignRecipient.count({
      where: { campaignId, tenantId, status: "failed", error: "suppressed", deletedAt: null },
    });
    counts["suppressed"] = suppressedCount;

    return counts as Record<RecipientStatus | "total" | "suppressed", number>;
  }

  // ─── Suppression list ────────────────────────────────────────────────────

  /**
   * Check if any suppression record exists for the given address + channel.
   * Rule C-2: checked before every send. NEVER returns the internal suppression row.
   */
  async isSuppressed(input: SuppressionCheckInput): Promise<boolean> {
    const { tenantId, channel, email, phone, userId } = input;

    const orConditions: Prisma.NotificationSuppressionWhereInput[] = [];
    if (email) orConditions.push({ tenantId, channel: channel as "email", email });
    if (phone) orConditions.push({ tenantId, channel: channel as "sms" | "whatsapp", phone });
    if (userId) orConditions.push({ tenantId, channel: channel as "email" | "sms" | "whatsapp" | "in_app", userId });

    if (orConditions.length === 0) return false;

    const count = await this.prisma.client.notificationSuppression.count({
      where: {
        deletedAt: null,
        OR: orConditions,
      },
    });
    return count > 0;
  }

  /**
   * Insert a bounce/complaint suppression row IDEMPOTENTLY (Phase-7 Wave 2 security
   * hardening batch A, item 2b — closes part of P6 M-3, AC-60: "bounce→suppression
   * transition is strictly monotonic and idempotent under out-of-order delivery").
   *
   * Backed by a DB-level partial-unique index on (tenant_id, channel, email) and
   * (tenant_id, channel, phone) WHERE deleted_at IS NULL (migration
   * 20260707070000_security_hardening_suppression_unique — raw SQL, not expressible via
   * Prisma's `@@unique`, matching the campaign_recipients partial-unique precedent).
   *
   * Returns true if a NEW row was inserted, false if an active suppression already
   * existed for this (tenant, channel, address) — a P2002 unique-constraint violation is
   * caught and treated as a no-op, exactly mirroring insertRecipient()'s existing pattern
   * above. Concurrent/replayed/out-of-order bounce events for the same recipient can
   * never produce more than one active suppression row.
   */
  async createBounceSuppression(input: {
    tenantId: string;
    email: string | null;
    phone: string | null;
    channel: "email" | "sms" | "whatsapp" | "in_app";
  }): Promise<boolean> {
    try {
      await this.prisma.client.notificationSuppression.create({
        data: {
          tenantId: input.tenantId,
          email: input.email,
          phone: input.phone,
          channel: input.channel,
          reason: "bounce",
        },
      });
      return true;
    } catch (err) {
      // P2002 = Prisma unique constraint violation (the partial-unique on
      // tenant+channel+email/phone) — idempotent no-op, matching insertRecipient().
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        this.logger.debug(
          `[CampaignsRepo] createBounceSuppression: duplicate (tenant=${input.tenantId} channel=${input.channel}) — no-op.`,
        );
        return false;
      }
      throw err;
    }
  }

  // ─── Segment materialization helpers (leads + students) ──────────────────

  /**
   * Materialize leads matching segment filters.
   * Rule C-1: ALWAYS applies marketing_opt_in = true. Non-bypassable.
   */
  async findLeadsForSegment(tenantId: string, opts: {
    stages?: string[];
    programIds?: string[];
    statuses?: string[];
    sources?: string[];
    page: number;
    pageSize: number;
  }): Promise<{ rows: LeadForSegment[]; total: number }> {
    const where: Prisma.LeadWhereInput = {
      tenantId,
      deletedAt: null,
      // Rule C-1: ALWAYS enforce marketing consent. Non-bypassable (AC-29, AC-42).
      consent: {
        path: ["marketing_opt_in"],
        equals: true,
      },
      ...(opts.stages?.length ? { stage: { in: opts.stages as Prisma.EnumLeadStageFilter["in"] } } : {}),
      ...(opts.programIds?.length ? { programInterestId: { in: opts.programIds } } : {}),
      ...(opts.statuses?.length ? { stage: { in: opts.statuses as Prisma.EnumLeadStageFilter["in"] } } : {}),
      ...(opts.sources?.length ? { source: { in: opts.sources } } : {}),
    };

    const [leads, total] = await Promise.all([
      this.prisma.client.lead.findMany({
        where,
        select: { id: true, email: true, phone: true, consent: true },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.client.lead.count({ where }),
    ]);

    return {
      rows: leads.map((l) => ({
        id: l.id,
        email: l.email,
        phone: l.phone,
        marketingOptIn: (l.consent as Record<string, unknown> | null)?.marketing_opt_in as boolean | null ?? null,
      })),
      total,
    };
  }

  /**
   * Materialize students matching segment filters.
   * Rule C-1: ALWAYS applies marketing_opt_in = true on linked lead/booking consent.
   */
  async findStudentsForSegment(tenantId: string, opts: {
    programIds?: string[];
    batchIds?: string[];
    statuses?: string[];
    page: number;
    pageSize: number;
  }): Promise<{ rows: StudentForSegment[]; total: number }> {
    const where: Prisma.StudentProfileWhereInput = {
      tenantId,
      deletedAt: null,
      ...(opts.batchIds?.length ? {
        enrollments: {
          some: {
            batchId: { in: opts.batchIds },
            deletedAt: null,
          },
        },
      } : {}),
      ...(opts.programIds?.length ? {
        enrollments: {
          some: {
            batch: { programId: { in: opts.programIds } },
            deletedAt: null,
          },
        },
      } : {}),
      ...(opts.statuses?.length ? {
        enrollments: {
          some: {
            status: { in: opts.statuses as Prisma.EnumEnrollmentStatusFilter["in"] },
            deletedAt: null,
          },
        },
      } : {}),
      // Rule C-1: enforce marketing consent on the student's converted-from lead.
      // Students without a lead consent record still need opt-in (no-lead students are
      // excluded — the relation filter requires a matching converted lead with opt-in).
      convertedFromLead: {
        consent: {
          path: ["marketing_opt_in"],
          equals: true,
        },
      },
    };

    const [students, total] = await Promise.all([
      this.prisma.client.studentProfile.findMany({
        where,
        select: {
          id: true,
          user: { select: { id: true, email: true, phone: true } },
          convertedFromLead: { select: { consent: true } },
        },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.client.studentProfile.count({ where }),
    ]);

    return {
      rows: students.map((s) => ({
        id: s.id,
        userId: s.user.id,
        email: s.user.email,
        phone: s.user.phone,
        marketingOptIn: (s.convertedFromLead?.consent as Record<string, unknown> | null)?.marketing_opt_in as boolean | null ?? null,
      })),
      total,
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private mapCampaignRow(
    row: Prisma.CampaignGetPayload<{ include: { template: true; createdBy: { select: { name: true } } } }>,
  ): CampaignRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      channel: row.channel,
      templateId: row.templateId,
      name: row.name,
      segment: row.segment,
      scheduleAt: row.scheduleAt,
      status: row.status,
      metrics: row.metrics,
      createdById: row.createdById,
      createdByName: row.createdBy.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      template: {
        id: row.template.id,
        tenantId: row.template.tenantId,
        channel: row.template.channel,
        name: row.template.name,
        subject: row.template.subject,
        body: row.template.body,
        dltTemplateId: row.template.dltTemplateId,
        variables: row.template.variables,
        createdAt: row.template.createdAt,
        updatedAt: row.template.updatedAt,
        deletedAt: row.template.deletedAt,
      },
    };
  }
}
