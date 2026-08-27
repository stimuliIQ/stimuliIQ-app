// apps/api/test/fixtures/course-type-fixtures.ts
//
// Course types are CRM-managed rows (docs/specs/course-types.md, ADR-0068), and the API
// rejects a student or a lead conversion whose course-type key is not one of the tenant's
// ACTIVE options. Every fixture set that creates students through the API therefore needs
// these rows to exist.
//
// The six keys below are the ones the `StudentCourseType` enum used to hardcode — the same
// values the integration specs submit.

import type { PrismaClient } from "@prisma/client";

export const FIXTURE_COURSE_TYPES = [
  { key: "btech", label: "B.Tech" },
  { key: "degree", label: "Degree" },
  { key: "diploma", label: "Diploma" },
  { key: "mca", label: "MCA" },
  { key: "mba", label: "MBA" },
  { key: "other", label: "Other" },
] as const;

/**
 * Idempotent: re-activates and re-labels an existing option rather than creating a second
 * one, so a spec that hides an option cannot break the next run.
 */
export async function ensureFixtureCourseTypes(prisma: PrismaClient, tenantId: string): Promise<void> {
  for (const [index, def] of FIXTURE_COURSE_TYPES.entries()) {
    const existing = await prisma.courseType.findFirst({
      where: { tenantId, key: def.key, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      await prisma.courseType.update({
        where: { id: existing.id },
        data: { active: true, label: def.label },
      });
      continue;
    }
    await prisma.courseType.create({
      data: { tenantId, key: def.key, label: def.label, sortOrder: index + 1, active: true },
    });
  }
}
