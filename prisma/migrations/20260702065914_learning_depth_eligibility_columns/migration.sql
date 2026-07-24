-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "is_required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "is_final" BOOLEAN NOT NULL DEFAULT false;
