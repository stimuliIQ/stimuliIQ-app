// Route tree assembly (code-based, not file-based codegen — docs/04 §3.4).
// Wave 4a wired Dashboard/Students/Faculty/Courses. Wave 4b added Batches +
// Admin (Roles & Permissions/Branches/Audit Logs). Phase 2 Wave 5a adds the
// Commerce routes (Orders/Payments/Invoices/Refunds/Coupons) — see
// nav-config.ts for the full IA this route tree matches. Leads routes are
// Wave 5b and slot in alongside these the same way.
// Phase 4 (Wave 5) adds Academics > Assignments/Projects/Assessments and
// Content > Certificates per docs/plans/phase-4.md task #9.
// Phase 8 (docs/specs/phase-8-mentor.md) adds Academics > Mentors (WS-1
// directory; WS-2/WS-3 assignment + completion live inside the existing
// Batches detail drawer) and the standalone Mentor-role dashboard route
// (WS-4, LOCK-3 — same crm app, not the LMS).
// Phase 9 Completion (docs/plans/phase-9-completion.md, T37-T40) adds every
// route behind the 15 comingSoon nav leaves, plus 4 composed Analytics
// reports and the Student 360 detail (no new route — lives in the existing
// student-detail-drawer).
import { createRouter } from "@tanstack/react-router";

import { rootRoute } from "./routes/root-route";
import { dashboardRoute } from "./routes/dashboard-route";
import { studentsRoute } from "./routes/students-route";
import { studentsAdmissionsRoute } from "./routes/students-admissions-route";
import { studentsAlumniRoute } from "./routes/students-alumni-route";
import { studentsImportRoute } from "./routes/students-import-route";
import { facultyRoute } from "./routes/faculty-route";
import { coursesRoute } from "./routes/courses-route";
import { batchesRoute } from "./routes/batches-route";
import { adminRolesRoute } from "./routes/admin-roles-route";
import { adminBranchesRoute } from "./routes/admin-branches-route";
import { adminUsersRoute } from "./routes/admin-users-route";
import { adminAuditRoute } from "./routes/admin-audit-route";
import { adminSettingsRoute } from "./routes/admin-settings-route";
import { adminFeatureFlagsRoute } from "./routes/admin-feature-flags-route";
import { commerceOrdersRoute } from "./routes/commerce-orders-route";
import { commercePaymentsRoute } from "./routes/commerce-payments-route";
import { commerceInvoicesRoute } from "./routes/commerce-invoices-route";
import { commerceRefundsRoute } from "./routes/commerce-refunds-route";
import { commerceCouponsRoute } from "./routes/commerce-coupons-route";
import { commercePlansRoute } from "./routes/commerce-plans-route";
import { leadsPipelineRoute } from "./routes/leads-pipeline-route";
import { leadsCounsellingRoute } from "./routes/leads-counselling-route";
import { leadsTasksRoute } from "./routes/leads-tasks-route";
import { leadsBookingsRoute } from "./routes/leads-bookings-route";
import { leadsContactMessagesRoute } from "./routes/leads-contact-messages-route";
import { academicsAssignmentsRoute } from "./routes/academics-assignments-route";
import { academicsProjectsRoute } from "./routes/academics-projects-route";
import { academicsAssessmentsRoute } from "./routes/academics-assessments-route";
import { academicsAttendanceRoute } from "./routes/academics-attendance-route";
import { contentCertificatesRoute } from "./routes/content-certificates-route";
import { contentVideosRoute } from "./routes/content-videos-route";
import { contentResourcesRoute } from "./routes/content-resources-route";
import { marketingCampaignsRoute } from "./routes/marketing-campaigns-route";
import { marketingReferralsRoute } from "./routes/marketing-referrals-route";
import { marketingLandingPagesRoute } from "./routes/marketing-landing-pages-route";
import { marketingBlogCmsRoute } from "./routes/marketing-blog-cms-route";
import { marketingPageBuilderRoute } from "./routes/marketing-page-builder-route";
import { marketingSiteSettingsRoute } from "./routes/marketing-site-settings-route";
import { marketingCollegesRoute } from "./routes/marketing-colleges-route";
import { marketingTestimonialsRoute } from "./routes/marketing-testimonials-route";
import { supportTicketsRoute } from "./routes/support-tickets-route";
import { supportKbRoute } from "./routes/support-kb-route";
import { adminNotificationsRoute } from "./routes/admin-notifications-route";
import { forumModerationRoute } from "./routes/forum-moderation-route";
import { analyticsOverviewRoute } from "./routes/analytics-overview-route";
import { analyticsRevenueRoute } from "./routes/analytics-revenue-route";
import { analyticsEnrollmentRoute } from "./routes/analytics-enrollment-route";
import { analyticsFunnelRoute } from "./routes/analytics-funnel-route";
import { analyticsAttendanceRoute } from "./routes/analytics-attendance-route";
import { analyticsEngagementRoute } from "./routes/analytics-engagement-route";
import { analyticsCampaignsRoute } from "./routes/analytics-campaigns-route";
import { analyticsGamificationRoute } from "./routes/analytics-gamification-route";
import { analyticsForumHealthRoute } from "./routes/analytics-forum-health-route";
import { analyticsCohortRoute } from "./routes/analytics-cohort-route";
import { analyticsBranchComparisonRoute } from "./routes/analytics-branch-comparison-route";
import { analyticsFacultyPerformanceRoute } from "./routes/analytics-faculty-performance-route";
import { analyticsRefundsRoute } from "./routes/analytics-refunds-route";
import { analyticsExportsRoute } from "./routes/analytics-exports-route";
import { analyticsSchedulesRoute } from "./routes/analytics-schedules-route";
import { mentorsRoute } from "./routes/mentors-route";
import { mentorDashboardRoute } from "./routes/mentor-dashboard-route";
import { forgotPasswordRoute } from "./routes/forgot-password-route";
import { resetPasswordRoute } from "./routes/reset-password-route";
import { callCenterRoute } from "./routes/call-center-route";
import { leadsImportRoute } from "./routes/leads-import-route";
// Student onboarding form (stimuliiq.com/onboarding) — submissions + the CRM-authored
// question set that drives the public form.
import { onboardingRoute } from "./routes/onboarding-route";

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  studentsRoute,
  studentsAdmissionsRoute,
  studentsAlumniRoute,
  studentsImportRoute,
  facultyRoute,
  coursesRoute,
  batchesRoute,
  adminRolesRoute,
  adminBranchesRoute,
  adminUsersRoute,
  adminAuditRoute,
  adminSettingsRoute,
  adminFeatureFlagsRoute,
  commerceOrdersRoute,
  commercePaymentsRoute,
  commerceInvoicesRoute,
  commerceRefundsRoute,
  commerceCouponsRoute,
  commercePlansRoute,
  leadsPipelineRoute,
  leadsCounsellingRoute,
  leadsTasksRoute,
  leadsBookingsRoute,
  leadsContactMessagesRoute,
  leadsImportRoute,
  callCenterRoute,
  academicsAssignmentsRoute,
  academicsProjectsRoute,
  academicsAssessmentsRoute,
  academicsAttendanceRoute,
  contentCertificatesRoute,
  contentVideosRoute,
  contentResourcesRoute,
  marketingCampaignsRoute,
  marketingReferralsRoute,
  marketingLandingPagesRoute,
  marketingBlogCmsRoute,
  marketingPageBuilderRoute,
  marketingSiteSettingsRoute,
  marketingCollegesRoute,
  marketingTestimonialsRoute,
  supportTicketsRoute,
  supportKbRoute,
  adminNotificationsRoute,
  forumModerationRoute,
  analyticsOverviewRoute,
  analyticsRevenueRoute,
  analyticsEnrollmentRoute,
  analyticsFunnelRoute,
  analyticsAttendanceRoute,
  analyticsEngagementRoute,
  analyticsCampaignsRoute,
  analyticsGamificationRoute,
  analyticsForumHealthRoute,
  analyticsCohortRoute,
  analyticsBranchComparisonRoute,
  analyticsFacultyPerformanceRoute,
  analyticsRefundsRoute,
  analyticsExportsRoute,
  analyticsSchedulesRoute,
  mentorsRoute,
  mentorDashboardRoute,
  onboardingRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
