// CRM navigation/IA tree — docs/03-prd-crm.md §10. Renders the FULL nav tree
// so the IA is complete from P1. Wave 4a wired Students/Faculty/Courses;
// Wave 4b wired Batches + Admin (Roles & Permissions/Branches/Audit Logs).
// Phase 2 Wave 5a flips Commerce (Payments/Orders/Invoices/Refunds/Coupons)
// off `comingSoon` — Plans stays `comingSoon` (EMI/dunning depth deferred
// per docs/plans/phase-2.md). Phase 2 Wave 5b flips Leads (Pipeline/
// Counselling/Tasks) off `comingSoon` too; Bookings surfaces as a Leads
// child (booking management lives under Leads per docs/03 §7.12 — the
// counsellor manages bookings as part of the lead workflow, there's no
// separate top-level IA slot for it).
// Everything else (Content, Marketing, Support) stays `comingSoon` through P2
// per docs/plans/phase-2.md scope boundary. Phase 7 Wave 3 (task #14) flips
// Analytics off `comingSoon` — 8 KPI dashboards + an Overview landing page,
// each gated on its `reports.*.view` permission (server-enforced; the nav
// just hides what the API would 403 on, CLAUDE.md §3.5). Task #15 adds
// Exports (`reports.export`) and Scheduled Reports (`reports.schedule`) to
// the same section — both standalone permission keys, separate from the
// `reports.<domain>.view` keys the 8 dashboards use (AC-34).
// Phase 8 (docs/specs/phase-8-mentor.md) adds Academics > Mentors
// (`mentors.view`, admin/branch-manager hiring-record directory) and a
// standalone top-level "Mentor Dashboard" item (`mentor.dashboard.view`,
// held ONLY by the new Mentor role per Rule M-3 — invisible to every other
// role including Admin/Owner, who reach the same data via Batches instead).
// Phase 9 Completion (docs/plans/phase-9-completion.md, T37-T40) flips every
// remaining `comingSoon` leaf off: Students > Admissions/Alumni, Academics >
// Live Scheduler/Attendance, Content > Video Library/Resources, Commerce >
// Plans, Marketing > Referrals/Landing Pages/Blog CMS, the whole Support
// section (Tickets/Knowledge Base), and Admin > Settings/Feature Flags —
// all 15 items now route to real, SDK-backed screens. Analytics also gains
// 4 composed reports (Cohort/Branch Comparison/Faculty Performance/Refunds)
// that don't have a dedicated backend report endpoint (see hooks/
// use-extended-reports.ts file header) but are real, working screens.
// Live Classes was later dropped from the product — the Academics > Live
// Scheduler nav leaf, its route/hooks/components were removed entirely.
import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  FolderKanban,
  Wallet,
  Megaphone,
  Globe,
  LifeBuoy,
  BarChart3,
  ShieldCheck,
  Calendar,
  UserCog,
} from "lucide-react";

export interface NavLeaf {
  label: string;
  /** Route path when wired; omit (or leave undefined) for not-yet-built leaves. */
  to?: string;
  /** RBAC gate: only rendered if the user holds this `module.action` permission. Omit for always-visible (e.g. Dashboard). */
  permission?: string;
  /**
   * Role gate: only rendered if the user HOLDS this role key. Use for items that a
   * permission gate alone can't hide — e.g. anything admins reach via their wildcard
   * grant but that is only meaningful for a specific role. Combined with `permission`
   * as AND (both must pass).
   */
  role?: string;
  /** True for leaves whose route doesn't exist yet — renders disabled with a "coming soon" affordance. */
  comingSoon?: boolean;
}

export interface NavSection {
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Section-level route (e.g. Dashboard has no children, just a direct link). */
  to?: string;
  permission?: string;
  /** Role gate (see NavLeaf.role). */
  role?: string;
  comingSoon?: boolean;
  children?: NavLeaf[];
}

export const NAV_SECTIONS: NavSection[] = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/", comingSoon: false },
  {
    // Phase 8 (docs/specs/phase-8-mentor.md WS-4, LOCK-3): a standalone,
    // role-aware landing page for the Mentor role. Gated on the `mentor` ROLE,
    // not just `mentor.dashboard.view` — admins/super-admins hold that permission
    // via their wildcard grant but have no mentor profile, so a permission-only
    // gate would (wrongly) show them a link that the API 403s. The role gate
    // matches the endpoint's real audience (active mentors only).
    label: "Mentor Dashboard",
    icon: UserCog,
    to: "/mentor/dashboard",
    permission: "mentor.dashboard.view",
    role: "mentor",
  },
  {
    label: "Leads",
    icon: FolderKanban,
    // lifecycle-redesign P2: the five Leads pages collapse to three. Counselling,
    // Tasks and Bookings were all cross-lead work-queues — they now live as the
    // three tabs of one "My Work" cockpit (/leads/counselling); their per-lead
    // equivalents remain inside the lead-detail drawer. /leads/tasks and
    // /leads/bookings redirect into the cockpit for old bookmarks.
    children: [
      { label: "Pipeline", to: "/leads", permission: "leads.view" },
      { label: "My Work", to: "/leads/counselling", permission: "leads.view" },
      { label: "Contact Messages", to: "/leads/contact-messages", permission: "content.view" },
    ],
  },
  {
    // One page with an in-page status toggle (All / Admissions / Active /
    // Alumni) instead of three sub-pages — the old /students/admissions and
    // /students/alumni URLs redirect into the toggle.
    label: "Students",
    icon: Users,
    to: "/students",
    permission: "students.view",
  },
  {
    label: "Academics",
    icon: GraduationCap,
    children: [
      { label: "Courses", to: "/courses", permission: "courses.view" },
      { label: "Faculty", to: "/faculty", permission: "faculty.view" },
      { label: "Mentors", to: "/mentors", permission: "mentors.view" },
      { label: "Batches", to: "/batches", permission: "batches.view" },
      { label: "Attendance", to: "/academics/attendance", permission: "reports.attendance.view" },
      { label: "Assignments", to: "/academics/assignments", permission: "assignments.view" },
      { label: "Projects", to: "/academics/projects", permission: "assignments.view" },
      { label: "Assessments", to: "/academics/assessments", permission: "assessments.view" },
      { label: "Forum Moderation", to: "/academics/forum-moderation", permission: "forum.moderate" },
    ],
  },
  {
    label: "Content",
    icon: BookOpen,
    children: [
      { label: "Video Library", to: "/content/videos", permission: "videolib.view" },
      { label: "Resources", to: "/content/resources", permission: "content.view" },
      { label: "Certificates", to: "/content/certificates", permission: "certificates.view" },
    ],
  },
  {
    label: "Commerce",
    icon: Wallet,
    children: [
      { label: "Payments", to: "/commerce/payments", permission: "payments.view" },
      { label: "Orders", to: "/commerce/orders", permission: "orders.view" },
      { label: "Invoices", to: "/commerce/invoices", permission: "invoices.view" },
      { label: "Refunds", to: "/commerce/refunds", permission: "refunds.view" },
      { label: "Coupons", to: "/commerce/coupons", permission: "coupons.view" },
      { label: "Plans", to: "/commerce/plans", permission: "emi.view" },
    ],
  },
  {
    label: "Marketing",
    icon: Megaphone,
    children: [
      { label: "Campaigns", to: "/marketing/campaigns", permission: "campaigns.view" },
      { label: "Referrals", to: "/marketing/referrals", permission: "referrals.view" },
    ],
  },
  {
    // Everything that edits the PUBLIC MARKETING WEBSITE, split out of "Marketing"
    // so site editing is one obvious place (Marketing keeps campaign/growth tools).
    // Routes keep their /marketing/* paths — this is an IA regrouping, not a URL move.
    label: "Website",
    icon: Globe,
    children: [
      // Phase 10 (docs/specs/phase-10-page-builder.md) — deliberately narrower than the
      // rest of Content/Marketing: `content.builder`/`site_settings.view` are super_admin-
      // only, NOT granted to Marketing/Admin/Content Editor by default (spec "Data/
      // permissions impact" — a narrower grant than `content.edit`/`content.publish`).
      { label: "Page Builder", to: "/marketing/page-builder", permission: "content.builder" },
      { label: "Site Settings", to: "/marketing/site-settings", permission: "site_settings.view" },
      // Phase-11 locked templates (docs/plans/phase-11-locked-templates.md) — colleges are
      // the "items" behind the page builder's colleges_live template sections; managed on
      // their own screen, same `content.*` permissions as Blog CMS's Partners tab.
      { label: "Colleges", to: "/marketing/colleges", permission: "content.view" },
      // Testimonials — promoted out of the Blog CMS tab strip to its own screen
      // (same shape as Colleges): the homepage "What Our Students Say" section
      // pulls the published rows via /public/testimonials.
      { label: "Testimonials", to: "/marketing/testimonials", permission: "content.view" },
      { label: "Blog CMS", to: "/marketing/blog-cms", permission: "content.view" },
      { label: "Landing Pages", to: "/marketing/landing-pages", permission: "landing_pages.view" },
    ],
  },
  {
    label: "Support",
    icon: LifeBuoy,
    children: [
      { label: "Tickets", to: "/support/tickets", permission: "tickets.view" },
      { label: "Knowledge Base", to: "/support/kb", permission: "kb.view" },
    ],
  },
  {
    // NAV SLIMMED (2026-07-23): the Analytics menu was trimmed from 15 items to the
    // 6 core business dashboards below. The other 9 reports (Attendance, Course/Video
    // Engagement, Gamification, Forum Health, Cohort, Branch Comparison, Faculty
    // Performance, Refund Report, Scheduled Reports) still EXIST as routes and remain
    // reachable by URL — several also duplicate operational pages (Attendance →
    // Academics, Refunds → Commerce, Faculty → Academics). To resurface any, re-add
    // its `{ label, to, permission }` leaf here; the mapping is in git history.
    label: "Analytics",
    icon: BarChart3,
    children: [
      { label: "Overview", to: "/analytics" },
      { label: "Revenue", to: "/analytics/revenue", permission: "reports.revenue.view" },
      { label: "Enrollment Trend", to: "/analytics/enrollment", permission: "reports.enrollment.view" },
      { label: "Lead Funnel", to: "/analytics/funnel", permission: "reports.funnel.view" },
      { label: "Campaign Performance", to: "/analytics/campaigns", permission: "reports.campaigns.view" },
      { label: "Exports", to: "/analytics/exports", permission: "reports.export" },
    ],
  },
  {
    label: "Admin",
    icon: ShieldCheck,
    children: [
      { label: "Roles & Permissions", to: "/admin/roles", permission: "roles.view" },
      { label: "Branches", to: "/admin/branches", permission: "branches.view" },
      { label: "Audit Logs", to: "/admin/audit-logs", permission: "audit_logs.view" },
      { label: "Notifications", to: "/admin/notifications", permission: "campaigns.view" },
      { label: "Settings", to: "/admin/settings", permission: "settings.view" },
      { label: "Feature Flags", to: "/admin/feature-flags", permission: "flags.view" },
    ],
  },
];

// Kept separate (not yet in the §10 tree as its own top-level item) but
// referenced from "Academics" — exported for a future "today's schedule"
// dashboard widget seam.
export const CALENDAR_ICON = Calendar;
