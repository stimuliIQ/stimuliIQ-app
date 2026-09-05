// Prisma access for the transactional-email overrides. EmailTemplateService is the only
// caller. Soft-delete + audit are handled by the Prisma client extensions (EmailTemplate is
// registered in both).
import { Injectable } from "@nestjs/common";
import type { EmailTemplate as EmailTemplateRow } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";

@Injectable()
export class EmailTemplatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every live override for this tenant. Absent keys fall back to the code default. */
  findAll(tenantId: string): Promise<EmailTemplateRow[]> {
    return this.prisma.client.emailTemplate.findMany({ where: { tenantId } });
  }

  findByKey(tenantId: string, key: string): Promise<EmailTemplateRow | null> {
    return this.prisma.client.emailTemplate.findFirst({ where: { tenantId, key } });
  }

  /**
   * Write the override, reviving a previously reset one.
   *
   * UPSERT, not create-or-update by hand: `(tenant_id, key)` is a FULL unique, so a row that
   * was reset (soft-deleted) still occupies the slot and a plain create would hit P2002 —
   * the trap videos.lesson_id has. `upsert` is also the one write softDeleteExtension passes
   * through untouched, so it matches the row the extension's own reads cannot see, and
   * clearing `deletedAt` here is what brings it back.
   */
  upsert(
    tenantId: string,
    key: string,
    data: { subject: string; heading: string; body: string; footnote: string | null },
  ): Promise<EmailTemplateRow> {
    return this.prisma.client.emailTemplate.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, ...data },
      update: { ...data, deletedAt: null },
    });
  }

  /** Soft-delete the override so the code default takes over again. */
  async remove(id: string): Promise<void> {
    await this.prisma.client.emailTemplate.delete({ where: { id } });
  }
}
