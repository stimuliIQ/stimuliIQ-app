// CRM resource aggregator — Phase 1 + Phase 2 + Phase 7 + Phase 8, Wave 2 / Wave 1.
// Phase 1 (docs/plans/phase-1.md task #2): students, faculty, courses, batches,
//   enrollments, admin (roles/branches), audit.
// Phase 2 (docs/plans/phase-2.md task #2): leads, activities, bookings.
// Phase 7 (docs/plans/phase-7.md task #4): reports (8 KPI dashboards),
//   exports (on-demand CSV/PDF + history), reportSchedules (recurring report email).
// Phase 8 (docs/specs/phase-8-mentor.md): mentors (WS-1 hiring-record CRUD),
//   batch-assignment/completion-rollup/mark-complete on `batches.*` (WS-2/WS-3),
//   mentorDashboard (WS-4 — the Mentor role's own `/me/mentor/dashboard`, exposed
//   under `client.crm.*` per LOCK-3: Mentor logs into the crm app, not the LMS).
// Exposed on the SDK as `client.crm.*`. Each resource API is a thin typed
// wrapper over the shared ApiClient http core (cookie + CSRF + envelope
// unwrap + onUnauthorized refresh) — never hand-write fetches (CLAUDE.md §3.2).

import type { ApiClient } from "../http/client.js";
import { StudentsApi } from "./students.api.js";
import { FacultyApi } from "./faculty.api.js";
import { CoursesApi } from "./courses.api.js";
import { BatchesApi } from "./batches.api.js";
import { EnrollmentsApi } from "./enrollments.api.js";
import { RolesApi, BranchesApi, StaffUsersApi } from "./admin.api.js";
import { AuditApi } from "./audit.api.js";
import { LeadsApi } from "./leads.api.js";
import { ActivitiesApi } from "./activities.api.js";
import { BookingsApi } from "./bookings.api.js";
import { ReportsApi } from "./reports.api.js";
import { ExportsApi, ReportSchedulesApi } from "./exports.api.js";
import { MentorsApi } from "./mentors.api.js";
import { MentorDashboardApi } from "./mentor-dashboard.api.js";
import { LiveClassesApi } from "./live-classes.api.js";
import { TicketsApi, CannedResponsesApi, KbArticlesApi } from "./support.api.js";
import { ContentApi, ContentPagesApi, CollegesApi } from "./content.api.js";
// Hiring (ADR-0066) — deliberately NOT under content.*: it is gated by careers.* rather
// than content.*, because an application carries a stranger's resume.
import { CareersApi } from "./careers.api.js";
// Monthly marketing targets (ADR-0067). Own key set (marketing_targets.*), not reports.*:
// the own-card endpoint is for the person measured, not for whoever reads reports.
import { MarketingTargetsApi } from "./marketing-targets.api.js";
import { SiteSettingsApi } from "./site-settings.api.js";
import { SettingsApi } from "./settings.api.js";
import { ReferralsApi } from "./referrals.api.js";
import { EmiPlansApi } from "./emi.api.js";
import { LandingPagesApi } from "./landing-pages.api.js";
import { LeadFormsApi } from "./lead-forms.api.js";
import { BulkActionsApi } from "./bulk-actions.api.js";
import { SavedViewsApi } from "./saved-views.api.js";
import { VideoLibraryApi } from "./video-library.api.js";
import { OnboardingApi } from "./onboarding.api.js";
import { LeaveApi } from "./leave.api.js";
// CRM-managed course types (ADR-0068) — the list that replaced the StudentCourseType enum.
import { CourseTypesApi } from "./course-types.api.js";
// Org hierarchy (ADR-0069) — teams, managers, team leads. Its own key set (org.teams.*)
// rather than admin.*: reading the chart is information every staff role may need, while
// EDITING it decides who signs off whose leave.
import { OrgApi } from "./org.api.js";

/** Admin sub-namespace → `client.crm.admin.roles` / `.branches` / `.users`. */
export class AdminApi {
  readonly roles: RolesApi;
  readonly branches: BranchesApi;
  readonly users: StaffUsersApi;

  constructor(client: ApiClient) {
    this.roles = new RolesApi(client);
    this.branches = new BranchesApi(client);
    this.users = new StaffUsersApi(client);
  }
}

export class CrmApi {
  readonly students: StudentsApi;
  readonly faculty: FacultyApi;
  readonly courses: CoursesApi;
  readonly batches: BatchesApi;
  readonly enrollments: EnrollmentsApi;
  readonly admin: AdminApi;
  readonly audit: AuditApi;
  // Phase 2 — leads pipeline, activities/SLA, bookings/intake
  readonly leads: LeadsApi;
  readonly activities: ActivitiesApi;
  readonly bookings: BookingsApi;
  // Phase 7 — WS-A KPI dashboards, WS-B exports + scheduled reports.
  readonly reports: ReportsApi;
  readonly exports: ExportsApi;
  readonly reportSchedules: ReportSchedulesApi;
  // Phase 8 — mentor hiring-record CRUD (WS-1); batch-assignment/completion-rollup/
  // mark-complete live on `batches.*` (WS-2/WS-3, see batches.api.ts); mentorDashboard
  // is the Mentor role's own scoped `/me/mentor/dashboard` (WS-4).
  readonly mentors: MentorsApi;
  readonly mentorDashboard: MentorDashboardApi;
  // Phase 9 Completion (docs/plans/phase-9-completion.md T14) — live classes,
  // support desk (tickets/canned responses/KB), headless CMS (nested under
  // `content.*`), feature flags, settings, referrals (staff oversight), EMI +
  // dunning, landing pages, lead-form configs.
  readonly liveClasses: LiveClassesApi;
  readonly tickets: TicketsApi;
  readonly cannedResponses: CannedResponsesApi;
  readonly kbArticles: KbArticlesApi;
  readonly content: ContentApi;
  // Alias for `content.pages` — same `ContentPagesApi` instance, exposed at the top level
  // so page-builder callers can write `client.crm.contentPages.*` directly (matches the
  // page-builder media-upload-url contract; `client.crm.content.pages.*` keeps working
  // unchanged for every existing caller).
  readonly contentPages: ContentPagesApi;
  // Alias for `content.colleges` — same `CollegesApi` instance, exposed at the top level
  // (Phase-11 locked templates: "own screen", mirrors mentors/courses). `client.crm.
  // content.colleges.*` keeps working unchanged for every existing caller.
  readonly colleges: CollegesApi;
  /** Job openings + the application review queue: .careers.openings / .careers.applications. */
  readonly careers: CareersApi;

  /** Monthly marketing targets: .mine() for the person measured, the rest for super_admin. */
  readonly marketingTargets: MarketingTargetsApi;
  // Phase-10 page builder (docs/specs/phase-10-page-builder.md) — SiteSetting
  // (nav/footer/SEO/contact/stats), super_admin-only (`site_settings.view`/`.edit`).
  // Page-builder block CRUD itself lives on `content.pages.*` (extends the existing
  // content-pages controller surface) — see content.api.ts.
  readonly siteSettings: SiteSettingsApi;
  readonly settings: SettingsApi;
  readonly referrals: ReferralsApi;
  readonly emiPlans: EmiPlansApi;
  readonly landingPages: LandingPagesApi;
  readonly leadForms: LeadFormsApi;
  // Phase 9 Completion follow-up (docs T30) — promoted from backend-local schemas:
  // bulk actions (leads assign/stage, students status), own-scope saved filter views,
  // video-library ingest/status/caption-attach (T26).
  readonly bulk: BulkActionsApi;
  readonly savedViews: SavedViewsApi;
  readonly videoLibrary: VideoLibraryApi;
  // Student onboarding form (onboarding.stimuliiq.com) — `onboarding.fields.*` authors the
  // question set (staff add/edit/reorder/delete, no deploy) and `onboarding.submissions.*`
  // reads and triages what students sent. The public form is `client.public.onboarding.*`.
  readonly onboarding: OnboardingApi;
  // Staff leave — `leave.requests.*` (apply, withdraw, look), `leave.approvals.*`
  // (super_admin only) and `leave.setup.*` (types, allowances, holidays, working week).
  readonly leave: LeaveApi;
  // Course types — read by every course-type picker (students.view), written only under
  // `course_types.manage`.
  readonly courseTypes: CourseTypesApi;
  // Teams + reporting lines, and `org.myPosition()` — where the signed-in person sits.
  readonly org: OrgApi;

  constructor(client: ApiClient) {
    this.students = new StudentsApi(client);
    this.faculty = new FacultyApi(client);
    this.courses = new CoursesApi(client);
    this.batches = new BatchesApi(client);
    this.enrollments = new EnrollmentsApi(client);
    this.admin = new AdminApi(client);
    this.audit = new AuditApi(client);
    this.leads = new LeadsApi(client);
    this.activities = new ActivitiesApi(client);
    this.bookings = new BookingsApi(client);
    this.reports = new ReportsApi(client);
    this.exports = new ExportsApi(client);
    this.reportSchedules = new ReportSchedulesApi(client);
    this.mentors = new MentorsApi(client);
    this.mentorDashboard = new MentorDashboardApi(client);
    this.liveClasses = new LiveClassesApi(client);
    this.tickets = new TicketsApi(client);
    this.cannedResponses = new CannedResponsesApi(client);
    this.kbArticles = new KbArticlesApi(client);
    this.content = new ContentApi(client);
    this.contentPages = this.content.pages;
    this.colleges = this.content.colleges;
    this.careers = new CareersApi(client);
    this.marketingTargets = new MarketingTargetsApi(client);
    this.siteSettings = new SiteSettingsApi(client);
    this.settings = new SettingsApi(client);
    this.referrals = new ReferralsApi(client);
    this.emiPlans = new EmiPlansApi(client);
    this.landingPages = new LandingPagesApi(client);
    this.leadForms = new LeadFormsApi(client);
    this.bulk = new BulkActionsApi(client);
    this.savedViews = new SavedViewsApi(client);
    this.videoLibrary = new VideoLibraryApi(client);
    this.onboarding = new OnboardingApi(client);
    this.leave = new LeaveApi(client);
    this.courseTypes = new CourseTypesApi(client);
    this.org = new OrgApi(client);
  }
}

export * from "./students.api.js";
export * from "./faculty.api.js";
export * from "./courses.api.js";
export * from "./batches.api.js";
export * from "./enrollments.api.js";
export * from "./admin.api.js";
export * from "./audit.api.js";
export * from "./leads.api.js";
export * from "./activities.api.js";
export * from "./bookings.api.js";
export * from "./reports.api.js";
export * from "./exports.api.js";
export * from "./mentors.api.js";
export * from "./mentor-dashboard.api.js";
export * from "./live-classes.api.js";
export * from "./support.api.js";
export * from "./content.api.js";
export * from "./site-settings.api.js";
export * from "./settings.api.js";
export * from "./referrals.api.js";
export * from "./emi.api.js";
export * from "./landing-pages.api.js";
export * from "./lead-forms.api.js";
export * from "./bulk-actions.api.js";
export * from "./saved-views.api.js";
export * from "./video-library.api.js";
export * from "./onboarding.api.js";
export * from "./leave.api.js";
export * from "./careers.api.js";
export * from "./marketing-targets.api.js";
export * from "./course-types.api.js";
