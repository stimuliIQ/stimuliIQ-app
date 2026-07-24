// LMS resource aggregator — Phase 3, Wave 2 (docs/plans/phase-3.md task #2).
//
// Exposed on the SDK as `client.lms.*`. Each resource API is a thin typed
// wrapper over the shared ApiClient http core (cookie + CSRF + envelope
// unwrap + onUnauthorized refresh) — never hand-write fetches (CLAUDE.md §3.2).
//
// Namespace layout:
//   client.lms.dashboard.get()           — GET /me/dashboard
//   client.lms.enrollments.list()        — GET /me/enrollments
//   client.lms.enrollments.get(id)       — GET /me/enrollments/:id
//   client.lms.enrollments.getCurriculum(id) — GET /me/enrollments/:id/curriculum
//   client.lms.lessons.get(id)           — GET /lessons/:id
//   client.lms.lessons.getStreamUrl(id)  — GET /lessons/:id/stream-url (SECURITY-CRITICAL)
//   client.lms.progress.ping(id, body)   — PUT /me/lessons/:id/progress
//   client.lms.progress.complete(id)     — POST /me/lessons/:id/complete
//   client.lms.progress.getRollup()      — GET /me/progress
//   client.lms.attendance.list()         — GET /me/attendance
//
// Stream-url contract reminder (see lessons.api.ts for full rules):
//   - `client.lms.lessons.getStreamUrl(id)` is the ONLY way to get a playable URL.
//   - Call it just before playback; re-call on expiry (`response.expiresAt`).
//   - NEVER cache or log `response.url`. MUST render `response.watermark.text`.

import type { ApiClient } from "../http/client.js";
import { DashboardApi } from "./dashboard.api.js";
import { LmsEnrollmentsApi } from "./enrollments.api.js";
import { LessonsApi } from "./lessons.api.js";
import { ProgressApi } from "./progress.api.js";
import { AttendanceApi } from "./attendance.api.js";
import { LmsLiveClassesApi } from "./live-classes.api.js";
import { LmsTicketsApi } from "./tickets.api.js";
import { BookmarksApi } from "./bookmarks.api.js";
import { LessonNotesApi } from "./lesson-notes.api.js";
import { SearchApi } from "./search.api.js";
import { LearningPathApi } from "./learning-path.api.js";
import { LmsReferralsApi } from "./referrals.api.js";
import { LmsEmiPlansApi } from "./emi.api.js";

export class LmsApi {
  readonly dashboard: DashboardApi;
  readonly enrollments: LmsEnrollmentsApi;
  readonly lessons: LessonsApi;
  readonly progress: ProgressApi;
  readonly attendance: AttendanceApi;
  // Phase 9 Completion (docs/plans/phase-9-completion.md T14) — own-scope live
  // classes, support tickets, bookmarks, lesson notes, global search, learning
  // path, referrals, EMI plans (read-only).
  readonly liveClasses: LmsLiveClassesApi;
  readonly tickets: LmsTicketsApi;
  readonly bookmarks: BookmarksApi;
  readonly lessonNotes: LessonNotesApi;
  readonly search: SearchApi;
  readonly learningPath: LearningPathApi;
  readonly referrals: LmsReferralsApi;
  readonly emiPlans: LmsEmiPlansApi;

  constructor(client: ApiClient) {
    this.dashboard = new DashboardApi(client);
    this.enrollments = new LmsEnrollmentsApi(client);
    this.lessons = new LessonsApi(client);
    this.progress = new ProgressApi(client);
    this.attendance = new AttendanceApi(client);
    this.liveClasses = new LmsLiveClassesApi(client);
    this.tickets = new LmsTicketsApi(client);
    this.bookmarks = new BookmarksApi(client);
    this.lessonNotes = new LessonNotesApi(client);
    this.search = new SearchApi(client);
    this.learningPath = new LearningPathApi(client);
    this.referrals = new LmsReferralsApi(client);
    this.emiPlans = new LmsEmiPlansApi(client);
  }
}

export * from "./dashboard.api.js";
export * from "./enrollments.api.js";
export * from "./lessons.api.js";
export * from "./progress.api.js";
export * from "./attendance.api.js";
export * from "./live-classes.api.js";
export * from "./tickets.api.js";
export * from "./bookmarks.api.js";
export * from "./lesson-notes.api.js";
export * from "./search.api.js";
export * from "./learning-path.api.js";
export * from "./referrals.api.js";
export * from "./emi.api.js";
