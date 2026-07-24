# 06 — User Flows & Journeys

*End-to-end flows for every actor. Diagrams are mermaid; render in any mermaid viewer.*

---

## 1. Lead → Enrollment (acquisition funnel)
```mermaid
flowchart TD
  A[Visitor lands on web] --> B{Intent?}
  B -->|Browse| C[Programs / Program detail]
  B -->|Talk to human| D[Book Free Slot / WhatsApp]
  C --> E[Lead form or Enroll]
  D --> F[CRM Lead created + UTM + confirmation]
  E --> F
  F --> G[Counsellor assigned - SLA timer]
  G --> H[Counselling call / demo]
  H --> I{Convinced?}
  I -->|No| J[Nurture: follow-up, WhatsApp, offers]
  J --> H
  I -->|Yes| K[Enroll: auth + Razorpay order]
  K --> L[Payment verified - enrollment created]
  L --> M[LMS credentials + welcome]
  M --> N[Lead marked Won - converted_student_id]
```

## 2. Payment journey (idempotent)
```mermaid
flowchart TD
  A[Click Enroll / Pay] --> B[Auth: signup or login]
  B --> C[Create Order - idempotency_key, coupon, EMI]
  C --> D[Razorpay checkout]
  D --> E{Result}
  E -->|Success| F[Webhook: verify signature]
  F --> G{Valid + not processed?}
  G -->|Yes| H[Mark order paid - create payment, enrollment, invoice]
  H --> I[Email receipt + LMS access]
  G -->|No / duplicate| J[Ignore - no double enrollment]
  E -->|Failure| K[Show retry - dunning queue for EMI]
  K --> D
```

## 3. Student learning journey
```mermaid
flowchart TD
  A[Login to LMS] --> B[Dashboard: Continue learning + next live]
  B --> C{Choose}
  C -->|Recorded| D[Stream signed HLS + watermark]
  D --> E[Mark complete - progress updates]
  C -->|Live| F[Join Zoom/Meet - attendance auto-marked]
  C -->|Assignment| G[Submit files/text/link]
  G --> H[Mentor grades - rubric + feedback]
  C -->|Assessment| I[Timed quiz - auto-grade objective]
  E --> J{Eligibility met?}
  H --> J
  I --> J
  J -->|completion + assessments + project| K[Certificate unlocked]
  K --> L[Download PDF + share - verifiable UID]
```

## 4. Assignment journey
```mermaid
flowchart TD
  A[Faculty creates assignment in CRM] --> B[Appears in LMS for batch]
  B --> C[Student submits before due_at]
  C --> D{On time?}
  D -->|No| E[Marked overdue - policy applies]
  D -->|Yes| F[Status: submitted]
  F --> G[Faculty grades with rubric + feedback]
  G --> H[Student sees score + feedback]
  H --> I{Resubmission allowed & needed?}
  I -->|Yes| C
  I -->|No| J[Final grade recorded - feeds progress]
```

## 5. Project submission journey
```mermaid
flowchart TD
  A[Project defined - milestones] --> B[Student submits milestone: repo/link/files]
  B --> C[Mentor reviews - state: changes_requested / approved]
  C -->|Changes| D[Feedback thread] --> B
  C -->|Approved| E{All milestones approved?}
  E -->|No| B
  E -->|Yes| F[Final project approved - certificate gate satisfied]
```

## 6. Certificate journey
```mermaid
flowchart TD
  A[Eligibility engine checks: completion% + assessments passed + project approved] --> B{Eligible?}
  B -->|No| C[Show remaining requirements in LMS]
  B -->|Yes| D[Generate cert: render template -> PDF]
  D --> E[Assign signed verifiable UID + store]
  E --> F[Student downloads / shares to LinkedIn]
  F --> G[Anyone verifies UID on web -> valid]
  G --> H{Revoked later?}
  H -->|Yes| I[Status flips to revoked - verify shows invalid]
```

## 7. Counsellor journey (CRM)
```mermaid
flowchart TD
  A[Login -> Today: due tasks + new leads] --> B[Open lead - timeline + context]
  B --> C[Call / WhatsApp / email - log disposition]
  C --> D[Move stage on pipeline]
  D --> E[Schedule follow-up task - SLA]
  E --> F{Won?}
  F -->|Yes| G[Trigger enroll/payment link - assign batch]
  F -->|No| H[Nurture or mark lost with reason]
```

## 8. Faculty journey (CRM + LMS-author)
```mermaid
flowchart TD
  A[Login - assigned batches only] --> B[Batch roster + progress]
  B --> C{Task}
  C -->|Schedule live| D[Create live class - Zoom/Meet auto link]
  C -->|Take attendance| E[Edit/confirm attendance]
  C -->|Grade| F[Grade assignments/projects - rubric]
  C -->|Content| G[Author lessons/resources/assessments]
  D --> H[Reminders sent to students]
```

## 9. Admin / Owner journey (CRM)
```mermaid
flowchart TD
  A[Login - role-aware dashboard] --> B{Focus}
  B -->|Revenue| C[Payments, refunds, reports - reconcile]
  B -->|People| D[Students / faculty / roles & permissions]
  B -->|Academics| E[Programs, batches, certificates]
  B -->|Marketing| F[Campaigns, coupons, referrals]
  B -->|Governance| G[Audit logs, settings, branches, flags]
  C --> H[Decisions backed by traceable metrics]
```

## 10. Batch lifecycle journey
```mermaid
flowchart TD
  A[Create batch: program, faculty, schedule, capacity, branch] --> B[Enroll students - capacity check]
  B --> C[Batch runs: live classes + recorded + assignments]
  C --> D[Attendance + progress tracked]
  D --> E[Assessments + projects]
  E --> F{Batch end}
  F --> G[Completion eval -> certificates issued]
  G --> H[Batch closed - alumni status]
```

## 11. Enrollment journey (post-payment)
```mermaid
flowchart TD
  A[Payment verified] --> B[Enrollment row created - status active]
  B --> C[Assign to batch - capacity + schedule]
  C --> D[LMS access provisioned]
  D --> E[Welcome notifications: email + WhatsApp]
  E --> F[First-login onboarding checklist]
```

## 12. Support ticket journey
```mermaid
flowchart TD
  A[Student raises ticket in LMS] --> B[Ticket in CRM inbox - SLA]
  B --> C[Assigned to support agent]
  C --> D[Reply / internal note / canned response]
  D --> E{Resolved?}
  E -->|No| D
  E -->|Yes| F[Close - request satisfaction rating]
```

## 13. Marketing campaign journey
```mermaid
flowchart TD
  A[Build segment - leads/students filters] --> B[Pick channel: email / WhatsApp template]
  B --> C[Schedule - opt-in + rate limits]
  C --> D[Queue: campaign-send workers]
  D --> E[Track: sent/delivered/read/clicked]
  E --> F[Conversions attributed back to pipeline]
```

---

## 14. State machines (reference)
- **Lead.stage:** new → contacted → qualified → counselling → negotiation → won | lost
- **Order.status:** created → paid | failed → refunded
- **Enrollment.status:** active → completed | dropped
- **Submission.status:** submitted → graded (→ resubmitted)
- **Certificate.status:** valid → revoked
- **Ticket.status:** open → pending → resolved → closed

Each transition is the unit the `qa-engineer` agent writes e2e/integration tests against,
and every mutating transition writes an `audit_logs` row.
