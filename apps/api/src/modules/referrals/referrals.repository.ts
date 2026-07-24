// apps/api/src/modules/referrals/referrals.repository.ts
//
// Prisma data access ONLY for `referrals` (CLAUDE.md §3.3). ReferralsService is the only
// caller. Soft-delete + audit are handled transparently by the Prisma client extensions
// (Referral is already registered in both).
//
// Reads `leads`/`users` directly for FK validation / anti-self-referral (a narrow,
// read-only cross-model lookup — the same precedent as MentorsRepository reading
// Batch/Program directly). No business logic here — see referrals.service.ts.

import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Prisma, Referral as ReferralRow, ReferralStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface ListReferralsFilters {
  tenantId: string;
  referrerUserId?: string;
  status?: ReferralStatus;
  page: number;
  pageSize: number;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
const CODE_LENGTH = 8;
const MAX_CODE_GEN_ATTEMPTS = 10;

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

@Injectable()
export class ReferralsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListReferralsFilters): Promise<{ rows: (ReferralRow & { referrer: { name: string } })[]; total: number }> {
    const where: Prisma.ReferralWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.referrerUserId ? { referrerUserId: filters.referrerUserId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.referral.findMany({
        where,
        include: { referrer: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.referral.count({ where }),
    ]);

    return { rows, total };
  }

  findById(tenantId: string, id: string): Promise<(ReferralRow & { referrer: { name: string } }) | null> {
    return this.prisma.client.referral.findFirst({
      where: { id, tenantId },
      include: { referrer: { select: { name: true } } },
    });
  }

  findByCode(tenantId: string, code: string): Promise<ReferralRow | null> {
    return this.prisma.client.referral.findFirst({ where: { tenantId, code } });
  }

  /** Generates a unique (per-tenant, among active rows) referral code, retrying on the rare collision. */
  async createForUser(tenantId: string, referrerUserId: string): Promise<ReferralRow> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_CODE_GEN_ATTEMPTS; attempt++) {
      const code = randomCode();
      const existing = await this.findByCode(tenantId, code);
      if (existing) continue; // collision — retry with a fresh random code.
      try {
        return await this.prisma.client.referral.create({ data: { tenantId, referrerUserId, code, status: "pending" } });
      } catch (err) {
        lastErr = err; // unique-index race — retry.
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Failed to generate a unique referral code after retries.");
  }

  async attachLead(id: string, leadId: string): Promise<ReferralRow> {
    return this.prisma.client.referral.update({ where: { id }, data: { referredLeadId: leadId } });
  }

  async updateStatus(id: string, status: ReferralStatus, rewardedAt: Date | null): Promise<ReferralRow> {
    return this.prisma.client.referral.update({ where: { id }, data: { status, rewardedAt } });
  }

  // ── Cross-model reads for redeem() (public, unauthenticated) ────────────────

  getTenantIdBySlug(slug: string): Promise<string | null> {
    return this.prisma.client.tenant.findUnique({ where: { slug }, select: { id: true } }).then((t) => t?.id ?? null);
  }

  findLeadContact(tenantId: string, leadId: string): Promise<{ id: string; email: string | null; phone: string } | null> {
    return this.prisma.client.lead.findFirst({
      where: { id: leadId, tenantId },
      select: { id: true, email: true, phone: true },
    });
  }

  findReferrerContact(userId: string): Promise<{ id: string; email: string; phone: string | null } | null> {
    return this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true },
    });
  }
}
