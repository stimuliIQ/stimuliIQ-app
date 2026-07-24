# 02 — PRD: Student Learning Portal / LMS (`lms`)

*Where enrolled students learn, build, get assessed, and earn verifiable certificates.*

---

## 1. Purpose
Deliver a focused, motivating, mobile-first learning experience that drives completion,
skill mastery, and certification — and protects content.

## 2. Business goals
Maximize completion %, assessment pass %, certificates issued (the North Star), retention
across the batch, and word-of-mouth via great outcomes. Reduce support load via self-serve.

## 3. User goals
Resume instantly, watch protected recorded/live classes, submit assignments/projects, track
progress, download notes (incl. offline), pass assessments, get certified, get help fast.

## 4. Personas: **Priya** (mobile/low-data), **Rahul** (flexible recorded), **Aarav**
(ambitious completer), **Vikram** (faculty as author/grader in CRM).

## 5. Pain points addressed
Heavy portals on weak phones, live-only rigidity, lost place in videos, no motivation,
unclear progress, slow support, content easily pirated. Responses below.

## 6. Success metrics
| Metric | Target |
|--------|--------|
| Video completion % | ≥ 70% |
| Assignment submission rate | ≥ 80% |
| Program completion % | ≥ 60% |
| Assessment pass % | ≥ 75% |
| WAU/MAU (in-batch) | ≥ 0.6 |
| Mobile TTI (4G) | < 3s |

---

## 7. Functional requirements

### 7.1 Dashboard
"Continue learning" rail (resume video at timestamp), next live class with countdown +
join button, progress ring per course, upcoming assignment/assessment deadlines,
announcements, streak + recent badges, quick links (downloads, support).

### 7.2 My Courses
Enrolled programs as cards (cover, progress %, next item). Course view = curriculum tree
(sections → lessons: video / reading / assignment / quiz), completion checkmarks, locked
items if sequential path enabled.

### 7.3 Recorded classes (video player)
- **Protected streaming:** signed short-lived **HLS** URLs, adaptive bitrate, per-user
  **watermark** overlay (name + id), no raw file URL, disabled right-click/download.
- Resume from last position, speed control, captions, quality selector, chapters,
  notes/bookmarks at timestamps, "mark complete," autoplay next.
- "Continue watching" + watch history.

### 7.4 Live classes
Schedule list + calendar, **Join** (Zoom SDK / Google Meet) with attendance auto-marked on
join, reminders (push/WhatsApp/email), recording auto-appears in recorded section after.

### 7.5 Assignments
List by course with status (assigned/submitted/graded/overdue), detail (instructions,
attachments, due date), submit (file upload / text / link), resubmission if allowed,
view grade + rubric + feedback, deadline reminders.

### 7.6 Projects
Multi-milestone submissions, repo/link + files, mentor review states, feedback threads,
final project gates certificate eligibility.

### 7.7 Attendance & calendar
Attendance % per course (live joins + recorded completion policy), unified calendar (live
classes, deadlines, assessments), iCal export.

### 7.8 Downloads & resources
Notes, slides, datasets, cheat-sheets per lesson; **offline download** (encrypted local
cache where supported / PWA); search + filter by course/type.

### 7.9 Assessments
Quizzes & timed tests (MCQ, code, descriptive), auto-grading for objective, attempts
policy, instant score for objective, pass threshold feeds certificate eligibility,
anti-cheat basics (shuffle, time-box, tab-switch flag).

### 7.10 Progress tracking & analytics
Per-course completion %, time-spent, streaks, strengths/weaknesses by topic (from
assessments), learning-path progress, weekly summary.

### 7.11 Certificates
Eligibility = course completion + assessments passed + final project approved. One-click
**download (PDF)**, share to LinkedIn, each carries a **verification ID** linking to the
public verify page (`web`).

### 7.12 Gamification
XP/points for completions, **badges/achievements**, streaks, **leaderboard** (batch-level,
opt-in, privacy-safe), milestone celebrations. Tuned to encourage, never shame.

### 7.13 Learning path
Recommended sequence within/across programs; "what to do next"; optional prerequisites/
locking; future AI recommendations.

### 7.14 Discussion forum
Per-course/batch threads, Q&A with mentor/peer answers, upvotes, mark-as-resolved,
moderation (handled in CRM), notifications on replies.

### 7.15 Notifications
In-app center + push + email + WhatsApp (preference-controlled): deadlines, grades, live
reminders, announcements, replies, certificate ready.

### 7.16 Profile, settings, support
Profile (photo, bio, skills, enrolled programs, certificates), settings (notification
prefs, password, language, video quality default, theme), **support/help desk** (raise
ticket → CRM, status tracking), FAQ/help center, **feedback** (course + session ratings).

### 7.17 Search, filters, bookmarks
Global search (lessons, resources, forum), filters per list, bookmarks across videos/
resources/forum.

---

## 8. Non-functional requirements
Mobile-first PWA, offline-capable downloads, video start <2s, resilient to flaky networks
(retry/resume), p95 API <300ms reads, signed-media security, a11y AA, graceful empty/error
states everywhere.

## 9. Roles & permissions (LMS surface)
| Capability | Student | Faculty* |
|------------|---------|-----------------|
| View enrolled course content | ✅ (own enrollments) | ✅ (assigned batches) |
| Submit assignment/project | ✅ | — |
| Grade / give feedback | — | ✅ (in CRM authoring views) |
| Post in forum | ✅ | ✅ |
| Download certificate | ✅ (when eligible) | — |
| See others' grades | — | ✅ (own batches) |

*Faculty primarily author/grade in the CRM; LMS shows the student-facing side. RBAC is
server-enforced; a student only ever sees their own enrollments.

P8's Mentor role (external-hire batch lead, `docs/specs/phase-8-mentor.md`) is a
distinct, CRM-only role with no row in this table — it ships no LMS-facing UI (no
"meet your mentor" card); a mentor logs into `crm`, not `lms`.

## 10. Navigation & IA
```
LMS
├─ Dashboard (continue learning, next live, deadlines)
├─ My Courses ▸ Course ▸ Lesson(video/reading/assignment/quiz)
├─ Live Classes (schedule, join)
├─ Assignments | Projects
├─ Assessments
├─ Calendar
├─ Downloads / Resources
├─ Progress (analytics, badges, leaderboard)
├─ Certificates
├─ Forum
├─ Notifications
└─ Profile / Settings / Support / Feedback
```

## 11. UX strategy
Reduce friction to "resume in one tap." Always show progress + next action. Calm, focused
layout (one task per screen on mobile). Motivation via visible progress, streaks, badges.
Clear states for locked/overdue/graded. Offline-aware UI.

## 12. UI strategy
Clean learning surface, low chrome, content-forward. Course player is the hero: large video,
collapsible curriculum, notes drawer. Consistent status chips (assigned/submitted/graded/
overdue). Dark mode supported (long study sessions).

## 13. Dashboard layout
Top: greeting + streak. Primary: "Continue learning" + next live. Secondary grid:
deadlines, progress rings, announcements, badges. Persistent left nav (desktop) / bottom
tab bar (mobile): Home, Courses, Live, Assignments, Profile.

## 14. Mobile responsiveness
PWA installable, bottom tab nav, swipeable curriculum, adaptive video, downloadable lessons,
data-saver mode, large tap targets, works on mid/low-tier Android.

## 15. Accessibility
Captions on videos, keyboard player controls, screen-reader labels, focus management in
modals/drawers, contrast AA, reduced-motion, transcript availability (future).

## 16. Performance strategy
Adaptive HLS, lazy-load curriculum, route splitting, cached resource lists, optimistic UI
for marks/bookmarks, prefetch next lesson, image/cover optimization, service-worker caching.

## 17. Security
Signed short-lived video URLs, per-user watermark, no source URLs, RBAC server-side,
download tokens, attempt/score integrity on assessments, rate-limited APIs, audited grade
changes.

## 18. Scalability
Video offloaded to streaming provider/CDN; stateless app; per-user data partitionable by
tenant/batch; queue-driven notifications; designed for 10k concurrent learners, 1k streams.

## 19. Gamification & engagement detail
Points table (lesson complete, assignment on-time, quiz pass, streak day), badge catalog
(first project, perfect attendance, top of batch), leaderboard windows (weekly/all-time),
celebration animations (reduced-motion aware).

## 20. Future expansion
AI mentor/chatbot (doubt-solving on lesson context), resume builder, interview prep,
placement portal hooks, alumni/community, AI learning recommendations, peer code review,
mobile native apps.

## 21. Acceptance criteria (samples)
- A student can only stream content for programs they're enrolled in; URLs expire and
  cannot be reused or shared.
- Resuming a video returns to within ±2s of last position across devices.
- Certificate download is blocked until completion + assessment + project gates pass, and
  the issued certificate resolves on the public verify page.
- Attendance auto-marks within 60s of joining a live class.

## 22. Implementation status (as of Phase 9 — `docs/plans/phase-9-completion.md`)

Full functional-requirement coverage was reached this phase, closing every remaining LMS
gap from `docs/go-live-checklist.md` Tier 0/2:

- **Video playback (B4)** — `hls.js` wired into `lesson-video-player.tsx` with native-HLS
  fallback; plays on Chrome/Firefox/Android, not just Safari. Verification against a real
  Mux/Cloudflare Stream account (vs. `VIDEO_PROVIDER=noop`) is still credential-gated —
  see `docs/go-live-checklist.md` B5.
- **§7.4 Live classes** — `LiveClassProvider` (Zoom + Google Meet adapters, ADR-0057)
  built; schedule/join/countdown UI, dashboard live-class widget, and attendance
  auto-sync (≤60s of joining) are live. Real Zoom/Meet vendor verification is
  credential-gated (`docs/phase-9-followups.md` P9-5).
- **§7.8 Downloads & resources** — signed-URL downloads page live (was previously
  withheld with no page).
- Profile & settings page, calendar + iCal export, global search + bookmarks + lesson
  notes (`tsvector`, ADR-0060), and LinkedIn certificate share are all live.
- **§7.16 Support** — in-app support-ticket creation is live (`Ticket`/`TicketMessage`
  model, ADR-0057's sibling help-desk module), reusing the CRM-side SLA/canned-response
  workflow.
- Password reset and TOTP 2FA (admin-facing, not student-facing) shipped alongside as
  platform-wide auth improvements (`docs/go-live-checklist.md` B9, ADR-0058).

Remaining gaps are vendor-credential verification only (live-class and video-transcode
provider accounts) — tracked in `docs/go-live-checklist.md` and
`docs/phase-9-followups.md`. No LMS functional-requirement section is unimplemented.
