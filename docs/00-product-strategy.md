# 00 — Product & Business Strategy

*Upgraded research foundation for the 3-app EdTech ecosystem. Read this first.*

---

## 1. Vision & thesis

**Vision:** Become the most trusted internship-to-career platform for Indian students,
where every learner moves from *enrolled → skilled → certified → placed* on one
verifiable track record.

**Why three apps, not one (the core architectural bet):** marketing, learning, and
operations have fundamentally different users, performance profiles, and change cadences.

| App | Optimized for | Traffic shape | Change cadence | Failure tolerance |
|-----|---------------|---------------|----------------|-------------------|
| `web` | Conversion + SEO | Spiky, anonymous, huge | Daily (marketing) | Must never be down |
| `lms` | Engagement + retention | Steady, authenticated | Weekly | Degrade gracefully |
| `crm` | Throughput + control | Low concurrency, heavy ops | Continuous | Internal-only |

Coupling these into one app would force one set of trade-offs onto three problems. Splitting
them lets the website be statically fast and SEO-perfect, the LMS be a focused learning
space, and the CRM be a dense operations cockpit — all over **one shared backend and one
identity system**.

---

## 2. Market & positioning

- **TAM driver:** millions of Indian engineering/degree students need *practical* skills +
  a credible internship credential employers recognize. Colleges mandate internships;
  students need projects + certificates; recruiters need filtered, proven talent.
- **Wedge:** structured, mentor-led, project-based internships with a **verifiable
  certificate** and a path to placement — not just recorded MOOCs.
- **Positioning vs. the field:**

| Competitor | Strength | Gap we exploit |
|------------|----------|----------------|
| Internshala | Brand, listings, marketplace | Thin guided-learning + ops tooling |
| Coursera / Udemy | Catalog, content depth | Impersonal, weak India placement loop |
| Simplilearn / UpGrad / Great Learning | Mentorship, brand | Premium price, heavy funnel |
| Scaler | Outcomes, rigor | Narrow audience, very high price |
| Moodle / Canvas | Mature LMS | DIY, dated UX, no CRM/marketing/commerce |
| Google Classroom | Free, simple | Not commercial-grade, no business ops |

**Our right to win:** an *integrated* stack (marketing + learning + operations + commerce +
verifiable credentials) tuned for the **India price point and channels** (Razorpay,
WhatsApp, regional outreach, college partnerships) that incumbents treat as add-ons.

---

## 3. Business model

- **Primary:** paid internship programs (per-program fee, EMI via Razorpay).
- **Secondary:** bundles / career tracks, college B2B contracts (bulk seats),
  certificate verification as trust infrastructure, placement/recruiter access (future),
  subscriptions for an all-access learning tier (future), referrals & affiliates.
- **Unit economics levers the product must serve:** CAC (website funnel + SEO + referrals),
  conversion rate (lead → enrolled), completion rate (drives outcomes + word-of-mouth),
  refund rate, and LTV (bundles + placement + alumni).

---

## 4. Personas (cross-app)

| Persona | Role | Goals | Pains today | App(s) |
|---------|------|-------|-------------|--------|
| **Aarav** — final-year B.Tech | Prospect → student | Real skills, a project, a credible cert, a job | Scattered resources, scams, unclear ROI | web → lms |
| **Priya** — diploma/degree student, low-end phone | Student | Mobile-first learning, downloadable notes, low data | Heavy portals, poor mobile, no offline | lms |
| **Rahul** — working MCA/MBA learner | Student | Flexible recorded classes, certificate | Live-only schedules, no flexibility | lms |
| **Sneha** — Counsellor | Staff | Convert leads fast, track follow-ups | Spreadsheets, lost leads, no pipeline | crm |
| **Vikram** — Faculty/Mentor | Staff | Run batches, grade, track attendance | Manual grading, no central roster | crm (+ lms author) |
| **Meena** — Operations admin | Staff | Payments, certificates, reports, control | Disconnected tools, no audit trail | crm |
| **Arjun** — Founder/Owner | Admin | Revenue, growth, performance at a glance | No single source of truth | crm |
| **Divya** — College TPO (B2B, future) | Partner | Manage cohorts, see outcomes | Email back-and-forth | college portal |
| **Karthik** — Recruiter (future) | Partner | Find proven, certified talent | Unverified resumes | recruiter portal |

---

## 5. Pain points → product responses (the "why" map)

| Pain | Product response | Lives in |
|------|------------------|----------|
| "Is this legit?" | Verifiable certificates + public verification page + testimonials/partners | web + crm |
| "Will it work on my phone/data?" | Mobile-first, adaptive video, offline downloads | lms |
| "I lose motivation" | Progress, streaks, badges, leaderboard, learning paths | lms |
| "Leads slip away" | CRM pipeline, follow-up tasks, WhatsApp/email automation | crm |
| "Grading is manual" | Assignment/project workflow, rubric grading, auto-assessments | lms + crm |
| "No business visibility" | Revenue/growth/performance dashboards, audit logs | crm |
| "Content gets pirated" | Signed HLS, watermarking, no raw file URLs | lms + backend |

---

## 6. Success metrics (North Star + tree)

**North Star:** **Certified Outcomes per Month** = students who complete a program,
pass assessments, and earn a verified certificate. It couples revenue, learning quality,
and credibility.

| Layer | Metric | Owner app |
|-------|--------|-----------|
| Acquisition | Unique visitors, SEO impressions, CTR, cost/lead | web |
| Activation | Lead→booked-slot, booked→paid, paid→first-login | web + crm |
| Engagement | WAU/MAU, video completion %, assignment submit rate | lms |
| Retention | Weekly active over batch, drop-off by week | lms |
| Outcome | Program completion %, assessment pass %, certs issued | lms + crm |
| Revenue | MRR/▲, ARPU, refund %, EMI success % | crm |
| Advocacy | NPS, referral rate, alumni placement % | crm + future |

Every dashboard in the CRM should ladder up to this tree (see `03-prd-crm.md`).

---

## 7. Cross-cutting non-functional targets

| Dimension | Target |
|-----------|--------|
| Scale | 100k+ registered, 10k concurrent learners, 1k concurrent video streams |
| Availability | 99.9% (web + auth + LMS read paths) |
| Web performance | LCP < 2.0s, CLS < 0.1, INP < 200ms; Lighthouse SEO ≥ 95 |
| LMS performance | TTI < 3s on mid-tier Android over 4G; video start < 2s |
| API | p95 < 300ms for reads, < 800ms for writes |
| Security | OWASP Top 10, RBAC server-side, signed media, audited mutations |
| Accessibility | WCAG 2.2 AA across all three apps |
| Data | Soft delete + audit log on all sensitive entities; PITR backups |
| Privacy | India DPDP-aligned consent, data export/delete, PII minimization |

---

## 8. Competitive UX patterns worth adopting

- **Coursera/Udemy:** "Continue learning" resume rail, progress rings, course landing pages
  with social proof above the fold.
- **Internshala:** clear program cards, trust badges, simple apply/book funnel.
- **Scaler/UpGrad:** counsellor-led funnel, structured curriculum view, outcome storytelling.
- **HubSpot/Salesforce:** pipeline kanban, activity timeline per contact, saved views,
  bulk actions, permission matrices.
- **Notion/Linear:** dense-but-calm internal UI, keyboard-first, fast command palette — the
  bar for the CRM's feel.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Content piracy | Signed short-lived HLS URLs, per-user watermark, no downloadable source |
| Payment failures / EMI churn | Retry + dunning queue, multiple methods, clear receipts |
| Live-class scaling | Provider abstraction, recorded fallback, capacity-aware scheduling |
| Lead leakage | Single CRM source of truth, automated follow-up, SLA timers |
| Over-building early | Strict phase gates (CLAUDE.md §6); future portals are P8, behind flags |
| Vendor lock-in | Every integration behind a provider interface |

---

## 10. What "investor-grade" means for this build

1. One identity, three surfaces — clean separation, shared trust.
2. Every number on a dashboard traceable to a row in the DB (audit + reporting).
3. Verifiable credentials as a moat (public verification, tamper-evident).
4. Multi-branch today, multi-tenant SaaS tomorrow (schema carries `tenant_id` from day 1).
5. Unit-economics instrumentation baked into the funnel, not bolted on.
