/**
 * resync-enrollment-progress.ts — recompute `enrollment.progress_pct` and `status` for
 * every enrollment from the curriculum that actually exists right now.
 *
 * WHY THIS EXISTS. `progress_pct` is a cache of `summariseCourseProgress(completed, total)`
 * and, until this pass, it was written only when a student completed a lesson. That is the
 * numerator. Nothing rewrote it when the DENOMINATOR moved: staff added a module to a
 * programme a student had already finished, and the enrollment kept saying "Completed" at
 * 100% on every screen that reads the stored column while every screen that recomputes the
 * fraction said 98%. `CoursesService` now resyncs on each curriculum edit, but rows that
 * drifted BEFORE that shipped are still wrong in the database, and this script is what
 * repairs them.
 *
 * WHAT IT WILL AND WILL NOT DO:
 *   - It writes only `progress_pct`, `status` and `completed_at`, and only on rows whose
 *     values actually differ. A tenant with nothing drifted is zero writes.
 *   - It never touches a `dropped` enrollment. Dropping is somebody's decision, not a
 *     consequence of arithmetic.
 *   - It never touches a certificate. An issued certificate records what was true when it
 *     was earned; re-opening an enrollment asks the student to do the new material, it does
 *     not withdraw what they already hold.
 *
 * SAFE ON A LIVE DATABASE — unlike `pnpm db:seed`, this writes no demo data and creates
 * nothing. Run it once after deploying the fix, and any time you suspect drift.
 *
 * Run:        pnpm resync:progress
 * Dry run:    pnpm resync:progress -- --dry-run
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * The same arithmetic as `summariseCourseProgress` in @repo/types, inlined because the seed
 * tsconfig compiles prisma/ on its own and does not resolve workspace packages. Keep the two
 * in step: short of the finish line never rounds up to 100.
 */
function summarise(completedRaw: number, totalRaw: number): { progressPct: number; isComplete: boolean } {
  const total = Math.max(0, Math.trunc(totalRaw));
  const completed = Math.min(Math.max(0, Math.trunc(completedRaw)), total);
  const isComplete = total > 0 && completed >= total;
  return {
    progressPct: total === 0 ? 0 : isComplete ? 100 : Math.min(99, Math.round((completed / total) * 100)),
    isComplete,
  };
}

async function main(): Promise<void> {
  console.log(DRY_RUN ? "Resyncing enrollment progress (DRY RUN, no writes)…" : "Resyncing enrollment progress…");

  const programs = await prisma.program.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });

  let totalScanned = 0;
  let totalUpdated = 0;
  let totalReopened = 0;

  for (const program of programs) {
    const totalLessons = await prisma.lesson.count({
      where: { module: { programId: program.id }, deletedAt: null },
    });

    const enrollments = await prisma.enrollment.findMany({
      where: { programId: program.id, deletedAt: null, status: { not: "dropped" } },
      select: { id: true, status: true, progressPct: true, completedAt: true },
    });
    if (enrollments.length === 0) continue;

    const completedCounts = await prisma.lessonProgress.groupBy({
      by: ["enrollmentId"],
      where: { enrollmentId: { in: enrollments.map((e) => e.id) }, status: "completed" },
      _count: { _all: true },
    });
    const completedByEnrollment = new Map<string, number>(
      completedCounts.map((c) => [c.enrollmentId, c._count._all]),
    );

    let programUpdated = 0;
    let programReopened = 0;

    for (const enrollment of enrollments) {
      totalScanned += 1;
      const completed = completedByEnrollment.get(enrollment.id) ?? 0;
      const { progressPct, isComplete } = summarise(completed, totalLessons);
      const nextStatus = isComplete ? "completed" : "active";
      const pctChanged = enrollment.progressPct !== progressPct;
      const statusChanged = enrollment.status !== nextStatus;
      if (!pctChanged && !statusChanged) continue;

      if (statusChanged && !isComplete) programReopened += 1;
      programUpdated += 1;

      console.log(
        `  ${enrollment.id}  ${enrollment.progressPct}% ${enrollment.status}` +
          `  ->  ${progressPct}% ${nextStatus}  (${completed}/${totalLessons} lessons)`,
      );

      if (DRY_RUN) continue;
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          progressPct,
          ...(statusChanged
            ? {
                status: nextStatus,
                completedAt: isComplete ? (enrollment.completedAt ?? new Date()) : null,
              }
            : {}),
        },
      });
    }

    if (programUpdated > 0) {
      console.log(
        `${program.title}: ${programUpdated}/${enrollments.length} enrollment(s) corrected` +
          (programReopened > 0 ? `, ${programReopened} reopened from completed.` : "."),
      );
    }
    totalUpdated += programUpdated;
    totalReopened += programReopened;
  }

  console.log(
    `\nScanned ${totalScanned} enrollment(s) across ${programs.length} programme(s): ` +
      `${totalUpdated} corrected, ${totalReopened} reopened from completed.` +
      (DRY_RUN ? " (dry run — nothing was written.)" : ""),
  );
  if (totalReopened > 0) {
    console.log(
      "Reopened students now see the real percentage and a Continue-learning call to action. " +
        "Any certificate they already hold is untouched.",
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
