-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "consent" JSONB;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "consent" JSONB,
ADD COLUMN     "fbclid" TEXT,
ADD COLUMN     "gclid" TEXT,
ADD COLUMN     "landing_url" TEXT,
ADD COLUMN     "referrer" TEXT;

-- AlterTable
ALTER TABLE "programs" ADD COLUMN     "card_summary" TEXT,
ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "og_image_key" TEXT,
ADD COLUMN     "outcomes" JSONB,
ADD COLUMN     "rating_avg" INTEGER,
ADD COLUMN     "rating_count" INTEGER,
ADD COLUMN     "seo_description" TEXT,
ADD COLUMN     "seo_title" TEXT;

-- CreateIndex
CREATE INDEX "programs_tenant_id_is_public_status_idx" ON "programs"("tenant_id", "is_public", "status");
