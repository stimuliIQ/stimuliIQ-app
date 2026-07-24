# 03 — PRD: Admin CRM Dashboard (`crm`)

*The operations cockpit. Runs the entire business: people, programs, money, content,
marketing, support, analytics — with roles, permissions, and audit trails.*

---

## 1. Purpose
Give staff one source of truth and the tools to run admissions, learning operations,
finance, marketing, and support at scale — with control, visibility, and accountability.

## 2. Business goals
Increase lead→enrollment conversion, operational throughput per staff member, revenue
visibility, and data integrity; reduce leakage, manual work, and errors.

## 3. User goals
- **Counsellor:** work leads fast, never miss a follow-up, convert.
- **Faculty:** manage batches, attendance, grading, content.
- **Ops/Admin:** payments, certificates, reports, settings, control who can do what.
- **Owner:** see revenue/growth/performance instantly; trust the numbers.

## 4. Personas: **Sneha** (counsellor), **Vikram** (faculty), **Meena** (ops),
**Arjun** (owner), plus marketing/finance/support specialists.

## 5. Pain points addressed
Spreadsheets, lost leads, manual certificates, no audit trail, no single dashboard,
unclear permissions, disconnected tools. Responses: integrated CRM + LMS ops + commerce +
analytics with RBAC and audit logs.

## 6. Success metrics
| Metric | Target |
|--------|--------|
| Lead→paid conversion | ≥ 15% |
| Avg lead first-response time | < 30 min |
| Certificate issuance time | < 1 min (automated) |
| Report freshness | near-real-time |
| Failed-payment recovery | ≥ 30% |

---

## 7. Functional requirements (module by module)

### 7.1 Overview dashboard
KPIs: revenue (today/MTD/▲), new leads, conversions, active students, completion %,
pending payments, open tickets, upcoming live classes. Charts: revenue trend, funnel,
enrollment by program, attendance. Role-aware widgets. Date-range + branch filters.

### 7.2 Student management
Directory (search/filter by program, batch, branch, status, payment), profile (KYC,
enrollments, payments, attendance, grades, certificates, tickets, activity timeline),
bulk actions (assign batch, message, export), lifecycle (lead→student→alumni),
soft-delete + restore.

### 7.3 Faculty management
Profiles, expertise, assigned batches/courses, availability, payouts (future), performance
(ratings, grading SLA), access scoping (only their batches).

### 7.4 Course / internship management
Create program (title, domain, level, duration, mode, price, EMI, curriculum builder:
sections→lessons), attach videos/resources/assignments/assessments, publish/unpublish,
versioning, pricing & coupons, SEO fields surfaced to `web`.

### 7.5 Batch management
Create batch (program, start/end, capacity, faculty, schedule, branch, mode), enroll/move
students, batch calendar, batch-level announcements, attendance roster, progress overview,
clone batch.

### 7.6 Payments, invoices, receipts
Order/transaction ledger, Razorpay reconciliation, manual/offline payment entry, EMI plans
+ dunning, refunds (approval workflow), auto **invoice + receipt** PDF generation, coupons/
discounts, revenue by program/branch/period.

### 7.7 Certificates & verification
Certificate templates (designer), eligibility rules engine, **bulk + auto issuance**,
unique verifiable IDs (tamper-evident hash), revoke/reissue, public verification endpoint
feeding `web`, issuance audit.

### 7.8 Attendance, assignments, projects (ops side)
Attendance editor + reports, assignment creation + **rubric grading** + feedback,
project review pipeline (states + threads), grade audit log, bulk grade export.

### 7.9 Video library
Upload → transcode (provider) → captions → attach to lessons, access rules, storage usage,
search, replace/version, view analytics (per video completion).

### 7.10 Live class scheduler
Schedule (program/batch/faculty/time), **Zoom + Google Meet** integration (auto-create
meeting, join links), reminders, recording capture → video library, attendance sync.

### 7.11 CRM pipeline & lead management
Kanban pipeline (New → Contacted → Qualified → Counselling → Negotiation → Won/Lost),
lead source + UTM, assignment rules (round-robin/territory), activity timeline (calls,
notes, WhatsApp, email), follow-up tasks + SLA timers, saved views, bulk actions, lead
scoring (future).

### 7.12 Counselling & admission tracking
Counsellor workspace (today's tasks, due follow-ups), call dispositions, demo/slot bookings
from `web`, conversion tracking, admission checklist (docs, payment, batch assignment).

### 7.13 Marketing
Email campaigns (templates, segments, schedule, metrics), **WhatsApp campaigns** (template
messages, opt-in, delivery/read), coupons/discounts, **referral** + **affiliate** programs,
landing-page + lead-form management, UTM analytics, content/blog CMS for `web`.

### 7.14 Reports & analytics
Revenue, growth, funnel/conversion, enrollment, attendance, completion, faculty
performance, refund, branch comparison, cohort retention, export (CSV/PDF), scheduled
report emails, custom date ranges. Every metric traceable to source rows.

### 7.15 Support / help desk
Ticket inbox (from LMS + email), assignment, SLA, status, canned responses, internal notes,
satisfaction rating, knowledge-base management.

### 7.16 Administration
**Role management + permission matrix** (granular per module/action), **audit logs**
(who/what/when/before-after), **activity logs**, notifications center, **system settings**
(integrations, templates, tax, currency), **company settings** (branding, legal docs),
**branch management + multi-branch** scoping, **multi-tenant readiness** (`tenant_id`),
feature flags.

---

## 8. Non-functional requirements
Dense-but-fast UI, server-side pagination/virtualization for large tables, p95 <300ms,
bulk operations via queues, near-real-time analytics (materialized views/read replica),
exportable everything, a11y AA, full audit + soft delete, role-scoped data isolation.

## 9. Roles & permissions
Default roles: **Owner/Super Admin, Admin, Branch Manager, Counsellor, Faculty, Mentor
(P8 — external-hire batch lead, distinct from Faculty; see `docs/specs/phase-8-mentor.md`),
Finance, Marketing, Support, Content Editor.** Permissions are a **matrix** of
(module × action: view/create/edit/delete/export/approve) with **data scope** (all / branch
/ assigned). Enforced in NestJS guards; UI hides forbidden actions.

| Module | Owner | Admin | BranchMgr | Counsellor | Faculty | Finance | Marketing | Support |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Students | F | F | branch | view/edit (leads) | assigned | view | view | view |
| Faculty | F | F | branch | – | self | – | – | – |
| Courses | F | F | view | view | author | – | view | – |
| Batches | F | F | branch | view | assigned | – | – | – |
| Payments | F | F | branch view | – | – | F | – | – |
| Certificates | F | F | issue | – | recommend | – | – | – |
| Leads/Pipeline | F | F | branch | own/assigned | – | – | F | – |
| Marketing | F | F | – | – | – | – | F | – |
| Reports | F | F | branch | own | own batches | finance | marketing | support |
| Admin/Settings | F | partial | – | – | – | – | – | – |
| Audit logs | F | view | – | – | – | – | – | – |

*F = full. "branch/assigned/own" = data-scoped. Final matrix lives in DB (`role_permissions`).*

## 10. Navigation & IA
```
CRM
├─ Dashboard
├─ Leads ▸ Pipeline | Counselling | Tasks
├─ Students ▸ Directory | Admissions | Alumni
├─ Academics ▸ Courses | Batches | Live Scheduler | Attendance | Assignments | Projects | Assessments
├─ Content ▸ Video Library | Resources | Certificates
├─ Commerce ▸ Payments | Invoices | Refunds | Coupons | Plans
├─ Marketing ▸ Campaigns (Email/WhatsApp) | Referrals | Landing Pages | Blog CMS
├─ Support ▸ Tickets | Knowledge Base
├─ Analytics ▸ Revenue | Growth | Funnel | Performance | Cohorts
└─ Admin ▸ Roles & Permissions | Branches | Audit Logs | Settings | Feature Flags
```
Left nav (collapsible) + top bar (global search, branch switcher, notifications, profile) +
**command palette** (⌘K) for power users.

## 11. UX strategy
Power-user efficiency: keyboard-first, command palette, saved views, bulk actions, inline
edit, optimistic updates, dense tables with sticky headers + filters, clear confirm/undo on
destructive actions, activity timelines for context, never lose work (autosave/drafts).

## 12. UI strategy
Calm, dense, professional (Linear/HubSpot energy). Strong table system, status chips,
side-drawers for detail (don't lose list context), tabbed records, charts for analytics,
consistent action bar, dark mode. Color used for status/semantics, not decoration.

## 13. Dashboard layout
Top KPI cards row → charts row (revenue trend, funnel) → operational lists (today's tasks,
pending payments, open tickets, upcoming classes). Role-aware: counsellor sees pipeline +
tasks first; finance sees revenue; owner sees the full board.

## 14. Mobile responsiveness
Internal tool → desktop-first, but responsive for on-the-go: counsellor mobile view (leads,
tasks, click-to-call/WhatsApp), approvals, dashboards. Tables collapse to cards on mobile.

## 15. Accessibility
AA, keyboard navigation of tables/menus/dialogs, focus management in drawers, screen-reader
labels on icon buttons, contrast, no color-only status (chip + label).

## 16. Performance strategy
Server-side pagination + virtualization, cached aggregates/materialized views for analytics,
debounced search, background jobs for bulk/export/issuance, read replica for reports,
optimistic UI.

## 17. Security
Server-side RBAC + data scoping, audit log on every mutation (before/after), soft delete +
restore, 2FA for admin roles, IP/session controls, signed export links, least-privilege
integration credentials, PII access logging.

## 18. Scalability
Multi-branch now, **multi-tenant SaaS later** (`tenant_id` on all tables, tenant-scoped
queries, per-tenant settings/branding). Queue-driven heavy ops; analytics on read replica;
modules extractable to services.

## 19. Future expansion
Lead scoring + AI assist (draft replies, summarize calls), recruiter/college/parent/alumni
portals (separate surfaces sharing this backend), white-label, subscription billing,
advanced BI, automation builder (if-this-then-that for ops).

## 20. Acceptance criteria (samples)
- A counsellor sees only leads/students in their scope; attempting a forbidden action is
  blocked server-side and logged.
- Every create/update/delete on a sensitive entity writes an audit-log row with actor,
  timestamp, and before/after diff.
- Issuing a certificate generates a verifiable ID that resolves on the public verify page,
  and revocation immediately invalidates it.
- Revenue dashboard totals reconcile exactly with the payments ledger for any date range.

## 21. Implementation status (as of Phase 9 — `docs/plans/phase-9-completion.md`)

All 15 previously `comingSoon` CRM navigation items are now live; every section below
that was a placeholder as of `docs/go-live-checklist.md`'s 2026-07-08 Tier-2 audit is
built:

- **§7.1 Overview dashboard** — role-aware KPI/chart dashboard (was an explicit
  placeholder route).
- **Student 360 profile** — Enrollments/Payments/Attendance/Certificates/Tickets/
  Timeline tabs render real data (previously "Available in a later phase").
- **§7.9 Video library** — upload (presigned) → transcode-webhook status → captions →
  attach-to-lesson workflow live. Real transcode verification is credential-gated
  (Mux/Cloudflare Stream — `docs/go-live-checklist.md` B5).
- **§7.10 Live-class scheduler** — pairs with the LMS join/attendance flow
  (`LiveClassProvider`, ADR-0057); real Zoom/Meet verification is credential-gated.
- **§7.15 Support/help-desk** — tickets + SLA timer + canned responses + KB articles,
  live.
- **Settings (system + company scope), feature flags, attendance editor, certificate
  template designer + bulk issuance, EMI plans + dunning, referrals/affiliates,
  landing-page + lead-form manager, blog/content CMS, bulk actions + saved views,
  reports (cohort/branch/faculty-performance/refund), 2FA enrolment, invoice/receipt PDF
  download** — all live. Notable partial items: the certificate-template designer's
  `layout` persists but is not yet consumed by the PDF renderer
  (`docs/phase-9-followups.md` P9-2); enrollment-time referral auto-conversion is not
  yet wired (P9-9); saved views are persisted on the generic `settings` table rather
  than a dedicated model (P9-10).
- **2FA** (TOTP, `otplib`/`qrcode`) is durably stored in Postgres, not Redis, so a cache
  flush cannot lock out an admin (ADR-0058).

The mentor `branch_id` tenant-wide-visibility question (`docs/phase-8-followups.md` F1)
remains open, carried unresolved into `docs/phase-9-followups.md` P9-8. Multi-tenancy
(`TENANT_SLUG` hardcoded) remains out of scope until a second tenant is imminent
(`docs/go-live-checklist.md` Tier 2).
