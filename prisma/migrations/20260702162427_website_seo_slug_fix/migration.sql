-- DropIndex
DROP INDEX "programs_slug_key";

-- CreateIndex
CREATE INDEX "programs_slug_idx" ON "programs"("slug");
