// apps/api/src/modules/content/faculty-bios.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). FacultyBiosService is the only caller.
// Soft-delete + audit handled transparently by the Prisma client extensions.

import { Injectable } from "@nestjs/common";
import type { ContentStatus as PrismaContentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveTenantIdCached } from "../../common/tenant/tenant-id-cache";

export interface FacultyBioRow {
  id: string;
  facultyProfileId: string | null;
  name: string;
  photoKey: string | null;
  title: string | null;
  bio: string;
  socialLinks: Prisma.JsonValue | null;
  status: PrismaContentStatus;
  order: number;
  createdAt: Date;
}

@Injectable()
export class FacultyBiosRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: { tenantId: string; status?: PrismaContentStatus; page: number; pageSize: number }): Promise<{ rows: FacultyBioRow[]; total: number }> {
    const where: Prisma.FacultyBioWhereInput = { tenantId: filters.tenantId, deletedAt: null, ...(filters.status ? { status: filters.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.client.facultyBio.findMany({ where, orderBy: [{ order: "asc" }, { createdAt: "desc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
      this.prisma.client.facultyBio.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<FacultyBioRow | null> {
    return this.prisma.client.facultyBio.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async listPublished(tenantId: string): Promise<FacultyBioRow[]> {
    return this.prisma.client.facultyBio.findMany({ where: { tenantId, status: "published", deletedAt: null }, orderBy: [{ order: "asc" }, { createdAt: "desc" }] });
  }

  async create(
    tenantId: string,
    data: { facultyProfileId: string | null; name: string; photoKey: string | null; title: string | null; bio: string; socialLinks: Prisma.InputJsonValue | undefined; status: PrismaContentStatus; order: number },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.facultyBio.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async update(
    id: string,
    patch: Partial<{ facultyProfileId: string | null; name: string; photoKey: string | null; title: string | null; bio: string; socialLinks: Prisma.InputJsonValue; status: PrismaContentStatus; order: number }>,
  ): Promise<void> {
    await this.prisma.client.facultyBio.update({ where: { id }, data: patch });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.facultyBio.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  async getTenantIdBySlug(slug: string): Promise<string | null> {
    // Memoised per process — the slug is a compile-time constant and this is a
    // cross-region round trip. See common/tenant/tenant-id-cache.ts.
    return resolveTenantIdCached(slug, async () => {
      const row = await this.prisma.client.tenant.findUnique({
        where: { slug },
        select: { id: true },
      });
      return row?.id ?? null;
    });
  }
}
