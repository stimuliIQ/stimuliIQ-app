-- CreateEnum
CREATE TYPE "LiveClassProvider" AS ENUM ('zoom', 'google_meet', 'noop');

-- CreateEnum
CREATE TYPE "LiveClassStatus" AS ENUM ('scheduled', 'live', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "SettingScope" AS ENUM ('system', 'company');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'converted', 'rewarded', 'expired', 'rejected');

-- CreateEnum
CREATE TYPE "EmiPlanStatus" AS ENUM ('active', 'completed', 'defaulted', 'cancelled');

-- CreateEnum
CREATE TYPE "EmiInstallmentStatus" AS ENUM ('pending', 'paid', 'overdue', 'waived', 'failed');

-- NOTE (db-architect, Phase 9 Wave 1): prisma migrate dev's diff engine also proposed
-- `ALTER TABLE "analytics_mv_refresh_log" ALTER COLUMN "last_success_at"/"last_attempt_at"
-- SET DATA TYPE TIMESTAMP(3)`. That table was authored via raw SQL in migration
-- `20260704060400_analytics_refresh_log` as TIMESTAMPTZ (matching Prisma's `DateTime?`
-- mapping only loosely); this is pre-existing Phase-7 schema drift, unrelated to this
-- Phase-9 task (T6-T13), and altering it would silently drop timezone-awareness on an
-- unrelated table. Deliberately DROPPED from this migration — out of scope here. Flagged
-- for docs-writer/db-architect follow-up, not applied.

-- CreateTable
CREATE TABLE "live_classes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "provider" "LiveClassProvider" NOT NULL DEFAULT 'noop',
    "provider_meeting_id" TEXT,
    "join_url" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "LiveClassStatus" NOT NULL DEFAULT 'scheduled',
    "recording_url" TEXT,
    "host_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "live_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "priority" "TicketPriority" NOT NULL DEFAULT 'medium',
    "assignee_id" UUID,
    "sla_due_at" TIMESTAMP(3),
    "rating" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_responses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "blog_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_id" UUID,
    "author_id" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" TEXT NOT NULL,
    "cover_image_key" TEXT,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "program_id" UUID,
    "student_name" TEXT NOT NULL,
    "student_photo_key" TEXT,
    "quote" TEXT NOT NULL,
    "rating" INTEGER,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "logo_key" TEXT,
    "url" TEXT,
    "category" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_bios" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "faculty_profile_id" UUID,
    "name" TEXT NOT NULL,
    "photo_key" TEXT,
    "title" TEXT,
    "bio" TEXT NOT NULL,
    "social_links" JSONB,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "faculty_bios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_pages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "content_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "consent" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "unsubscribed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "newsletter_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_submissions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "consent" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_applications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL,
    "resume_storage_key" TEXT NOT NULL,
    "cover_letter" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "career_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rollout" JSONB,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scope" "SettingScope" NOT NULL DEFAULT 'company',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ref_type" TEXT NOT NULL,
    "ref_id" UUID NOT NULL,
    "note" TEXT,
    "timestamp_s" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "timestamp_s" INTEGER,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lesson_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "referrer_user_id" UUID NOT NULL,
    "referred_lead_id" UUID,
    "code" TEXT NOT NULL,
    "reward" JSONB,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "rewarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emi_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "total_amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "num_installments" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "status" "EmiPlanStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "emi_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emi_installments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "emi_plan_id" UUID NOT NULL,
    "installment_no" INTEGER NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" "EmiInstallmentStatus" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(3),
    "payment_id" UUID,
    "dunning_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_dunning_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "emi_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_pages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'a',
    "content" JSONB NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_forms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "target_program_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lead_forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_classes_tenant_id_batch_id_idx" ON "live_classes"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "live_classes_tenant_id_status_idx" ON "live_classes"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "live_classes_starts_at_idx" ON "live_classes"("starts_at");

-- CreateIndex
CREATE INDEX "live_classes_tenant_id_deleted_at_idx" ON "live_classes"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_status_idx" ON "tickets"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_assignee_id_idx" ON "tickets"("tenant_id", "assignee_id");

-- CreateIndex
CREATE INDEX "tickets_user_id_idx" ON "tickets"("user_id");

-- CreateIndex
CREATE INDEX "tickets_sla_due_at_idx" ON "tickets"("sla_due_at");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_deleted_at_idx" ON "tickets"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "ticket_messages_ticket_id_idx" ON "ticket_messages"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_messages_tenant_id_deleted_at_idx" ON "ticket_messages"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "canned_responses_tenant_id_deleted_at_idx" ON "canned_responses"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "kb_articles_slug_idx" ON "kb_articles"("slug");

-- CreateIndex
CREATE INDEX "kb_articles_tenant_id_published_idx" ON "kb_articles"("tenant_id", "published");

-- CreateIndex
CREATE INDEX "kb_articles_tenant_id_deleted_at_idx" ON "kb_articles"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "blog_categories_slug_idx" ON "blog_categories"("slug");

-- CreateIndex
CREATE INDEX "blog_categories_tenant_id_deleted_at_idx" ON "blog_categories"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "blog_posts_slug_idx" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_tenant_id_status_published_at_idx" ON "blog_posts"("tenant_id", "status", "published_at");

-- CreateIndex
CREATE INDEX "blog_posts_category_id_idx" ON "blog_posts"("category_id");

-- CreateIndex
CREATE INDEX "blog_posts_tenant_id_deleted_at_idx" ON "blog_posts"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "testimonials_tenant_id_status_idx" ON "testimonials"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "testimonials_program_id_idx" ON "testimonials"("program_id");

-- CreateIndex
CREATE INDEX "testimonials_tenant_id_deleted_at_idx" ON "testimonials"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "partners_tenant_id_status_idx" ON "partners"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "partners_tenant_id_deleted_at_idx" ON "partners"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "faculty_bios_tenant_id_status_idx" ON "faculty_bios"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "faculty_bios_faculty_profile_id_idx" ON "faculty_bios"("faculty_profile_id");

-- CreateIndex
CREATE INDEX "faculty_bios_tenant_id_deleted_at_idx" ON "faculty_bios"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "content_pages_slug_idx" ON "content_pages"("slug");

-- CreateIndex
CREATE INDEX "content_pages_tenant_id_status_idx" ON "content_pages"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "content_pages_tenant_id_deleted_at_idx" ON "content_pages"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "newsletter_subscriptions_tenant_id_status_idx" ON "newsletter_subscriptions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "newsletter_subscriptions_tenant_id_deleted_at_idx" ON "newsletter_subscriptions"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "contact_submissions_tenant_id_status_idx" ON "contact_submissions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "contact_submissions_tenant_id_deleted_at_idx" ON "contact_submissions"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "career_applications_tenant_id_status_idx" ON "career_applications"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "career_applications_tenant_id_deleted_at_idx" ON "career_applications"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "feature_flags_tenant_id_enabled_idx" ON "feature_flags"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "feature_flags_tenant_id_deleted_at_idx" ON "feature_flags"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "settings_tenant_id_scope_idx" ON "settings"("tenant_id", "scope");

-- CreateIndex
CREATE INDEX "settings_tenant_id_deleted_at_idx" ON "settings"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "bookmarks_tenant_id_user_id_idx" ON "bookmarks"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "bookmarks_user_id_ref_type_idx" ON "bookmarks"("user_id", "ref_type");

-- CreateIndex
CREATE INDEX "bookmarks_tenant_id_deleted_at_idx" ON "bookmarks"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "lesson_notes_tenant_id_user_id_lesson_id_idx" ON "lesson_notes"("tenant_id", "user_id", "lesson_id");

-- CreateIndex
CREATE INDEX "lesson_notes_lesson_id_idx" ON "lesson_notes"("lesson_id");

-- CreateIndex
CREATE INDEX "lesson_notes_tenant_id_deleted_at_idx" ON "lesson_notes"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "referrals_tenant_id_referrer_user_id_idx" ON "referrals"("tenant_id", "referrer_user_id");

-- CreateIndex
CREATE INDEX "referrals_referred_lead_id_idx" ON "referrals"("referred_lead_id");

-- CreateIndex
CREATE INDEX "referrals_tenant_id_status_idx" ON "referrals"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "referrals_tenant_id_deleted_at_idx" ON "referrals"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "emi_plans_tenant_id_status_idx" ON "emi_plans"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "emi_plans_order_id_idx" ON "emi_plans"("order_id");

-- CreateIndex
CREATE INDEX "emi_plans_tenant_id_deleted_at_idx" ON "emi_plans"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "emi_installments_tenant_id_status_due_date_idx" ON "emi_installments"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "emi_installments_emi_plan_id_idx" ON "emi_installments"("emi_plan_id");

-- CreateIndex
CREATE INDEX "emi_installments_tenant_id_deleted_at_idx" ON "emi_installments"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "landing_pages_slug_idx" ON "landing_pages"("slug");

-- CreateIndex
CREATE INDEX "landing_pages_tenant_id_campaign_idx" ON "landing_pages"("tenant_id", "campaign");

-- CreateIndex
CREATE INDEX "landing_pages_tenant_id_status_idx" ON "landing_pages"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "landing_pages_tenant_id_deleted_at_idx" ON "landing_pages"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "lead_forms_tenant_id_active_idx" ON "lead_forms"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "lead_forms_tenant_id_deleted_at_idx" ON "lead_forms"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_live_class_id_fkey" FOREIGN KEY ("live_class_id") REFERENCES "live_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_host_user_id_fkey" FOREIGN KEY ("host_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_categories" ADD CONSTRAINT "blog_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "blog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_bios" ADD CONSTRAINT "faculty_bios_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_bios" ADD CONSTRAINT "faculty_bios_faculty_profile_id_fkey" FOREIGN KEY ("faculty_profile_id") REFERENCES "faculty_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_submissions" ADD CONSTRAINT "contact_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_applications" ADD CONSTRAINT "career_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_fkey" FOREIGN KEY ("referrer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_lead_id_fkey" FOREIGN KEY ("referred_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emi_plans" ADD CONSTRAINT "emi_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emi_plans" ADD CONSTRAINT "emi_plans_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emi_installments" ADD CONSTRAINT "emi_installments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emi_installments" ADD CONSTRAINT "emi_installments_emi_plan_id_fkey" FOREIGN KEY ("emi_plan_id") REFERENCES "emi_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emi_installments" ADD CONSTRAINT "emi_installments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_target_program_id_fkey" FOREIGN KEY ("target_program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
