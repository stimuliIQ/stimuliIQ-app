# Student Onboarding Form — `/onboarding`

**Status:** shipped. **ADR:** [0064](../adr/0064-onboarding-form-crm-authored-questions.md).

Replaces the Google Form students filled after paying. The responses now land in the CRM
under **Onboarding**, and the questions themselves are edited there too.

---

## 1. What it is

One page, served at `stimuliiq.com/onboarding` (`localhost:3000/onboarding` in dev), styled to
read like the Google Form it replaces: a coloured header strip, a title card, then one card
per question. A student fills it in once, after paying, and uploads their payment receipt.

**The defining property: the question set is data, not code.** Staff open CRM ▸ Onboarding ▸
Form fields and add, rename, retype, reorder, require, hide or delete any question. Nothing
in `apps/web` hardcodes "Name" or "Payment Receipt" — the page renders whatever
`GET /public/onboarding/form` returns. This is what the Google Form gave the team, and it is
the property the replacement had to keep.

---

## 2. Seeded questions

`prisma/seed.ts` (fresh dev DB) and `pnpm db:seed:onboarding` (an existing DB — safe, additive,
never overwrites a staff edit) insert the nine questions below, in the Google Form's order. They carry
no special status afterwards — they are ordinary rows, editable and deletable like any
staff-added question.

| # | Question | Type | Required | Notes |
|---|----------|------|----------|-------|
| 1 | Name | text | ✔ | `identityRole: name` → CRM Name column |
| 2 | Email ID | email | ✔ | `identityRole: email` |
| 3 | Contact Number | phone | ✔ | `identityRole: phone`; 10 local digits, stored E.164 |
| 4 | Whatsapp Number | phone | ✔ | |
| 5 | College Name | text | ✔ | |
| 6 | Program | program | ✔ | live dropdown of published programs |
| 7 | Month Opted | radio | ✔ | Sep–Dec + "Other:" free text |
| 8 | Referrals from the batch | textarea | ✘ | |
| 9 | Payment Receipt | file | ✔ | JPG/PNG/WEBP/HEIC/PDF, ≤10 MB |

Two deliberate departures from the Google Form:

- **Program is a field, not a header.** The original hardcoded "Psychology Fellowship
  Program 2026" in its title, which goes stale annually and forces a new form per cohort.
  A `program`-typed question is filled live from published, enrollment-open programs and
  tags every submission — so one permanent link keeps working.
- **The contact number in the header comes from `apps/web/src/lib/contact.ts`**, the site's
  single source of truth, rather than the different number the Google Form carried.

---

## 3. Answer types

`text` · `textarea` · `email` · `phone` · `number` · `date` · `select` · `radio` ·
`checkbox` · `file` · `program`

`select`/`radio` carry `options` (one choice per line in the CRM) and an optional
`allowOther` — Google Forms' "Other:" escape hatch, which lets any free text through.
`program` is the only type with behaviour beyond presentation (see above). `file` uploads
through a signed PUT and stores an opaque key, never a URL.

---

## 4. Data model

Two tables (`prisma/migrations/20260807100000_onboarding_form/`):

**`onboarding_fields`** — the questions. `key` is immutable after create; `identity_role`
marks which question feeds each CRM list column; `sort_order` is the staff-chosen sequence;
`active` hides a question without deleting it. Partial-unique `(tenant_id, key) WHERE
deleted_at IS NULL` lives in the migration SQL only (Prisma can't express it).

**`onboarding_submissions`** — the answers. `answers` is a self-describing JSON snapshot:

```json
[{ "fieldId": "…", "key": "payment_receipt", "label": "Payment Receipt",
   "type": "file", "value": "receipt.png", "storageKey": "onboarding/{tenant}/{uuid}-receipt.png" }]
```

The label and type are frozen at submit time **because fields are editable**. Renaming
"College Name" to "Institution" next year must not retroactively relabel answers already
collected, and deleting a question must not orphan its answers.

`full_name` / `email` / `phone` / `program_id` are denormalised out of `answers` purely so
the CRM list can show columns, search and sort without opening a JSONB blob per row. They
are a projection — `answers` stays the source of truth, and they are NULL if staff removed
the corresponding question.

---

## 5. Endpoints

**Public** (`PublicOnboardingController`, no guards, CSRF-excluded — ADR-0019):

| Method | Path | Gate |
|--------|------|------|
| GET | `/public/onboarding/form` | rate limit only (it renders the page) |
| POST | `/public/onboarding/upload-url` | captcha + rate limit |
| POST | `/public/onboarding/submit` | captcha + rate limit |

**CRM** (`JwtAuthGuard` + `PermissionsGuard` + `ScopeInterceptor`, `scope=all` only):

| Method | Path | Permission |
|--------|------|-----------|
| GET | `/crm/onboarding/fields` | `onboarding.view` |
| POST · PATCH · DELETE | `/crm/onboarding/fields[/:id]` | `onboarding.fields.manage` |
| POST | `/crm/onboarding/fields/reorder` | `onboarding.fields.manage` |
| GET | `/crm/onboarding/submissions[/:id]` | `onboarding.view` |
| PATCH | `/crm/onboarding/submissions/:id` | `onboarding.edit` |
| DELETE | `/crm/onboarding/submissions/:id` | `onboarding.delete` |

`onboarding.fields.manage` is a separate key on purpose: a counsellor should work the intake
queue without being able to delete the payment-receipt question out of the live form.
`onboarding.view`/`.edit` are granted to counsellor and support at `scope=all`; the other
two reach admin/super_admin through the catalog catch-all.

---

## 6. Validation

A form whose questions live in a table cannot be validated by a fixed DTO, so the wire
schema checks only the envelope and the per-field rules come from
`buildOnboardingAnswerIssues()` (`@repo/types`) — **run identically by the browser (inline
errors) and the API (the 422 body)**. Server 422s carry the standard problem-details
`errors[]` with `path: "answers.<fieldKey>"`, which the form unpacks back under each
question.

Two checks are server-only, because the browser has no standing to make them:

1. a submitted program id must be a real published program;
2. a submitted file key must start with `onboarding/{tenantId}/` — otherwise an anonymous
   submitter could make the CRM later mint a signed download URL for another tenant's
   object (the hole Wave-6 M3 closed for career resumes).

Answers to unknown keys are ignored rather than rejected: a student mid-form when staff
deactivate a question should not hit a hard error on a question that no longer exists.

---

## 7. CRM screen

**Submissions** — table (name / email / phone / program / status / submitted), searchable
across the three identity columns, filterable by status, paginated. A paperclip marks rows
carrying an attachment, so a missing receipt is visible without opening anything. Clicking a
row opens a drawer showing **every answer**, rendered from the stored snapshot; file answers
become links to short-lived signed URLs minted per request. Staff set `status`
(new / in review / verified / rejected) and internal notes — nothing else. The answers are
the record of what the student sent, and an editable record is not evidence.

**Form fields** — the question list with up/down reordering, an Add-question drawer, and
per-row edit/delete. Deleting says plainly that answers already collected are kept.

---

## 8. Hosting

One route on the main site: **`stimuliiq.com/onboarding`** (`localhost:3000/onboarding` in
dev). That path is the link staff hand to students. No extra deploy step — it ships with
any normal `web` deploy.

A `onboarding.stimuliiq.com` subdomain was built first (a Host-header rewrite in
`apps/web/src/middleware.ts`) and then **removed** on the product owner's call: it needed a
DNS record and a Vercel domain attachment to work at all, and the middleware ran on every
request to the entire site to serve one page. If it is ever wanted again, it is ~20 lines
of middleware plus the Vercel domain — the page itself needs no change.

`SiteShell` drops the marketing header/footer/WhatsApp FAB/lead popup for `/onboarding` —
the same treatment `/pay/:token` gets. The page is `noindex`: it is a private post-payment
link, not a public intake form.

The CRM's "Open the form" link is built with `onboardingFormUrl()`
(`apps/crm/src/lib/public-urls.ts`), so it resolves against `VITE_WEB_APP_URL` — localhost
in dev, the real site in production — rather than a hardcoded host.

---

## 9. Security posture

Mirrors `content-intake.service.ts` (the established anonymous-write convention):

- captcha-gated + per-IP rate-limited on every write;
- raw IP never stored, only SHA-256 (DPDP), matching `Lead`/`ContactSubmission`;
- free text HTML-stripped at write time (anonymous, untrusted input);
- signed-URL delivery only for receipts — `onboarding/` is deliberately **not** in
  `PUBLIC_ASSET_PREFIXES`, since a receipt carries an amount and a bank/UPI reference;
- both models are in `AUDITED_MODELS` and `SOFT_DELETE_MODELS`;
  `OnboardingSubmission.{fullName,email,phone}` are in `PII_FIELD_REGISTRY`.

---

## 10. How to verify

```bash
pnpm --filter @repo/types build && pnpm --filter @repo/api-client build
npx prisma migrate deploy          # applies 20260807100000_onboarding_form
pnpm --filter @repo/db seed        # or: npx prisma db seed — inserts the 8 questions + permissions
```

Then:

1. **API** — `curl localhost:4000/api/v1/public/onboarding/form` returns the 8 questions.
2. **Web** — open `http://localhost:3000/onboarding`; the form renders card-per-question
   with no marketing chrome. Submit empty → every required question shows its own error.
3. **CRM** — log in as super_admin, open **Onboarding**. The submission appears with its
   receipt link; the Form fields tab lists the 8 questions.
4. **The point of the whole thing** — add a question in Form fields, reload the public form:
   it is there, with no deploy.

Tests: `apps/api` `src/modules/onboarding/*.spec.ts` (51),
`packages/types/src/onboarding/onboarding.spec.ts` (14),
`apps/crm/src/components/onboarding/onboarding-workspace.test.tsx` (9).
