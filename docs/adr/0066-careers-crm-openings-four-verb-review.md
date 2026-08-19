# ADR-0066 — Careers: CRM-managed openings, and application review as four verbs

- **Status:** Accepted
- **Date:** 2026-08-20
- **Supersedes:** the `job_openings` page-builder block's authoring model (ADR-0062 / ADR-0063 block #9)
- **Spec:** `docs/specs/careers-hiring.md`

## Context

The careers surface existed but did not close a loop.

Openings were **free text typed into the careers page** as `job_openings.items` in the
page builder. An application therefore stored only a role STRING. Nothing could answer "how
many people applied for the counsellor role"; renaming a role orphaned its applications;
and an advert stayed up until somebody remembered to delete the text.

Applications were worse. `POST /public/careers/apply` wrote a `CareerApplication` row, and
**no CRM screen existed to read it** — the endpoints were built, the SDK method was built,
and no page ever called them. Every row sat at `status: 'new'` forever because nothing ever
wrote another value. **Not one email was sent** at any point. A candidate uploaded a resume
into silence and never heard from us again.

## Decision

### 1. Openings become a CRM-managed table, not page content

A new `JobOpening` model with its own CRM screen (**Careers ▸ Openings**), following the
P11 colleges precedent: a dedicated list surfaced live on the site, rather than fields on a
page. `CareerApplication` gains a nullable `jobOpeningId`.

The `job_openings` block becomes the **second reference block** in the page builder, beside
`live_collection_ref`: it keeps the section heading and the empty-state line (which are
genuinely page content) and resolves its roles server-side at read time. The block's role
editor is deleted from the CRM builder form, so no control remains that appears to publish a
job and does not — the trap that got `stats.headline` removed in P10-2.

It is a separate block type rather than a fifth `live_collection_ref` collection because
that block's four collections are interchangeable showcase grids sharing one
`layout`/`selection` shape, whereas open roles have their own card, their own apply
affordance, and no layout choice to make.

### 2. `closesOn` hides a lapsed opening without changing its status

A published opening past its (inclusive) closing date is filtered out of every public read
while remaining `published` in the database, shown to staff as **Lapsed**. Requiring somebody
to close it by hand on the right day is exactly the chore nobody does on the right day.

### 3. Review is four verbs, each its own endpoint

`hold` · `shortlist` · `offer` · `reject`, replacing `PATCH {status}`. This follows P4
(grade / send-back) and P12 (accept / reject) for a stronger version of their reason: **three
of the four email a person outside the company**, and one attaches a signed offer letter. A
dropdown that fires an irreversible message on a mis-click is the wrong control, and it has
nowhere to put what shortlist and offer each need (a round name; a PDF).

**Hold sends no email.** "We are still thinking about you" is not information a candidate can
act on, reads as a soft no, and trains people to ignore mail from us.

`internalNotes` is stored on every verb and **sent by none of them**. A rejection reason is a
conversation a person has, not a line in an automated mail nobody can reply to — the same
rule as `OnboardingSubmission.reviewNotes` (P12).

An offer or a rejection is **terminal**. The acceptable statuses are re-checked inside the
UPDATE's WHERE, so two reviewers cannot both decide one application and the second is told
rather than silently re-mailing the candidate.

### 4. The offer letter is ATTACHED, not linked

This required extending two provider seams:

- `MailProvider.send` gains `attachments`.
- `StorageProvider` gains `getObject(key, maxBytes)` — the one place in this codebase where
  the server reads object bytes into its own memory, with a mandatory size ceiling checked by
  HEAD before the GET and again during the transfer.

A signed link would have been cheaper and is the default everywhere else here. An offer
letter is a document somebody keeps and signs, and a link that expires makes the message
worthless.

`offer` is the one verb that **reads storage before writing status**: a missing or unreadable
file fails the whole action while it is still undone. Recording "selected" and then finding
nothing to attach would leave a candidate marked as offered who has been sent nothing.

### 5. Careers gets its own permission domain

`careers.view` · `careers.review` · `careers.openings.manage` — **not** `content.*`, even
though a job advert is marketing content and the colleges screen next door reuses
`content.*`. An application carries a stranger's name, phone number, resume and cover letter,
none of it solicited. Whoever may rewrite the homepage should not thereby be able to read
CVs. Reading the queue and emailing a candidate are likewise separated.

Granted to `admin` + `super_admin`, plus `branch_manager` for view/review (they interview
their own centre's hires) but not `openings.manage`. `content_editor` and `marketing` get
none of it, and a test asserts that.

### 6. Careers moves out of `ContentModule` into its own module

It was in `content-intake` alongside newsletter signups and contact messages, because all
three were once the same thing: an anonymous form posting into a table with no screen.
Careers is no longer that — it owns two lifecycles, sends four emails, reads and writes two
storage namespaces, and holds unsolicited PII about people who do not work here. Its
permission boundary is genuinely different from "who may edit the site", and a separate
module makes that a structural fact rather than a convention. **Public URLs did not change.**

## Consequences

- `CareerApplicationStatus` changes from `new|reviewing|shortlisted|rejected|hired` to
  `new|on_hold|shortlisted|selected|rejected`. Migration folds `reviewing → new` and
  `hired → selected`; in practice nothing had ever written either, since no screen existed.
- Stored page bodies keep a legacy, never-rendered `job_openings.items` field so pages and
  `ContentPageVersion` snapshots written before this change still parse (the block union is
  `.strict()`, and a parse failure would silently drop the Open Roles section). No editor can
  write it.
- `CareersPageFallback` no longer lists roles. It carried three hardcoded openings preserved
  from the pre-P10 page; once openings became real, those became **fabricated job adverts**
  shown whenever the API was unreachable. A fallback may degrade; it may not lie.
- Deploying to an existing database needs `prisma migrate deploy` then
  `pnpm db:seed:careers` (permissions only — **no sample openings are seeded**, because a
  seeded opening is a real advert on a real website for a job that does not exist).

## Alternatives considered

- **Keep openings in the page builder.** Rejected: an application cannot reference a text
  fragment, so per-opening queues, counts and auto-closing are all unreachable.
- **One status dropdown that fires the matching email.** Rejected: see §3.
- **Signed 7-day link instead of an attachment.** Considered and explicitly rejected by the
  product owner; see §4.
- **Reuse `content.*` permissions** (the colleges precedent). Rejected: see §5.
