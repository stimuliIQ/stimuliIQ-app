// apps/api/src/modules/lms/lms-progress-resync.repository.spec.ts
//
// The stored `enrollment.progress_pct` is a CACHE of summariseCourseProgress. It used to be
// written only when a student completed a lesson, on the stated reasoning that "lessons are
// never un-completed" so progress could only rise. That is true of the numerator and says
// nothing about the denominator: staff added a module to a programme a student had already
// finished, and the enrollment sat at "Completed, 100%" on every screen that read the column
// while every screen that recomputed the fraction showed 98%.
//
// These tests pin the behaviour that closes it, and the two limits on that behaviour that
// matter more than the fix itself: a dropped enrollment is never re-opened, and an
// enrollment that is genuinely unchanged is never written to.

import { LmsRepository } from "./lms.repository";
import type { PrismaService } from "../../prisma/prisma.service";

interface EnrollmentSeed {
  id: string;
  status: "active" | "completed" | "dropped";
  progressPct: number;
  completedAt: Date | null;
}

function makePrismaMock(args: {
  totalLessons: number;
  enrollments: EnrollmentSeed[];
  completedByEnrollment: Record<string, number>;
}) {
  const update = jest.fn().mockResolvedValue({});
  const findMany = jest.fn().mockResolvedValue(args.enrollments);
  const groupBy = jest.fn().mockResolvedValue(
    Object.entries(args.completedByEnrollment).map(([enrollmentId, count]) => ({
      enrollmentId,
      _count: { _all: count },
    })),
  );
  const prisma = {
    client: {
      lesson: { count: jest.fn().mockResolvedValue(args.totalLessons) },
      enrollment: { findMany, update },
      lessonProgress: { groupBy },
    },
  } as unknown as PrismaService;
  return { prisma, update, findMany, groupBy };
}

describe("LmsRepository#resyncProgramEnrollments", () => {
  it("re-opens a completed enrollment once the curriculum grows past what the student did", async () => {
    const { prisma, update } = makePrismaMock({
      totalLessons: 50, // a module was just added; it used to be 49
      enrollments: [
        { id: "enr-1", status: "completed", progressPct: 100, completedAt: new Date("2026-08-01T00:00:00Z") },
      ],
      completedByEnrollment: { "enr-1": 49 },
    });

    const result = await new LmsRepository(prisma).resyncProgramEnrollments("prog-1");

    expect(result).toEqual({ scanned: 1, updated: 1, reopened: 1 });
    expect(update).toHaveBeenCalledWith({
      where: { id: "enr-1" },
      data: { progressPct: 98, status: "active", completedAt: null },
    });
  });

  it("clears completedAt with the status, so no stale finish date survives the re-open", async () => {
    const { prisma, update } = makePrismaMock({
      totalLessons: 10,
      enrollments: [
        { id: "enr-1", status: "completed", progressPct: 100, completedAt: new Date("2026-08-01T00:00:00Z") },
      ],
      completedByEnrollment: { "enr-1": 9 },
    });

    await new LmsRepository(prisma).resyncProgramEnrollments("prog-1");

    expect(update.mock.calls[0][0].data.completedAt).toBeNull();
  });

  it("marks a student complete when the curriculum shrinks to what they have already done", async () => {
    const { prisma, update } = makePrismaMock({
      totalLessons: 8,
      enrollments: [{ id: "enr-1", status: "active", progressPct: 80, completedAt: null }],
      completedByEnrollment: { "enr-1": 8 },
    });

    const result = await new LmsRepository(prisma).resyncProgramEnrollments("prog-1");

    expect(result.reopened).toBe(0);
    expect(update.mock.calls[0][0].data).toMatchObject({ progressPct: 100, status: "completed" });
    expect(update.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
  });

  it("never re-opens a dropped enrollment — it is not even fetched", async () => {
    // Dropping is somebody's decision, not a consequence of arithmetic. Re-opening one
    // because the curriculum grew would quietly re-enroll a student who left.
    const { prisma, findMany, update } = makePrismaMock({
      totalLessons: 50,
      enrollments: [],
      completedByEnrollment: {},
    });

    await new LmsRepository(prisma).resyncProgramEnrollments("prog-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "dropped" } }) }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("writes nothing when every enrollment already agrees with the curriculum", async () => {
    // A curriculum edit on a programme nobody has drifted on must not churn the table, or
    // every lesson added rewrites the whole cohort and floods the audit log.
    const { prisma, update } = makePrismaMock({
      totalLessons: 10,
      enrollments: [
        { id: "enr-1", status: "active", progressPct: 50, completedAt: null },
        { id: "enr-2", status: "completed", progressPct: 100, completedAt: new Date("2026-08-01T00:00:00Z") },
      ],
      completedByEnrollment: { "enr-1": 5, "enr-2": 10 },
    });

    const result = await new LmsRepository(prisma).resyncProgramEnrollments("prog-1");

    expect(result).toEqual({ scanned: 2, updated: 0, reopened: 0 });
    expect(update).not.toHaveBeenCalled();
  });

  it("counts a student with no progress rows at all as zero, not as missing", async () => {
    const { prisma, update } = makePrismaMock({
      totalLessons: 4,
      enrollments: [{ id: "enr-1", status: "active", progressPct: 100, completedAt: null }],
      completedByEnrollment: {}, // never started, so no groupBy row comes back
    });

    await new LmsRepository(prisma).resyncProgramEnrollments("prog-1");

    expect(update.mock.calls[0][0].data).toMatchObject({ progressPct: 0 });
  });

  it("short-circuits a programme with no enrollments before counting anything", async () => {
    const { prisma, groupBy } = makePrismaMock({
      totalLessons: 12,
      enrollments: [],
      completedByEnrollment: {},
    });

    const result = await new LmsRepository(prisma).resyncProgramEnrollments("prog-1");

    expect(result).toEqual({ scanned: 0, updated: 0, reopened: 0 });
    expect(groupBy).not.toHaveBeenCalled();
  });
});
