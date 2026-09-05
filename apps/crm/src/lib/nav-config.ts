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
// Feature Flags went the same way: the seam was fully built (table, RBAC CRUD,
// cached evaluate endpoint, this nav leaf) and never consumed — no app ever
// evaluated a flag — so the screen, route, hooks and table were all removed.
import type { ComponentType } from "react";
import type { PermissionGrant } from "@repo/types";
import {
  Award,
  BarChart3,
  BookMarked,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CheckCheck,
  ClipboardList,
  CreditCard,
  Download,
  FileQuestion,
  FileText,
  FileUser,
  Filter,
  FolderGit2,
  FolderKanban,
  GitBranch,
  Globe,
  GraduationCap,
  Headset,
  IndianRupee,
  KeyRound,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  ListChecks,
  Mail,
  Megaphone,
  MessagesSquare,
  MousePointerClick,
  Network,
  Newspaper,
  Paperclip,
  School,
  ScrollText,
  Send,
  Settings,
  Settings2,
  Share2,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  Target,
  Ticket,
  TicketPercent,
  TrendingUp,
  Trophy,
  Undo2,
  Upload,
  UserCog,
  Users,
  Video,
  Wallet,
} from "lucide-react";

export interface NavLeaf {
  label: string;
  /**
   * Shown beside the label in the flyout. Required, not optional: the flyout is a list of
   * up to nine items and an icon is what makes it scannable, so a leaf without one would
   * leave a ragged gap rather than degrade gracefully.
   */
  icon: ComponentType<{ className?: string }>;
  /** Route path when wired; omit (or leave undefined) for not-yet-built leaves. */
  to?: string;
  /** RBAC gate: only rendered if the user holds this `module.action` permission. Omit for always-visible (e.g. Dashboard). */
  permission?: string;
  /**
   * Narrows `permission` to specific data-scopes. Omit to accept any scope (the norm).
   *
   * Needed where a module cannot serve every scope its permission is granted at, and fails
   * closed on the rest. Faculty hold `courses.view` at scope `assigned`, but the courses
   * module rejects anything other than `all` (see hasPermissionAtScope's comment), so
   * gating on the key alone puts a Courses item in faculty's sidebar that 403s on arrival.
   */
  permissionScopes?: readonly PermissionGrant["scope"][];
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
  /**
   * Presentational grouping only — the sidebar prints this as a caption above the
   * first section that carries it, and as a hairline divider in the collapsed rail
   * where there is no room for words. It changes nothing about routing or RBAC, and
   * it deliberately does NOT reorder the tree: the order below is still the IA.
   */
  group?: string;
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
  { label: "Dashboard", icon: LayoutDashboard, to: "/", comingSoon: false, group: "Overview" },
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
    group: "Operations",
    label: "Leads",
    icon: FolderKanban,
    // lifecycle-redesign P2: the five Leads pages collapse to three. Counselling,
    // Tasks and Bookings were all cross-lead work-queues — they now live as the
    // three tabs of one "My Work" cockpit (/leads/counselling); their per-lead
    // equivalents remain inside the lead-detail drawer. /leads/tasks and
    // /leads/bookings redirect into the cockpit for old bookmarks.
    //
    // Contact Messages was dropped from this list once it became the second tab of
    // Pipeline (components/leads/pipeline-workspace.tsx) — a nav leaf AND a tab for
    // the same queue is two doors into one room. The /leads/contact-messages route
    // still EXISTS and is reachable by URL, so old bookmarks keep working; to
    // resurface it here, re-add
    //   { label: "Contact Messages", to: "/leads/contact-messages", permission: "content.view" }
    // (same convention as the Analytics list slimmed above).
    children: [
      { label: "Pipeline", icon: GitBranch, to: "/leads", permission: "leads.view" },
      { label: "My Work", icon: ListChecks, to: "/leads/counselling", permission: "leads.view" },
      // Bulk intake: Excel/CSV upload → validated preview → per-row selection →
      // created via the same POST /crm/leads contract (server validates each row).
      { label: "Import", icon: Upload, to: "/leads/import", permission: "leads.create" },
    ],
  },
  {
    // Phone-support cockpit: one search box across students AND leads, opening
    // the full 360 drawers (profile/enrollments/payments/tickets/credentials).
    // Label only — the route stays /call-center so existing bookmarks keep working.
    label: "Search Engine",
    icon: Headset,
    to: "/call-center",
    permission: "students.view",
  },
  {
    label: "Students",
    icon: Users,
    children: [
      // One page with an in-page status toggle (All / Admissions / Active /
      // Alumni) instead of three sub-pages — the old /students/admissions and
      // /students/alumni URLs redirect into the toggle.
      { label: "Directory", icon: Users, to: "/students", permission: "students.view" },
      // Bulk intake: Excel/CSV upload → validated preview → per-row selection →
      // created via the same POST /crm/students contract.
      { label: "Import", icon: Upload, to: "/students/import", permission: "students.create" },
    ],
  },
  {
    // Student onboarding form (stimuliiq.com/onboarding) — the post-payment intake that
    // turns a paid enquiry into a student record. Top-level rather than a Students child
    // because it is its own daily queue with its own permission set, and because the
    // second half of the screen (the CRM-authored question set) is not about any one
    // student at all. Gated on `onboarding.view`; the Form-fields tab inside additionally
    // checks `onboarding.fields.manage`.
    label: "Onboarding",
    icon: ClipboardList,
    to: "/onboarding",
    permission: "onboarding.view",
  },
  {
    label: "Academics",
    icon: GraduationCap,
    children: [
      // scope `all` ONLY — faculty's `assigned` grant is rejected by the API
      // (courses.scope_unresolvable), so showing them this leaf leads nowhere.
      { label: "Courses", icon: BookOpen, to: "/courses", permission: "courses.view", permissionScopes: ["all"] },
      { label: "Faculty", icon: GraduationCap, to: "/faculty", permission: "faculty.view" },
      { label: "Mentors", icon: UserCog, to: "/mentors", permission: "mentors.view" },
      { label: "Batches", icon: Layers, to: "/batches", permission: "batches.view" },
      { label: "Assignments", icon: ClipboardList, to: "/academics/assignments", permission: "assignments.view" },
      { label: "Projects", icon: FolderGit2, to: "/academics/projects", permission: "assignments.view" },
      { label: "Assessments", icon: FileQuestion, to: "/academics/assessments", permission: "assessments.view" },
      { label: "Forum Moderation", icon: MessagesSquare, to: "/academics/forum-moderation", permission: "forum.moderate" },
    ],
  },
  {
    group: "Catalog & revenue",
    label: "Content",
    icon: BookOpen,
    children: [
      { label: "Video Library", icon: Video, to: "/content/videos", permission: "videolib.view" },
      { label: "Resources", icon: Paperclip, to: "/content/resources", permission: "content.view" },
      { label: "Certificates", icon: Award, to: "/content/certificates", permission: "certificates.view" },
    ],
  },
  {
    label: "Commerce",
    icon: Wallet,
    children: [
      { label: "Payments", icon: CreditCard, to: "/commerce/payments", permission: "payments.view" },
      { label: "Orders", icon: ShoppingCart, to: "/commerce/orders", permission: "orders.view" },
      { label: "Invoices", icon: FileText, to: "/commerce/invoices", permission: "invoices.view" },
      { label: "Refunds", icon: Undo2, to: "/commerce/refunds", permission: "refunds.view" },
      { label: "Coupons", icon: TicketPercent, to: "/commerce/coupons", permission: "coupons.view" },
      { label: "Plans", icon: CalendarClock, to: "/commerce/plans", permission: "emi.view" },
    ],
  },
  {
    group: "Marketing",
    label: "Marketing",
    icon: Megaphone,
    children: [
      { label: "Campaigns", icon: Send, to: "/marketing/campaigns", permission: "campaigns.view" },
      { label: "Referrals", icon: Share2, to: "/marketing/referrals", permission: "referrals.view" },
      // Monthly targets (ADR-0067). Gated on `marketing_targets.manage`, which is seeded to
      // super_admin ALONE outside the permission catalog — so this leaf is invisible to
      // admin, to marketing, and to everyone else. The marketing team does not need it:
      // their own number is a card on their dashboard, not a screen they navigate to.
      { label: "Targets", icon: Target, to: "/marketing/targets", permission: "marketing_targets.manage" },
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
      { label: "Page Builder", icon: LayoutTemplate, to: "/marketing/page-builder", permission: "content.builder" },
      { label: "Site Settings", icon: Settings2, to: "/marketing/site-settings", permission: "site_settings.view" },
      // Phase-11 locked templates (docs/plans/phase-11-locked-templates.md) — colleges are
      // the "items" behind the page builder's colleges_live template sections; managed on
      // their own screen, same `content.*` permissions as Blog CMS's Partners tab.
      { label: "Colleges", icon: School, to: "/marketing/colleges", permission: "content.view" },
      // Reviews — promoted out of the Blog CMS tab strip to its own screen
      // (same shape as Colleges): the homepage "What Our Students Say" section
      // pulls the published rows via /public/testimonials.
      //
      // "Reviews" is the CRM's word for them; the model, API and public-site page are all
      // still `testimonial(s)`, which is why the route below has not moved — the URL is
      // shared with existing bookmarks and the rename is a labelling change, not a
      // re-modelling one.
      { label: "Reviews", icon: Star, to: "/marketing/testimonials", permission: "content.view" },
      { label: "Blog CMS", icon: Newspaper, to: "/marketing/blog-cms", permission: "content.view" },
      { label: "Landing Pages", icon: MousePointerClick, to: "/marketing/landing-pages", permission: "landing_pages.view" },
    ],
  },
  {
    group: "Service & insights",
    label: "Support",
    icon: LifeBuoy,
    children: [
      { label: "Tickets", icon: Ticket, to: "/support/tickets", permission: "tickets.view" },
      { label: "Knowledge Base", icon: BookMarked, to: "/support/kb", permission: "kb.view" },
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
      { label: "Overview", icon: LayoutDashboard, to: "/analytics" },
      { label: "Revenue", icon: IndianRupee, to: "/analytics/revenue", permission: "reports.revenue.view" },
      { label: "Enrollment Trend", icon: TrendingUp, to: "/analytics/enrollment", permission: "reports.enrollment.view" },
      { label: "Lead Funnel", icon: Filter, to: "/analytics/funnel", permission: "reports.funnel.view" },
      // Sits next to the funnel because it answers the follow-up question: the funnel
      // says how many converted, this says who converted them.
      {
        label: "Team Performance",
        icon: Trophy,
        to: "/analytics/lead-performance",
        permission: "reports.lead_performance.view",
      },
      // Directly under Team Performance, which is the same question about leads: that one
      // says who converted them, this says what the team actually took.
      {
        label: "Team Revenue",
        icon: IndianRupee,
        to: "/analytics/team-revenue",
        permission: "reports.revenue.view",
      },
      { label: "Campaign Performance", icon: BarChart3, to: "/analytics/campaigns", permission: "reports.campaigns.view" },
      { label: "Exports", icon: Download, to: "/analytics/exports", permission: "reports.export" },
    ],
  },
  {
    // Organisation — the org chart (docs/specs/org-teams.md, ADR-0069). First entry under
    // People, above Careers and Leave, because it is what those two now depend on: a team
    // decides who approves whose leave.
    //
    // Gated on `org.teams.view`, which admin, hr and branch_manager all hold. The WRITE key
    // (`org.teams.manage`) is narrower and is enforced by the server; the screen hides its
    // buttons for anyone who lacks it. That split matters more than it looks — whoever can
    // edit a team can make themselves somebody's leave approver.
    group: "People",
    label: "Organisation",
    icon: Network,
    children: [
      { label: "Teams", icon: Users, to: "/org/teams", permission: "org.teams.view" },
    ],
  },
  {
    // Hiring (docs/specs/careers-hiring.md, ADR-0066). Sits next to Leave Management: both
    // are staff/people areas rather than parts of the student business.
    //
    // Gated on `careers.*`, NOT `content.*`, even though Openings edits the public website
    // — an application carries a stranger's resume and phone number, so whoever may rewrite
    // the homepage does not thereby get to read CVs. Openings is visible to anyone who can
    // work the queue (`careers.view`) because Applications filters by role; only the writes
    // need `careers.openings.manage`, which the server enforces.
    group: "People",
    label: "Careers",
    icon: Briefcase,
    children: [
      { label: "Applications", icon: FileUser, to: "/careers/applications", permission: "careers.view" },
      { label: "Openings", icon: Briefcase, to: "/careers/openings", permission: "careers.view" },
    ],
  },
  {
    // Staff leave (docs/specs/leave-management.md). Sits here, just above Admin, for the same
    // reason Two-Factor Auth sits below it: this section is half about the signed-in person
    // (My Leave, the calendar) and half administrative (Approvals, Setup), so it belongs
    // beside Admin rather than inside it — filing for leave is not an admin task.
    //
    // Four leaves rather than one tabbed page because they have four different audiences. The
    // sidebar hides what the viewer lacks, so an ordinary member of staff sees only My Leave
    // and Calendar; `leave.approve` and `leave.manage` are held by super_admin alone
    // (prisma/seed.ts seeds them outside the admin catch-all), so Approvals and Setup are
    // invisible to everybody else — including Admin.
    label: "Leave Management",
    icon: CalendarDays,
    children: [
      { label: "My Leave", icon: CalendarOff, to: "/leave", permission: "leave.view" },
      { label: "Approvals", icon: CheckCheck, to: "/leave/approvals", permission: "leave.approve" },
      { label: "Calendar", icon: CalendarDays, to: "/leave/calendar", permission: "leave.calendar.view" },
      { label: "Setup", icon: SlidersHorizontal, to: "/leave/setup", permission: "leave.manage" },
    ],
  },
  {
    group: "Administration",
    label: "Admin",
    icon: ShieldCheck,
    children: [
      { label: "Users", icon: Users, to: "/admin/users", permission: "users.view" },
      { label: "Roles & Permissions", icon: ShieldCheck, to: "/admin/roles", permission: "roles.view" },
      { label: "Branches", icon: Building2, to: "/admin/branches", permission: "branches.view" },
      // The course-type list the student form's dropdown reads (ADR-0068). Gated on the
      // MANAGE key, not on students.view: everyone can read the list (that is what makes
      // the picker work) but only admins have anything to do on this screen.
      { label: "Course Types", icon: GraduationCap, to: "/admin/course-types", permission: "course_types.manage" },
      { label: "Audit Logs", icon: ScrollText, to: "/admin/audit-logs", permission: "audit_logs.view" },
      { label: "Message Templates", icon: Mail, to: "/admin/notifications", permission: "campaigns.view" },
      { label: "Automatic Emails", icon: Send, to: "/admin/email-templates", permission: "settings.view" },
      { label: "Settings", icon: Settings, to: "/admin/settings", permission: "settings.view" },
    ],
  },
  {
    // LAST ITEM, deliberately: this is the only nav entry that is about the signed-in
    // person rather than the business, so it sits below the operational sections rather
    // than inside Admin (where it would read as an admin-only tool — every role holds
    // `twofa.manage` at own-scope and every role should be able to enrol).
    //
    // The same TwoFactorPanel also still renders as a tab inside Admin ▸ Settings; this
    // promotes it to a directly-linkable page so enrolling doesn't require knowing it is
    // buried three clicks deep behind a settings tab.
    label: "Two-Factor Auth",
    icon: KeyRound,
    to: "/account/two-factor",
    permission: "twofa.manage",
  },
];

// Kept separate (not yet in the §10 tree as its own top-level item) but
// referenced from "Academics" — exported for a future "today's schedule"
// dashboard widget seam.
export const CALENDAR_ICON = Calendar;
