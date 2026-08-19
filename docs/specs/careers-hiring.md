# Careers & Hiring — spec

> Decision record: [ADR-0066](../adr/0066-careers-crm-openings-four-verb-review.md).
> Surfaces: `web` (`/careers`), `crm` (Careers ▸ Openings, Careers ▸ Applications), `api`
> (`modules/careers`).

## 1. The loop this closes

```
CRM ▸ Careers ▸ Openings          stimuliiq.com/careers
  author an advert  ──publish──►  role appears live
                                       │
                                   candidate clicks Apply
                                       │  uploads resume (signed PUT, captcha-gated)
                                       ▼
                                  POST /public/careers/apply
                                       │
                                       ├──► "thanks for applying" email  (automatic)
                                       ▼
                          CRM ▸ Careers ▸ Applications
                                       │
              ┌──────────┬─────────────┼─────────────┬──────────────┐
              ▼          ▼             ▼             ▼
            Hold     Next round      Offer        Reject
          (no mail)  ✉ round +     ✉ + offer     ✉ polite
                       details      letter PDF     decline
                                    ATTACHED
```

Before this work, everything below the dotted line did not exist: applications landed in a
table with no screen, and no email was ever sent.

## 2. Data model

### `JobOpening`

| Field | Notes |
|---|---|
| `title`, `slug` | `slug` is the public handle (`/careers#<slug>`). Unique among LIVE rows via a **partial unique index in the migration SQL** (`WHERE deleted_at IS NULL`), not in `schema.prisma`. |
| `department`, `employmentType`, `location`, `workMode`, `experienceLevel` | `employmentType` is free text — "Full-time", "Internship", "Contract — 6 months" are all legitimate and a fixed list would be wrong within a month. |
| `summary` | The line shown before a candidate expands the role. Required. |
| `description` | Long form, plain text, blank line = paragraph. |
| `responsibilities`, `requirements` | `Json` string arrays. JSON rather than a child table: display copy with no identity, never queried, always read whole with the parent. |
| `compensationNote`, `openingsCount` | Both public. |
| `status` | `draft \| published \| closed`, app-boundary constrained (no DB enum), matching `CareerApplication.status`'s existing convention. |
| `closesOn` | **Inclusive `DATE`.** See §4. |
| `publishedAt` | Stamped on first publish, never re-stamped. |

### `CareerApplication` (extended)

| Field | Notes |
|---|---|
| `jobOpeningId` | **Nullable.** |
| `role` | **Snapshot** of the title at apply time. Both exist deliberately — see §5. |
| `internalNotes` | Reviewer-only. Never rendered publicly, never in any email. |
| `nextRoundName`, `nextRoundDetails` | What the candidate was actually told, kept so a reviewer reads the message rather than guessing. |
| `offerLetterStorageKey`, `offerLetterFileName` | `offer-letters/` namespace — separate from `careers/`, see §7. |
| `acknowledgedAt` | Null = the acknowledgement never went out. Surfaced in the CRM; makes resend idempotent by inspection. |
| `decidedAt`, `decidedByUserId` | Who decided, and when. |

`status`: `new \| on_hold \| shortlisted \| selected \| rejected`.

## 3. Acceptance criteria

**Openings**

- AC-1 A `draft` opening is invisible to every public read.
- AC-2 Publishing puts the role on `/careers` with no page edit and no deploy.
- AC-3 The CRM list shows, per opening, total applicants and how many are still undecided;
  clicking through pre-filters the applications queue to that opening.
- AC-4 A slug collision is a 422 naming the clashing opening — never a silent `-2` suffix,
  because the slug is a URL somebody may already have shared.
- AC-5 An unrelated PATCH (e.g. `order`) does not re-derive the slug of a live advert.
- AC-6 Closing keeps the opening's applications attached to a named role; deleting is
  soft, and the confirm copy steers the user to close instead.

**Applying**

- AC-7 Resume upload is a signed PUT direct to R2 — the file never passes through the API.
  PDF/DOC/DOCX only.
- AC-8 Both public writes are captcha-gated and per-IP rate-limited.
- AC-9 A `resumeStorageKey` outside `careers/{tenantId}/` is a 422 (Wave 6 M3).
- AC-10 Submitting **always** triggers the acknowledgement email; the success panel says so.
- AC-11 A failed acknowledgement does **not** fail the application. `acknowledgedAt` stays
  null, the CRM flags it, and a reviewer can send it by hand.
- AC-12 Applying to a role that closed since the page loaded still records the application
  (unlinked, against its role snapshot). See §5.

**Review**

- AC-13 Four verbs, four endpoints. There is no status PATCH.
- AC-14 `hold` sends no email.
- AC-15 `shortlist` requires a round name **and** details, both of which go into the email.
- AC-16 `offer` requires an uploaded letter, and emails it **attached**.
- AC-17 `offer` fails atomically if the letter cannot be read: nothing sent, status
  unchanged.
- AC-18 `reject` emails a decline that does **not** contain `internalNotes`.
- AC-19 A decided (`selected`/`rejected`) application cannot be re-decided; a second
  reviewer gets a 422 rather than the candidate getting a second email.
- AC-20 Every decision is recorded even if its email fails.
- AC-21 Resume and offer letter are only ever handed out as short-lived signed URLs.

## 4. `closesOn` — inclusive, and self-enforcing

"Applications close on the 30th" means the whole of the 30th. Comparisons are
**date-string to date-string** (`isJobOpeningLive` in `@repo/types`, run identically by the
API and the CRM badge) so the answer never shifts with the server's timezone.

A lapsed opening is filtered out of every public read **without its status changing**. Staff
see it as "Lapsed" — published, but not visible. Requiring a human to close it on the right
day is precisely the chore that does not get done on the right day.

## 5. Why an application has both `jobOpeningId` and `role`

The FK powers the queue, the filters and the counts. The **snapshot** means renaming or
deleting an opening can never rewrite what somebody actually applied for — the same
self-describing-record discipline as onboarding answers (P12).

It also makes AC-12 safe: when the opening does not resolve, the row still records a role.
Losing an applicant to a race between page-load and submit is worse than an unlinked row a
reviewer can read perfectly well.

When the opening **does** resolve, the server's title wins over the client's — a tampered
`role` would otherwise put attacker-chosen text into our outgoing mail.

## 6. The four emails

| Verb | Subject carries | Contains | Never contains |
|---|---|---|---|
| *(automatic)* | the role | we have it; a human reads it; you'll hear either way | any promised date or outcome |
| `shortlist` | the role | the round name + the reviewer's details, verbatim | — |
| `offer` | the role | the offer letter **attached** + optional covering note | — |
| `reject` | the role | a short decline + a pointer to future openings | **the reason** |

A candidate is not a platform user (no account, no preference matrix, no in-app inbox), so
these bypass `NotificationsService` and talk to `MAIL_PROVIDER` directly — the same shape as
`OnboardingNotificationService`.

All reviewer-authored text is HTML-escaped before it enters an email body. Staff input is
still input.

## 7. Storage namespaces

| Namespace | Written by | Why separate |
|---|---|---|
| `careers/{tenantId}/` | anonymous applicants, public endpoint | |
| `offer-letters/{tenantId}/` | authenticated staff | Neither path's prefix guard can be satisfied by the other's key. |

Both are private: signed URLs only, never CDN.

`StorageProvider.getObject` is the **only** server-side byte read in this codebase and
requires an explicit `maxBytes`. It exists solely so the offer letter can be attached.

## 8. Permissions

| Key | Held by | Gates |
|---|---|---|
| `careers.view` | admin, super_admin, branch_manager | reading the queue and the openings list |
| `careers.review` | admin, super_admin, branch_manager | every verb + delete + resend |
| `careers.openings.manage` | admin, super_admin | creating/editing/publishing/closing adverts |

Deliberately **not** `content.*`. `content_editor` and `marketing` hold none of these, and
`careers.permission-catalog.spec.ts` asserts it — both that no `content.*` key appears in
the module, and that site-editor roles hold nothing here.

`branch_manager` reviews but cannot author adverts: they interview their own centre's hires,
but what the public site advertises (and at what compensation) stays with admin.

Scope is `all` throughout — an anonymous application has no branch to be partitioned by, and
the service fails closed on any narrower scope.

## 9. Deploying to an existing database

```bash
prisma migrate deploy      # 20260819140000_careers_openings_and_review
pnpm db:seed:careers       # permissions + grants ONLY
```

Additive: one new table, nine new columns, two FKs, a partial unique index, and a rewrite of
two retired status values that nothing had ever written.

**Do NOT run the full `pnpm db:seed`** against a live database — it upserts demo students,
programs and campaigns.

**No sample openings are seeded**, on purpose, for the same reason `seed-leave.ts` seeds no
holidays: a seeded opening is not placeholder data, it is a live advert on a live website
inviting real people to apply for a job that does not exist.

## 10. Known limitations / follow-ups

- No pagination controls on either CRM screen yet (`pageSize: 100`, newest first). Fine at
  current volume; revisit past a few hundred applications.
- No candidate-facing status page. Deliberate for now — the emails are the status.
- No bulk reject. Also deliberate: bulk-emailing rejections is exactly the action that should
  cost a click each.
- An opening's `closesOn` does not notify anyone when it lapses; the CRM shows "Lapsed".
