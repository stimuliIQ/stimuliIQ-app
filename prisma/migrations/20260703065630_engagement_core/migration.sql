-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('grade_ready', 'certificate_ready', 'live_reminder', 'forum_reply', 'announcement', 'lead_confirmation', 'booking_confirmation', 'payment_receipt', 'welcome');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('in_app', 'email', 'sms', 'whatsapp');

-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('email', 'whatsapp', 'sms');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('open', 'resolved', 'hidden', 'pinned');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('visible', 'hidden');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('unsubscribe', 'bounce', 'complaint');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channels" JSONB NOT NULL DEFAULT '[]',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_prefs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "matrix" JSONB NOT NULL DEFAULT '{}',
    "quiet_hours" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_suppressions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT,
    "phone" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "notification_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel" "CampaignChannel" NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "dlt_template_id" TEXT,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "campaign_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel" "CampaignChannel" NOT NULL,
    "template_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "segment" JSONB NOT NULL DEFAULT '{}',
    "schedule_at" TIMESTAMP(3),
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "lead_id" UUID,
    "student_id" UUID,
    "user_id" UUID,
    "to" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'queued',
    "provider_message_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "badge_id" UUID NOT NULL,
    "awarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_ledger" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "points_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_threads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID,
    "program_id" UUID,
    "author_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ThreadStatus" NOT NULL DEFAULT 'open',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "resolved_post_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "forum_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_posts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "parent_id" UUID,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "status" "PostStatus" NOT NULL DEFAULT 'visible',
    "hidden_by" UUID,
    "hidden_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "forum_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_post_votes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "forum_post_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_deleted_at_idx" ON "notifications"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_prefs_user_id_key" ON "notification_prefs"("user_id");

-- CreateIndex
CREATE INDEX "notification_prefs_tenant_id_deleted_at_idx" ON "notification_prefs"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "notification_suppressions_tenant_id_email_channel_idx" ON "notification_suppressions"("tenant_id", "email", "channel");

-- CreateIndex
CREATE INDEX "notification_suppressions_tenant_id_phone_channel_idx" ON "notification_suppressions"("tenant_id", "phone", "channel");

-- CreateIndex
CREATE INDEX "notification_suppressions_tenant_id_user_id_channel_idx" ON "notification_suppressions"("tenant_id", "user_id", "channel");

-- CreateIndex
CREATE INDEX "notification_suppressions_tenant_id_deleted_at_idx" ON "notification_suppressions"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "campaign_templates_tenant_id_channel_idx" ON "campaign_templates"("tenant_id", "channel");

-- CreateIndex
CREATE INDEX "campaign_templates_tenant_id_deleted_at_idx" ON "campaign_templates"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_status_idx" ON "campaigns"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_created_by_idx" ON "campaigns"("tenant_id", "created_by");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_deleted_at_idx" ON "campaigns"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_status_idx" ON "campaign_recipients"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "campaign_recipients_provider_message_id_idx" ON "campaign_recipients"("provider_message_id");

-- CreateIndex
CREATE INDEX "campaign_recipients_tenant_id_deleted_at_idx" ON "campaign_recipients"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "badges_tenant_id_status_idx" ON "badges"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "badges_tenant_id_deleted_at_idx" ON "badges"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "badges_tenant_id_key_key" ON "badges"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "user_badges_user_id_badge_id_idx" ON "user_badges"("user_id", "badge_id");

-- CreateIndex
CREATE INDEX "user_badges_tenant_id_user_id_idx" ON "user_badges"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "user_badges_tenant_id_deleted_at_idx" ON "user_badges"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "points_ledger_user_id_idx" ON "points_ledger"("user_id");

-- CreateIndex
CREATE INDEX "points_ledger_tenant_id_user_id_idx" ON "points_ledger"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "points_ledger_tenant_id_deleted_at_idx" ON "points_ledger"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "forum_threads_tenant_id_batch_id_status_idx" ON "forum_threads"("tenant_id", "batch_id", "status");

-- CreateIndex
CREATE INDEX "forum_threads_tenant_id_program_id_status_idx" ON "forum_threads"("tenant_id", "program_id", "status");

-- CreateIndex
CREATE INDEX "forum_threads_tenant_id_deleted_at_idx" ON "forum_threads"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "forum_posts_thread_id_status_idx" ON "forum_posts"("thread_id", "status");

-- CreateIndex
CREATE INDEX "forum_posts_thread_id_parent_id_idx" ON "forum_posts"("thread_id", "parent_id");

-- CreateIndex
CREATE INDEX "forum_posts_tenant_id_author_id_idx" ON "forum_posts"("tenant_id", "author_id");

-- CreateIndex
CREATE INDEX "forum_posts_tenant_id_deleted_at_idx" ON "forum_posts"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "forum_post_votes_post_id_user_id_idx" ON "forum_post_votes"("post_id", "user_id");

-- CreateIndex
CREATE INDEX "forum_post_votes_tenant_id_user_id_idx" ON "forum_post_votes"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "forum_post_votes_tenant_id_deleted_at_idx" ON "forum_post_votes"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_suppressions" ADD CONSTRAINT "notification_suppressions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_suppressions" ADD CONSTRAINT "notification_suppressions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_templates" ADD CONSTRAINT "campaign_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "campaign_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badges" ADD CONSTRAINT "badges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "forum_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_hidden_by_fkey" FOREIGN KEY ("hidden_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_post_votes" ADD CONSTRAINT "forum_post_votes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_post_votes" ADD CONSTRAINT "forum_post_votes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_post_votes" ADD CONSTRAINT "forum_post_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
