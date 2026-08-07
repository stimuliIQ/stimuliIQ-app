# ADR 0064: Student onboarding form — CRM-authored questions, one route on the main site

## Status
Accepted.

## Context
Students who had paid were being onboarded through a Google Form ("Onboarding Form —
Psychology Fellowship Program 2026"): name, email, contact number, WhatsApp number, college
name, month opted, referrals, and a required payment-receipt upload. Responses lived in a
Google Sheet, entirely outside the CRM, so staff had to reconcile a spreadsheet against the
system by hand — and the payment receipt, the single most operationally important field,
was a Drive link nobody's RBAC covered.

Two properties of the Google Form were load-bearing and had to survive the move:

1. **Staff could change the questions themselves.** Adding a field was a two-minute edit,
   not a ticket. Any replacement that made "add a question" a deploy would be a downgrade,
   and would predictably get worked around with another Google Form.
2. **It was one link on its own address.** Students were handed a URL and told to fill it
   in. A subdomain (`onboarding.stimuliiq.com`) was the first ask; see (e) for why it was
   dropped in favour of a path.

The form's header also hardcoded one program and one year — the thing that guarantees a
form goes stale and gets re-created annually.

## Decision

**a. The question set is DATA, authored in the CRM — not a schema in code.**
Two tables: `onboarding_fields` (the questions) and `onboarding_submissions` (the answers).
Staff create, rename, retype, reorder, require, deactivate and delete questions from
CRM ▸ Onboarding ▸ Form fields. The eleven answer types (`text`, `textarea`, `email`,
`phone`, `number`, `date`, `select`, `radio`, `checkbox`, `file`, `program`) are the closed
registry; everything else about a question is a row value. `prisma/seed.ts` inserts the
Google Form's eight questions so the form works on day one — and from that moment they are
ordinary, fully editable rows with no special status.

This is deliberately the OPPOSITE of ADR-0063's locked page templates, and for the opposite
reason. A marketing page has a *shape* that non-engineers can break (wrong section order,
missing hero) with consequences visible to every visitor. A form has no shape to break: an
extra question is an extra question. Locking it would buy nothing and cost the property the
Google Form was chosen for.

**b. Because the shape is data, validation cannot be a fixed DTO — so it is a shared
function instead.** `buildOnboardingAnswerIssues()` (`@repo/types`) takes the live field
list plus an answer bag and returns per-field issues. The browser runs it for inline errors;
the API runs the identical function for its 422. Normally "one zod schema, two consumers"
(CLAUDE.md §3.2) provides that guarantee; here no such schema can exist, so this function
is what replaces it. The wire schema validates only the envelope
(`{ answers: Record<key, string|boolean|number>, captchaToken }`).

The two checks the browser has no standing to make stay server-only: that a submitted
program id is a real published program, and that a submitted file key belongs to this
tenant.

**c. Answers are stored as a self-describing SNAPSHOT, not a join.** Each answer records
`{ fieldId, key, label, type, value, storageKey }` frozen at submit time. Fields are
editable and deletable; if answers referenced live rows, renaming "College Name" to
"Institution" would retroactively relabel every answer ever collected, and deleting a
question would orphan its answers outright. `field.key` is therefore immutable after create
(the update DTO has no `key` — staff edit the visible `label`).

`full_name`/`email`/`phone`/`program_id` are additionally denormalised onto the submission
row so the CRM list can render columns, search and sort without cracking a JSONB blob per
row. They are a projection, populated from whichever fields carry the matching
`identity_role` — a per-field setting, not a magic key name, so staff can replace the
question feeding a column without the column going blank.

**d. One permanent link: the program is a live dropdown, not a header.** A `program`-typed
field is populated at request time from published, enrollment-open programs, and its answer
lands on `submissions.program_id`. This is what makes `/onboarding` a URL that
keeps working, rather than one form per cohort.

**e. One route on the existing site: `/onboarding` in `apps/web`. No subdomain, no fourth
app.** A separate Next.js app would have duplicated the design tokens, API client, captcha
widget, CI and a Vercel project slot to host a single page.

A `onboarding.stimuliiq.com` subdomain was built first — a Host-header rewrite in
`apps/web/src/middleware.ts` — and then **removed on the product owner's call** once it was
clear what it cost: a DNS record plus a Vercel domain attachment before it worked at all,
and edge middleware evaluated on every request to the whole site in order to serve one
page. A path has none of that and ships with any normal deploy. The page itself never
depended on the subdomain, so reinstating it later is ~20 lines of middleware plus the
Vercel domain, with no change to the form.

`SiteShell` drops the marketing chrome for this path — the same treatment `/pay/:token`
already gets — because a student told to fill in a form should not be offered a mega-menu,
a newsletter band and a "book a slot" popup mid-answer. The page is `noindex`: it is a
private post-payment link, not a public intake form.

**f. File answers reuse the anonymous signed-upload posture built for career resumes.**
`POST /public/onboarding/upload-url` mints a short-lived signed PUT into
`onboarding/{tenantId}/{uuid}-{filename}`, gated by captcha + per-IP rate limit, and only
for a `fieldKey` that resolves to a real active `file` question — without that check it
would be an anonymous "mint me a signed write URL" primitive rather than "upload the receipt
this form asked for". At submit time the service re-checks the `onboarding/{tenantId}/`
prefix, closing the same cross-tenant hole Wave-6 M3 closed for resumes. The namespace is
deliberately absent from `PUBLIC_ASSET_PREFIXES`: a payment receipt carries an amount and a
bank/UPI reference, so it is delivered only through signed URLs minted per CRM request.

**g. Two permission families, not one.** `onboarding.view`/`.edit`/`.delete` cover the
intake queue (granted to counsellor and support at `scope=all`, plus admins);
`onboarding.fields.manage` covers authoring the live form (admin/super_admin). Someone
working the queue must not be able to quietly delete the payment-receipt question.
Submissions arrive from an anonymous public form and have no branch, so the service fails
closed on any narrowed data-scope rather than silently widening it.

## Consequences

- Adding a question is a CRM action. No deploy, no migration, no code review.
- A submission is immutable evidence: staff set `status` and `reviewNotes` and nothing else.
  Answers are never editable, because an editable record is not evidence.
- Deleting a question stops it being asked without erasing history — the answers live in
  the snapshots. The CRM's delete dialog says so explicitly, because that is the question
  staff will actually have.
- A question set that is data cannot be typechecked. The mitigation is that both sides run
  one shared validator, and that `buildOnboardingAnswerIssues` has its own spec
  (`packages/types/src/onboarding/onboarding.spec.ts`) — if it drifts, the browser and the
  server start disagreeing about what a valid submission is.
- The `identity_role` uniqueness ("one field per CRM column") is enforced in the service,
  not by a unique index: reassigning a role is a routine one-step edit that a DB constraint
  would make impossible without clearing the old holder first. Assigning therefore CLEARS
  it elsewhere rather than erroring.
- `validatePageBodyAgainstTemplate`-style server-side shape enforcement (ADR-0063) has no
  analogue here, by design — see (a).

## References
- `docs/specs/onboarding-form.md` — the feature spec (fields, endpoints, ACs, edge cases).
- ADR-0019 — separate controller class, no guards, for anonymous public endpoints.
- ADR-0063 — locked page templates (the deliberate contrast in (a)).
