// apps/api/src/modules/content/content-intake.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). ContentIntakeService is the only caller.
// Soft-delete + audit handled transparently by the Prisma client extensions
// (`NewsletterSubscription`/`ContactSubmission`/`CareerApplication` already registered).

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

// NOTE: `status` on both `contact_submissions` and `career_applications` is a plain
// `String` column in the shipped schema (no Prisma enum — matches the CertificateTemplate
// .status / Resource.type "open editor/event-driven set" precedent), constrained at the
// API boundary by the zod enums (`ContactSubmissionStatus` / `CareerApplicationStatus`
// from @repo/types), not by the DB column type.

export interface NewsletterSubscriptionRow {
  id: string;
  email: string;
  status: string;
  unsubscribedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface ContactSubmissionRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  status: string;
  createdAt: Date;
}

export interface CareerApplicationRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  resumeStorageKey: string;
  coverLetter: string | null;
  status: string;
  createdAt: Date;
}

@Injectable()
export class ContentIntakeRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Newsletter ───────────────────────────────────────────────────────────

  /**
   * Re-subscribe-safe upsert: the DB partial-unique index on (tenant_id, email) WHERE
   * deleted_at IS NULL allows a fresh row after a prior unsubscribe (soft-delete). If an
   * ACTIVE row already exists for this email, it is reactivated in place (idempotent
   * double-subscribe) rather than erroring.
   */
  async subscribeNewsletter(tenantId: string, data: { email: string; consent: Prisma.InputJsonValue }): Promise<{ id: string }> {
    const existingActive = await this.prisma.client.newsletterSubscription.findFirst({ where: { tenantId, email: data.email, deletedAt: null } });
    if (existingActive) {
      await this.prisma.client.newsletterSubscription.update({ where: { id: existingActive.id }, data: { status: "active", unsubscribedAt: null, consent: data.consent } });
      return { id: existingActive.id };
    }
    // A previously soft-deleted (unsubscribed) row for the same email may still exist —
    // reactivate it rather than racing the partial-unique index with a fresh insert.
    const existingDeleted = await this.prisma.client.newsletterSubscription.findFirst({ where: { tenantId, email: data.email, deletedAt: { not: null } } });
    if (existingDeleted) {
      await this.prisma.client.newsletterSubscription.update({ where: { id: existingDeleted.id }, data: { status: "active", unsubscribedAt: null, consent: data.consent, deletedAt: null } });
      return { id: existingDeleted.id };
    }
    const created = await this.prisma.client.newsletterSubscription.create({ data: { tenantId, email: data.email, consent: data.consent, status: "active" } });
    return { id: created.id };
  }

  async findNewsletterSubscriptionById(id: string): Promise<NewsletterSubscriptionRow | null> {
    return this.prisma.client.newsletterSubscription.findFirst({ where: { id } });
  }

  /**
   * Mirror a newsletter signup into a campaignable CRM Lead (source="newsletter").
   *
   * This is what makes a subscriber reachable from the Campaigns engine: campaigns target
   * `leads`/`students` (never the newsletter table), and the leads segment gate reads
   * `consent.marketing_opt_in` (see campaigns.repository.findLeadsForSegment). By storing the
   * SAME server-computed consent object here, the subscriber becomes a `new`-stage lead that
   * staff can segment by source = "newsletter".
   *
   * Idempotent: one active lead per (tenant, email, source=newsletter) — a re-subscribe just
   * refreshes consent (re-opt-in) instead of stacking duplicate leads. `phone` is required by
   * the schema but the newsletter form is email-only, so it is stored empty; the email channel
   * resolves `to = email ?? phone`, so email campaigns still reach the lead.
   */
  async upsertNewsletterLead(tenantId: string, data: { email: string; consent: Prisma.InputJsonValue }): Promise<void> {
    const name = deriveLeadName(data.email);
    const existing = await this.prisma.client.lead.findFirst({
      where: { tenantId, email: data.email, source: "newsletter", deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.client.lead.update({ where: { id: existing.id }, data: { consent: data.consent } });
      return;
    }
    await this.prisma.client.lead.create({
      data: { tenantId, name, phone: "", email: data.email, source: "newsletter", stage: "new", consent: data.consent },
    });
  }

  async unsubscribeNewsletter(id: string): Promise<void> {
    await this.prisma.client.newsletterSubscription.update({ where: { id }, data: { status: "unsubscribed", unsubscribedAt: new Date() } });
    await this.prisma.client.newsletterSubscription.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  async listNewsletterSubscriptions(filters: { tenantId: string; status?: "active" | "unsubscribed"; search?: string; page: number; pageSize: number }): Promise<{ rows: NewsletterSubscriptionRow[]; total: number }> {
    const where: Prisma.NewsletterSubscriptionWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: filters.status === "unsubscribed" ? { not: null } : null,
      ...(filters.status === "active" ? { status: "active" } : {}),
      ...(filters.search ? { email: { contains: filters.search, mode: "insensitive" } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.newsletterSubscription.findMany({ where, orderBy: { createdAt: "desc" }, skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
      this.prisma.client.newsletterSubscription.count({ where }),
    ]);
    return { rows, total };
  }

  // ── Contact ──────────────────────────────────────────────────────────────

  async createContactSubmission(tenantId: string, data: { name: string; email: string; phone: string | null; subject: string | null; message: string; consent: Prisma.InputJsonValue }): Promise<{ id: string }> {
    const row = await this.prisma.client.contactSubmission.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async listContactSubmissions(filters: { tenantId: string; status?: string; search?: string; page: number; pageSize: number }): Promise<{ rows: ContactSubmissionRow[]; total: number }> {
    const where: Prisma.ContactSubmissionWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { OR: [{ name: { contains: filters.search, mode: "insensitive" } }, { email: { contains: filters.search, mode: "insensitive" } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.contactSubmission.findMany({ where, orderBy: { createdAt: "desc" }, skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
      this.prisma.client.contactSubmission.count({ where }),
    ]);
    return { rows, total };
  }

  async findContactSubmissionById(tenantId: string, id: string): Promise<ContactSubmissionRow | null> {
    return this.prisma.client.contactSubmission.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async updateContactSubmissionStatus(id: string, status: string): Promise<void> {
    await this.prisma.client.contactSubmission.update({ where: { id }, data: { status } });
  }

  // ── Careers ──────────────────────────────────────────────────────────────

  async createCareerApplication(tenantId: string, data: { name: string; email: string; phone: string | null; role: string; resumeStorageKey: string; coverLetter: string | null }): Promise<{ id: string }> {
    const row = await this.prisma.client.careerApplication.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async listCareerApplications(filters: { tenantId: string; status?: string; role?: string; search?: string; page: number; pageSize: number }): Promise<{ rows: CareerApplicationRow[]; total: number }> {
    const where: Prisma.CareerApplicationWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.search ? { OR: [{ name: { contains: filters.search, mode: "insensitive" } }, { email: { contains: filters.search, mode: "insensitive" } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.careerApplication.findMany({ where, orderBy: { createdAt: "desc" }, skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
      this.prisma.client.careerApplication.count({ where }),
    ]);
    return { rows, total };
  }

  async findCareerApplicationById(tenantId: string, id: string): Promise<CareerApplicationRow | null> {
    return this.prisma.client.careerApplication.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async updateCareerApplicationStatus(id: string, status: string): Promise<void> {
    await this.prisma.client.careerApplication.update({ where: { id }, data: { status } });
  }

  // ── Shared tenant resolution ─────────────────────────────────────────────

  async getTenantIdBySlug(slug: string): Promise<string | null> {
    const row = await this.prisma.client.tenant.findUnique({ where: { slug }, select: { id: true } });
    return row?.id ?? null;
  }
}

/** Friendly lead name from an email local-part (e.g. "jane.doe@x.com" → "Jane Doe"); falls back to a generic label. */
function deriveLeadName(email: string): string {
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return "Newsletter subscriber";
  return local
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
