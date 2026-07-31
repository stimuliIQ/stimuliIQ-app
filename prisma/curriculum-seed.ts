// prisma/curriculum-seed.ts — shared engine for the per-program curriculum seeds.
//
// The syllabus for each program lives in its own `seed-<program>-curriculum.ts` as plain
// data; this file owns the only copy of the logic that writes it. Added after the
// 2026-07-31 curriculum loss: keeping syllabi in version control means a wipe costs one
// command to undo, and one shared writer means the safety properties below are proven
// once rather than re-implemented per program.
//
// SHAPE. The schema is Program -> Module -> Lesson with no concept of a "week", so the
// week is carried in the module title ("Week 1 · Module 1: …"). `order` is derived from
// array position, so reordering the data reorders the CRM and the public site.
//
// SAFETY.
//   - IDEMPOTENT: modules and lessons are matched on their natural key (title within
//     parent), so a re-run updates order/type in place instead of duplicating.
//   - NEVER DELETES: rows present in the DB but absent from the data file are reported
//     as extras and left alone, so anything staff added in the CRM survives a re-run.
//   - TRANSACTIONAL: the whole program is written in one transaction; --dry-run performs
//     every read and write then rolls back, so the report is real rather than predicted.

import { LessonType, PrismaClient } from "@prisma/client";

/** A lesson: a bare string defaults to `reading`, or an explicit title/type pair. */
export type LessonSpec = string | { title: string; type: LessonType };

export interface ModuleSpec {
  title: string;
  lessons: LessonSpec[];
}

/** Practical work, capstone options — anything the student produces. */
export const a = (title: string): LessonSpec => ({ title, type: LessonType.assignment });
/** Anything the syllabus explicitly calls a quiz. */
export const q = (title: string): LessonSpec => ({ title, type: LessonType.quiz });

function normalise(spec: LessonSpec): { title: string; type: LessonType } {
  return typeof spec === "string" ? { title: spec, type: LessonType.reading } : spec;
}

export interface ApplyCurriculumOptions {
  /** Log prefix, e.g. "neuro". */
  label: string;
  tenantSlug: string;
  programSlug: string;
  curriculum: ModuleSpec[];
}

/**
 * Write a curriculum to its program. Reads `--dry-run` from argv.
 *
 * NOTE ON PREVIEWS: nothing is marked `isPreview`. A preview lesson is only meaningful
 * once a video is attached — flagging one without a video shows students a "free preview"
 * that plays nothing. Staff flip the CRM's "Free preview" toggle after uploading video.
 */
export async function applyCurriculum(opts: ApplyCurriculumOptions): Promise<void> {
  const { label, tenantSlug, programSlug, curriculum } = opts;
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();
  const log = (msg: string) => console.log(`[${label}] ${msg}`);

  try {
    const tenant = await prisma.tenant.findFirst({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant) throw new Error(`Tenant '${tenantSlug}' not found.`);

    const program = await prisma.program.findFirst({
      where: { tenantId: tenant.id, slug: programSlug, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!program) throw new Error(`Program '${programSlug}' not found in tenant '${tenantSlug}'.`);

    const totalLessons = curriculum.reduce((n, m) => n + m.lessons.length, 0);
    log(`program : ${program.title} (${programSlug})`);
    log(`planned : ${curriculum.length} modules / ${totalLessons} lessons`);
    log(`mode    : ${dryRun ? "DRY RUN — nothing will be committed" : "APPLY"}\n`);

    let modulesCreated = 0;
    let modulesPresent = 0;
    let lessonsCreated = 0;
    let lessonsPresent = 0;

    try {
      await prisma.$transaction(
        async (tx) => {
          for (const [moduleIndex, spec] of curriculum.entries()) {
            const existingModule = await tx.module.findFirst({
              where: { programId: program.id, title: spec.title, deletedAt: null },
              select: { id: true, order: true },
            });

            let moduleId: string;
            if (existingModule) {
              moduleId = existingModule.id;
              if (existingModule.order !== moduleIndex) {
                await tx.module.update({ where: { id: moduleId }, data: { order: moduleIndex } });
              }
              modulesPresent++;
            } else {
              const created = await tx.module.create({
                data: { programId: program.id, title: spec.title, order: moduleIndex },
                select: { id: true },
              });
              moduleId = created.id;
              modulesCreated++;
            }

            for (const [lessonIndex, raw] of spec.lessons.entries()) {
              const lesson = normalise(raw);
              const existing = await tx.lesson.findFirst({
                where: { moduleId, title: lesson.title, deletedAt: null },
                select: { id: true, order: true, type: true },
              });
              if (existing) {
                if (existing.order !== lessonIndex || existing.type !== lesson.type) {
                  await tx.lesson.update({
                    where: { id: existing.id },
                    data: { order: lessonIndex, type: lesson.type },
                  });
                }
                lessonsPresent++;
              } else {
                await tx.lesson.create({
                  data: { moduleId, title: lesson.title, type: lesson.type, order: lessonIndex },
                });
                lessonsCreated++;
              }
            }

            console.log(`  [${String(moduleIndex).padStart(2)}] ${spec.title}  (${spec.lessons.length} lessons)`);
          }

          const extras = await tx.module.findMany({
            where: { programId: program.id, deletedAt: null, title: { notIn: curriculum.map((m) => m.title) } },
            select: { title: true },
          });
          if (extras.length) {
            console.log(`\n  NOTE: ${extras.length} module(s) in the DB are not in this file (left untouched):`);
            extras.forEach((e) => console.log(`    - ${e.title}`));
          }

          if (dryRun) throw new Error("__DRY_RUN__");
        },
        { timeout: 120_000 },
      );
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("__DRY_RUN__"))) throw err;
      // Fall through to the summary: on a dry run the counts are the whole point —
      // "0 created, N already present" is what proves the seed is idempotent.
    }

    const verb = dryRun ? "would create" : "created";
    console.log(
      `\n[${label}] modules: ${verb} ${modulesCreated}, ${modulesPresent} already present` +
        `\n[${label}] lessons: ${verb} ${lessonsCreated}, ${lessonsPresent} already present`,
    );
    log(dryRun ? "DRY RUN complete — transaction rolled back, nothing written." : "done.");
  } finally {
    await prisma.$disconnect();
  }
}

/** Standard entrypoint wrapper — non-zero exit on failure so CI/scripts notice. */
export function runCurriculumSeed(opts: ApplyCurriculumOptions): void {
  applyCurriculum(opts).catch((err: unknown) => {
    console.error(`[${opts.label}] failed:`, err);
    process.exit(1);
  });
}
