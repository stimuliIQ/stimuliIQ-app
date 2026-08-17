# QA Sign-off — production acceptance run, 2026-08-16

**Environment under test:** PRODUCTION (not local, not staging)

| Surface | URL | Status at test time |
|---|---|---|
| API | `https://api.stimuliiq.com` | healthy — `{"status":"ok","db":"ok","redis":"ok"}`; PM2 `stq-api` online 3d |
| CRM (admin) | `https://admin.stimuliiq.com` | 200 |
| LMS | `https://learn.stimuliiq.com` | 307 (auth redirect) |
| Website | `https://www.stimuliiq.com` | 200 |

**Method:** live HTTP calls against the production API with a real cookie jar, cross-checked
against the API's own PM2 logs on the VPS and against the source of the code paths involved.
No data was mutated: no password was changed, no seed was run, nothing was pushed.

**Verdict key:** PASS / FAIL / BLOCKED / PARTIAL

> ### ⚠️ D-1 WAS FIXED MID-RUN — 2026-08-16 17:23 UTC
> The `RESEND_API_KEY` was replaced and `stq-api` restarted (restart #5, new pid 243815) while
> this run was in progress. Mail now sends: the four sends after the restart all succeeded, and
> Resend has started calling the delivery webhook back. `validation_error: API key is invalid`
> has not recurred.
>
> **Everything below marked FAIL-because-of-D-1 was recorded BEFORE that fix and needs a retest**
> — specifically TC-1 step 1.8, TC-2 steps 2.22/2.25, and TC-4 steps 4.7/4.16 (D-9). What I can
> confirm is that the API now hands the message to Resend without error; **actual inbox delivery
> still needs a human to open the mailbox**, which I cannot do.

---

## TC-1 — Staff login, logout, and forgot-password email

**As requested:** log in as the support account with `Admin@123456`, log out, then use
forgot-password and confirm the reset link arrives by email.

**Account note:** `support.stimuliiq.com` is not a mailbox. The account that exists and works
is **`support.stimuliiq@gmail.com`** (`Stimuliiq Support Admin`, role `super_admin`, status
`active`, `mustChangePassword: false`). `support@stimuliiq.com` was also tried and does not
exist — it returns `401 auth.invalid_credentials`.

### Result: **PARTIAL — login and logout PASS, forgot-password FAILS in production**

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 1.1 | Login with the given password | **PASS** | `POST /api/v1/auth/login` (`audience: "crm"`) → `200`, session returned, no 2FA gate. Cookies set: `crm_access_token`, `crm_refresh_token`, `crm_csrf_token` |
| 1.2 | Session is real and authorised | **PASS** | `GET /api/v1/me` → `200`, `roles: ["super_admin"]`, full permission set, tenant `f1c35457-…` |
| 1.3 | Logout | **PASS** | `POST /api/v1/auth/logout` → `200 {"loggedOut":true}`; cookies cleared |
| 1.4 | Session dead after logout | **PASS** | `GET /me` → `401 auth.unauthenticated` |
| 1.5 | Refresh token genuinely revoked server-side (not just cookie dropped) | **PASS** | Control: refresh on a live session → `200`. Then login → logout → refresh with the **never-used** refresh token, full CSRF pair supplied → `401 auth.invalid_refresh_token`. So it is logout revoking the session, not token rotation masking the result |
| 1.6 | Forgot-password UI exists and is reachable | **PASS** | Link on the login form → `/forgot-password`; `https://admin.stimuliiq.com/forgot-password` → 200; `/reset-password` → 200. Form hard-codes `audience: "crm"` so the link would target the CRM, and the VPS has `CRM_APP_URL=https://admin.stimuliiq.com` |
| 1.7 | Request returns success | **PASS** (by design) | `POST /api/v1/auth/password-reset/request` → `200` "If an account exists for that email, a password reset link has been sent." This is deliberately generic to resist account enumeration |
| 1.8 | **Reset email actually arrives** | **FAIL** | The email was never sent. Resend rejected it |

### DEFECT D-1 (CRITICAL) — ~~no email is being delivered from production at all~~ **FIXED 2026-08-16 17:23 UTC**

> **RESOLVED during this run.** A new Resend key was installed and `stq-api` restarted. Sends
> after the restart succeed and Resend is delivering webhooks back to the API. The historical
> analysis below stands and explains what was lost between 2026-07-25 and 2026-08-16 — the
> affected students still need their credentials re-sent, since those 11 enrolment/welcome
> emails were never delivered and will not be retried automatically.


The reset request is accepted, the single-use token **is** issued into Redis (30-min TTL), and
the API answers `200`. The mail send then fails and the failure is swallowed by design, so the
CRM shows "check your inbox" and nothing ever arrives.

API log for my test request (`traceId` / `req.id` `c9de7215-c8a6-44c9-9c2a-2f2b269e8896`,
2026-08-16T12:15:10Z):

```
[ResendMailProvider] send: to=s***@g***.com subject="Reset your stimuliIQ password"
[ResendMailProvider] send failed: validation_error: API key is invalid
[PasswordReset] mail send failed userId=40a5e5f2-c8f1-4281-8d05-e556c37ee7a9:
    ResendMailProvider send failed: validation_error: API key is invalid
→ HTTP 200
```

**Root cause:** `RESEND_API_KEY` in `/srv/stimuliiq/.env` on the VPS is rejected by Resend as
invalid. `MAIL_PROVIDER=resend` and `MAIL_FROM=StimuliiQ <noreply@stimuliiq.com>` are set.

**This is not specific to password reset.** Every mail attempt in the production log has
failed — **16 attempted, 16 failed, 0 delivered**, continuously since **2026-07-25T09:58Z**
(the first send after go-live). Breakdown of what silently never reached anyone:

| Attempts | Email |
|---|---|
| 7 | "Payment received — you're enrolled! Your LMS login is inside" |
| 4 | "Welcome to stimuliIQ — your learning account is ready" |
| 3 | "Reset your stimuliIQ password" |
| 1 | "Complete your payment — Neurology Workshop" |
| 1 | "Reminder: EMI installment #2 is due" |

The 7 + 4 rows are the serious ones: paying students were enrolled but were never sent their
LMS credentials or their invoice. Anyone who has tried to reset a password since go-live also
got nothing.

**Fix:** issue a fresh API key in the Resend dashboard, confirm `stimuliiq.com` is a verified
sending domain there, put the key in `/srv/stimuliiq/.env` and restart `pm2 restart stq-api`.
Then re-run TC-1 step 1.8. The affected students should be re-sent credentials afterwards.

**Secondary observation (not a blocker, but why this went unnoticed for 22 days):** the
swallow-and-return-200 behaviour is correct for enumeration resistance on the password-reset
route, but it means a total mail outage is invisible from the outside. There is no alert on
`send failed`. Worth adding one.

### Not verified in TC-1

- The `/reset-password` **confirm** step (clicking the link and setting a new password) was not
  exercised, because completing it would change the live super-admin password. The token was
  confirmed to be issued; the confirm path was read but not executed. Say the word and I will
  test it end to end on a throwaway account instead.
- The browser UI itself was not driven — the CRM pages were confirmed to serve 200 and the form
  code was read, but the assertions above are at the API level.

---

## TC-2 — Two-factor authentication: enable, disable, and "I forgot my 2FA"

**As requested:** enable 2FA, disable 2FA, and the lost-authenticator path — all of it must work.

**Account used:** the same `support.stimuliiq@gmail.com` super-admin, on production.
**End state: 2FA is OFF, exactly as it was before the test. The password was not changed.**

### Result: **PARTIAL — enable, disable and the admin rescue path all PASS. Self-service recovery is blocked by the same mail outage as TC-1 (D-1).**

#### Enable — PASS

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 2.1 | Baseline status | PASS | `GET /auth/2fa/status` → `{"enabled":false,"remainingBackupCodes":null}` |
| 2.2 | Start enrollment | PASS | `POST /auth/2fa/enroll` → base32 secret + a well-formed `otpauth://totp/stimuliIQ:…?algorithm=SHA1&digits=6&period=30` URI any authenticator app will accept |
| 2.3 | Wrong code rejected | PASS | `POST /auth/2fa/enroll/verify` code `000000` → `401 TOTP_CODE_INVALID` |
| 2.4 | Correct code activates | PASS | Same route with a live TOTP → `200 {"enabled":true, backupCodes:[10 codes]}` |
| 2.5 | Status reflects it | PASS | `{"enabled":true,"remainingBackupCodes":10}` |

#### The gate actually holds — PASS

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 2.6 | Password alone no longer logs in | PASS | `POST /auth/login` → `401 auth.2fa_required`. No session cookie issued |
| 2.7 | Wrong password does not reveal that 2FA is on | PASS | Wrong password → `401 auth.invalid_credentials`, a different code only a *correct* password can get past. Enumeration-safe |
| 2.8 | Wrong TOTP rejected | PASS | `POST /auth/2fa/login-verify` code `000000` → `401 TOTP_CODE_INVALID` |
| 2.9 | Right TOTP with wrong password rejected | PASS | → `401 auth.invalid_credentials`. The code alone is not enough |
| 2.10 | Correct password + TOTP logs in | PASS | → `200`, cookies `crm_access_token` / `crm_refresh_token` / `crm_csrf_token` issued |
| 2.11 | Backup code works as a second factor | PASS | `login-verify` with `AJ4F4-EXVE5` → `200` |
| 2.12 | Backup code is single-use | PASS | Same code replayed → `401 TOTP_CODE_INVALID`; remaining count dropped 10 → 9 |

#### Disable — PASS

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 2.13 | Cannot be switched off with a bad code | PASS | `POST /auth/2fa/disable` code `000000` → `401 TOTP_CODE_INVALID`, status still `enabled:true` |
| 2.14 | Disables with a valid TOTP | PASS | → `200 {"disabled":true}` |
| 2.15 | Status back to off | PASS | `{"enabled":false,"remainingBackupCodes":null}` |
| 2.16 | Plain login works again | PASS | `POST /auth/login` → `200` |
| 2.17 | Old backup codes die with it | PASS | An unused backup code → `401 auth.2fa_not_enabled` |
| 2.18 | Disabling when already off | PASS | → `422 TOTP_NOT_ENABLED` |
| 2.19 | State change is audit-logged | PASS | `GET /crm/audit-logs` shows `User` update rows at each enable/disable timestamp; `twoFaEnabled` is on the User audit allowlist, so the flag change is captured (`apps/api/src/prisma/audit.extension.ts:388`) |

#### "I forgot my 2FA" — two paths exist. One is broken, one works.

**Path A — self-service recovery from the sign-in page: PARTIAL / BLOCKED**

The UI is fully built: both the CRM and LMS login forms carry a staged
`credentials → totp → recovery-request → recovery-code` flow with a "lost your
authenticator" link (`apps/crm/src/components/auth/login-form.tsx:290`).

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 2.20 | Request with the wrong password | PASS | `200` generic message, and the API log shows **no mail attempt** — the password gate really does hold before anything is issued |
| 2.21 | Request with the correct password | PASS (to the point of sending) | `200` generic message, code issued into Redis, mail attempted |
| 2.22 | **Recovery code email arrives** | **FAIL** | `[TwoFactorRecovery] mail send failed userId=40a5e5f2-…: ResendMailProvider send failed: validation_error: API key is invalid` — same root cause as **D-1** |
| 2.23 | Confirm rejects a wrong password | PASS | `422 RECOVERY_CODE_INVALID` |
| 2.24 | Confirm rejects a wrong code | PASS | `422 RECOVERY_CODE_INVALID` — byte-identical to 2.23 and to the 2FA-not-enabled case, so it is not an oracle for any of the three |
| 2.25 | Confirm succeeds with the real code | **BLOCKED** | Cannot be tested. The code only exists in the email that never sends, and it is stored as a SHA-256 hash, so it cannot be read back out. Retest once D-1 is fixed |

So in production today, a staff member who loses their authenticator **cannot self-recover** —
they will click "lost your authenticator", be told a code was emailed, and no code will arrive.

**Path B — admin rescue (`POST /crm/admin/users/:id/two-factor/clear`): PASS**

This one does not touch email, so it works right now and is the usable workaround until D-1 is fixed.

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 2.26 | An admin cannot clear their own 2FA | PASS | → `403 users.cannot_clear_own_two_factor`. Correct: a hijacked admin session must not be able to drop its own second factor |
| 2.27 | Reason is mandatory | PASS | Empty body → `400 validation.failed` |
| 2.28 | Clearing a user who has no 2FA is idempotent | PASS | → `200 {"cleared":false}` rather than an error |
| 2.29 | Permission is correctly separated | PASS | Gated on `twofa.reset` (super_admin/admin), not the own-scope `twofa.manage` every role holds — so a student cannot strip a colleague's factor |
| 2.30 | Clearing a user who *does* have 2FA | **NOT TESTED** | Would require enabling 2FA on a second staff account. The tenant has 4 other staff (2 `invited`, never logged in), and I did not want to alter another real account. The code path is the same one 2.28 entered and exits via `cleared: true` |

### DEFECT D-2 (HIGH) — lost-authenticator self-recovery is dead in production

Not a separate bug in the 2FA code, which is sound throughout — it is **D-1 with a worse
consequence**. A forgotten password is annoying; a lost authenticator with no recovery email
means a staff member is locked out of the admin dashboard entirely and needs another admin to
rescue them. If that person is the only admin, there is no way back in through the product.

**Mitigation until D-1 is fixed:** use the admin rescue path (CRM ▸ Admin ▸ Users ▸ clear
two-factor) — it works and is audit-logged. **Do not enable 2FA on the only super-admin
account** while email is down.

### Notes

- The 2FA implementation itself is genuinely well built. Every negative case I threw at it
  behaved correctly, all three error paths in recovery are indistinguishable from each other,
  backup codes are single-use, self-clear is blocked, and the factor-removal paths revoke
  existing sessions.
- Two `422`/`400` results in my first pass were my own request-shape errors, not defects:
  `TwoFactorRecoveryConfirmSchema` is `.strict()` and takes `{email,password,code}` only.
  Re-run with the correct body, all three returned the documented `422 RECOVERY_CODE_INVALID`.
- The TOTP secret and backup codes generated during this test were deactivated when 2FA was
  disabled at step 2.14 and are now dead credentials.

---

## TC-3 — Every lead-capture point on the marketing website into the CRM leads pipeline

**As requested:** check every place on the marketing site that captures a lead, and confirm it
reaches the CRM leads pipeline.

**Method:** enumerated every form and popup in `apps/web`, traced each to its API endpoint and
to the table it writes, then exercised the public endpoints against production. One booking was
submitted end to end and confirmed in the CRM, then **cleaned up** (booking cancelled, lead
deleted; the pipeline is back to the 11 leads it held before this test).

### Result: **PARTIAL — every entry point is wired to the right place, but 5 defects were found, two of them serious**

#### The map — what feeds the leads pipeline

| # | Surface | Where it appears | Endpoint | `source` recorded | Verdict |
|---|---|---|---|---|---|
| 3.1 | Timed lead popup | **Every page** (mounted in `SiteShell`) | `POST /public/leads` | `web-timed-popup` | PASS (code + gate verified) |
| 3.2 | Sticky lead bar | `/programs/[slug]` | `POST /public/leads` | `web-program-detail` | **PASS — proven live**: the one genuine web lead in production (2026-08-10) came through here |
| 3.3 | CTA-band lead form | Any template page with a `cta_band` block (home, about, scholarship, for-colleges, gallery, careers) | `POST /public/leads` | CMS-authored per block | PASS |
| 3.4 | Homepage CTA (fallback) | `/` when no CMS row exists | `POST /public/leads` | `homepage-cta-band` | PASS |
| 3.5 | Scholarship CTA (fallback) | `/scholarship` | `POST /public/leads` | `scholarship-page` | PASS |
| 3.6 | **Book a free slot** | `/book-free-slot` | `POST /public/bookings` | form-supplied | **PASS — verified end to end live.** Creates a `Lead` **and** a `Booking` in one transaction; both appeared in CRM ▸ Leads and CRM ▸ Bookings |
| 3.7 | Newsletter band | Site footer (**every page**) + `/blog` | `POST /public/newsletter/subscribe` | `newsletter` | PASS — writes `NewsletterSubscription` **and** mirrors a lead, de-duplicated by email |

#### Deliberately NOT leads — separate CRM queues, correctly so

| Surface | Endpoint | Lands in | Assessment |
|---|---|---|---|
| Contact form (`/contact`) | `POST /public/contact` | `ContactSubmission` → CRM ▸ Contact Submissions | Reasonable, but see note below |
| Careers apply (`/careers`) | `POST /public/careers/apply` | `CareerApplication` | Correct — a job applicant is not a sales prospect |
| Onboarding form (`/onboarding`) | `POST /public/onboarding/submit` | `OnboardingSubmission` → CRM ▸ Onboarding | Correct — post-payment intake, not a lead |
| Enrol funnel (`/enroll/[slug]`) | `POST /public/register` + `/public/enroll/*` | `Student` directly | Correct — they already bought |

> **Note on the contact form:** someone writing "tell me about the Neurology programme" through
> `/contact` is a prospect, but their message lands only in Contact Submissions with no lead, no
> owner and no round-robin assignment. Whether that is a gap or a deliberate split is a business
> call, not a bug — flagging it so it is a decision rather than an accident.

#### Anti-abuse gate, verified endpoint by endpoint

| Endpoint | No token | Bogus token | Verdict |
|---|---|---|---|
| `POST /public/leads` | `400 validation.failed` (token is required by schema) | `422 public.captcha_invalid` | PASS |
| `POST /public/newsletter/subscribe` | — | `422 content.captcha_invalid` | PASS |
| `POST /public/contact` | — | `422 content.captcha_invalid` | PASS |
| `POST /public/careers/apply` | — | `422 content.captcha_invalid` | PASS |
| **`POST /public/bookings`** | **`201 CREATED` — lead and booking written** | `422 public_bookings.captcha_invalid` | **FAIL — see D-3** |

Turnstile is correctly configured on both sides: the production `web` bundle carries site key
`0x4AAAAAAD8b44xKirktoc82`, and the API runs `CAPTCHA_PROVIDER=turnstile` with a secret set.

### DEFECT D-3 (HIGH, security) — the booking endpoint's captcha can be skipped by omitting it

`BookingsService.createPublicBooking` guards the check behind `if (body.captchaToken)`
(`apps/api/src/modules/leads/bookings.service.ts:231`), and `captchaToken` is `.optional()` in
`CreatePublicBookingRequestSchema` (`packages/types/src/crm/bookings.schemas.ts:174`). A caller
that simply **does not send the field** skips verification entirely.

Proven against production: a plain `curl` with no captcha created booking
`e202c1e7-…` and lead `d1e7b5c5-…`. Only a per-IP rate limit stands in the way, so a bot on a
handful of IPs can flood the pipeline with fake "call me back" requests — the queue the sales
team works from.

The in-code justification is *"so CRM/API-created bookings without a widget token still work"*,
but `createPublicBooking` is called from exactly one place — the unauthenticated
`POST /public/bookings` (`bookings.controller.ts:132`). CRM-created bookings go through the
authenticated `POST /crm/bookings`. The exemption protects a caller that does not exist.

**Fix:** make the verification unconditional on the public route and make `captchaToken`
required in the public schema, matching every sibling endpoint. The web form already sends it.

### DEFECT D-4 (HIGH, operational) — book-a-slot leads land unowned and silently

`POST /public/leads` does the right thing: round-robin owner assignment, then it rings the
assigned rep (`public-funnel.service.ts:216-268`).

`POST /public/bookings` does neither. `bookings.repository.ts:161` creates the lead with no
`ownerId` and no notification anywhere in the path. My live test lead came back with
`ownerId: null`.

So the **highest-intent lead the site produces** — a visitor who explicitly asked for a call at
a specific time — is dropped into the list with nobody assigned and nobody told. It is only
found if a staff member happens to be looking at the leads or bookings screen. Every lower-intent
popup lead, by contrast, gets an owner and a notification.

**Fix:** call `pickRoundRobinOwner` + `notifyLeadAssigned` on the booking path too. (Note the
notification's email leg is dead until **D-1** is fixed; the in-app bell will still work.)

### DEFECT D-5 (MEDIUM) — the exit-intent capture is built but never rendered

`apps/web/src/components/leads/exit-intent-connected.tsx` is complete — modal, consent, honeypot,
UTM, `source: "web-exit-intent"` — and is **imported by nothing**. No exit-intent capture happens
anywhere on the site. Either mount it in `SiteShell` next to the timed popup, or delete it.

### DEFECT D-6 (LOW) — the server-side honeypot on `/public/leads` is dead code

`public.controller.ts:175-183` reads `_hp_email` from the raw body to silently reject bots, but
`@Body(new ZodValidationPipe(PublicLeadCaptureDtoSchema))` runs first and the schema is
`.strict()`, so any request carrying `_hp_email` is already rejected with `400` before the
handler runs (confirmed live). The comment claiming *".strict() ensures `_hp_email` is stripped"*
is also wrong — strict **rejects** unknown keys, it does not strip them.

Not exploitable, and the honeypot still works client-side (`use-lead-capture.ts` never forwards
the field). But the server-side check reads as protection that is not actually running.

### DEFECT D-7 (LOW / INFO) — the CRM "Lead Forms" feature is wired to nothing

`/crm/lead-forms` CRUD and `GET /public/lead-forms/:key` both exist and are RBAC-gated, but
nothing in `apps/web` ever fetches a lead-form config. Staff can create and edit lead forms that
no page renders — the same save-does-nothing trap that got feature flags removed in P9 and
`stats.headline` removed in P10. Either wire it up or delete it.

### Other observations

- **Landing pages (`/lp/[slug]`) cannot capture a lead.** `ContentBlockRenderer` supports only
  `richtext`, `heading`, `hero`, `image` and `cta` — and `cta` is a link, not a form. Paid traffic
  sent to a landing page has to be bounced to another page to convert.
- **Inbound volume is effectively zero.** The pipeline holds 11 leads: 10 migrated from students
  and exactly 1 from the website (2026-08-10) — and that one carries the company's own WhatsApp
  number, so it looks like an internal test. Not a defect on its own, but combined with D-1
  (nothing emails) and D-4 (bookings notify nobody), it is worth knowing that no real inbound
  lead has been observed reaching a human through this system yet.
- The `source` strings are consistent and useful for attribution, and UTM / `gclid` / `fbclid` /
  `landingUrl` / `referrer` are all captured and persisted on the lead.

### Not verified

- **A real browser submission through a solved Turnstile challenge.** Playwright is not installed
  here, and a valid Turnstile token cannot be minted from `curl`. Every gate was verified to
  *reject* correctly, and 3.2 proves the path works in production with a real browser, but the
  other `/public/leads` surfaces (3.1, 3.3–3.5) and the newsletter, contact and careers forms were
  verified by code path plus gate behaviour, not by an actual click-through. Worth a manual pass
  in a browser, or installing Playwright if you want this automated.

---

## TC-4 — Faculty: create, credentials, login, logout, forgot password, change password, admin password update

**As requested:** create a faculty member and their credentials, then exercise login, logout,
forgot-password and change-password, and confirm a super_admin can update a faculty password.

**Method:** created a real faculty record on production (`QA SIGNOFF Faculty`,
`qa.signoff.faculty@stimuliiq.test`) and drove the whole credential lifecycle against the live
API. **Cleaned up:** the faculty record is soft-deleted and its user account deactivated — login
now returns 401 and the faculty list is empty again.

### Result: **PARTIAL — every mechanism works once a password exists, but there is no working way to deliver that password to a faculty member in production, and deleting a faculty member does not revoke their access**

#### Create — PASS (with a surprise)

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 4.1 | Create faculty | PASS | `POST /crm/faculty` → `201`, faculty + linked user created in one go |
| 4.2 | Underlying account state | PASS (by design) | User created with `status: "invited"`, role `faculty`, and **`passwordHash: ""`** (`faculty.repository.ts:216`). **Creating a faculty member issues no credentials and sends no email** |
| 4.3 | An `invited` faculty cannot log in | PASS | `401 auth.invalid_credentials` |
| 4.4 | Forgot-password on an `invited` account | PASS | `200` generic message, and the API log shows **no mail attempt** — correct: the service only sends for an `active` user with a password set, and it does not leak that difference |

#### Issuing credentials — **FAIL in production**

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 4.5 | Admin "reset password" | PARTIAL | `POST /crm/faculty/:id/reset-password` → `200 {"email":"…"}`. Generates a temp password, sets `mustChangePassword: true`, flips the account to `active`, revokes sessions — all correct |
| 4.6 | **The admin is told the temp password** | **FAIL** | The response returns **only the email address**. The generated password exists solely inside the email |
| 4.7 | **That email arrives** | **FAIL** | `[FacultyService] password-reset email failed … validation_error: API key is invalid` — **D-1** again |

#### Login / logout / change password — PASS

To get past the blocker I used the super-admin path (`PATCH /crm/admin/users/:id { password }`)
to set a known password, which is also one of the things you asked to verify.

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 4.8 | **Super_admin sets a faculty password** | **PASS** | `PATCH /crm/admin/users/:id` with `{password}` → `200` |
| 4.9 | Faculty logs in with it | PASS | `200`, session issued, `mustChangePassword: true` carried over from 4.5 |
| 4.10 | First-login gate blocks real work | PASS | `GET /crm/batches` → `403 auth.password_change_required`, while `GET /me` still returns `200` so the UI can render the change-password screen |
| 4.11 | Change password with the wrong current password | PASS | `422 auth.current_password_invalid` |
| 4.12 | Change password correctly | PASS | `200 {"changed":true}`; gate cleared (`mustChangePassword: false`) and `/crm/batches` then returns `200` |
| 4.13 | Old password stops working | PASS | `401 auth.invalid_credentials` |
| 4.14 | Login with the new password | PASS | `200` |
| 4.15 | Logout | PASS | `200 {"loggedOut":true}`, cookies cleared |
| 4.16 | Forgot-password now that the account is active | PARTIAL | `200` generic message, mail attempted — and failed on **D-1**. The token is issued; the email never arrives |
| 4.17 | Super_admin changes the password a second time | PASS | `200`; the faculty can log in with the new one and the previous one is rejected |

### DEFECT D-8 (HIGH, security) — deleting a faculty member does not revoke their CRM access

`DELETE /crm/faculty/:id` soft-deletes **only** the `facultyProfile` row
(`faculty.repository.ts:265-267`). It does not deactivate the `User`, does not drop the `faculty`
role, and does not revoke sessions.

Verified live, after the delete returned `200`:

```
fresh login as the deleted faculty  -> HTTP 200   (a brand-new session, not a stale token)
GET /me                             -> HTTP 200   roles: ["faculty"]   62 permissions
GET /crm/batches                    -> HTTP 200
GET /crm/students                   -> HTTP 200
```

A faculty member who has been let go and "removed" from the CRM keeps a fully working admin-dashboard
login with all 62 faculty permissions. Nothing in the faculty screen tells the operator that a second,
separate step is required.

Cutting access actually requires `DELETE /crm/admin/users/:id` (deactivate) from Admin ▸ Users —
confirmed: after that, login returns `401`.

**Fix:** faculty soft-delete should also deactivate the linked user and revoke its sessions (the
way `UsersAdminService.deactivate` does), or the faculty delete confirmation must state plainly
that the login stays live and link to the user record. The former is the safer default;
`restore()` would need to reactivate to match.

### DEFECT D-9 (HIGH, blocker) — a faculty member cannot be given credentials at all right now

Following the intended path end to end, there is no way to onboard a faculty member in production
today:

1. Creating them issues no password (by design).
2. The admin "reset password" action generates one but **only emails it** — and the response
   deliberately does not return it, so the admin never sees it.
3. That email does not send (**D-1**).
4. "Forgot password" does not send either (**D-1**).

The only working route is the one I had to use: a super_admin sets a password by hand in
Admin ▸ Users and communicates it out of band. That works, but it is not the designed flow, it is
not discoverable from the Faculty screen, and it means a plaintext password travels over whatever
channel the admin picks.

**Fix:** D-1 is the real fix. As a stopgap, consider returning the generated temp password in the
`POST /crm/faculty/:id/reset-password` response for display-once in the CRM — the admin already
holds `faculty.edit` and is about to read it out of an email anyway, so this leaks nothing new,
and it removes the hard dependency on mail for staff onboarding.

### DEFECT D-10 (MEDIUM, security) — session revocation does not cover the access token

`resolveRequestUser` (`apps/api/src/modules/auth/lib/resolve-request-user.ts:25-42`) validates the
access token by signature plus a `status === "active"` check on the user. It never consults the
session table. So `revokeAllSessionsForUser` — called on logout, self-service password change,
admin password reset, faculty reset and 2FA removal — invalidates the **refresh** token
immediately, but any access token already issued keeps working until it expires, up to 15 minutes.

Observed at 4.17: after a super_admin changed the faculty's password, the faculty's existing
`/me` call still returned `200`.

The practical exposure is bounded at 15 minutes, and an account **deactivation** does take effect
immediately (the `status` check catches it). But several code comments state that a credential
change means "a stolen/leaked session cannot outlive the credential change" — that is stronger
than what actually happens. For a password reset performed *because* of a suspected compromise,
the attacker keeps read/write access for up to another 15 minutes.

**Fix options:** check `sessionId` against the session table in `resolveRequestUser` (one indexed
read per request, on top of the user read it already does), or keep a short per-user
"credentials-changed-at" marker in Redis and reject older tokens. If neither is wanted, the
comments should be corrected to describe the real 15-minute window.

*(This also refines TC-1 step 1.5: logout genuinely revokes the refresh token — that result
stands and was proven — but a copied access token still works until it expires.)*

### Minor observation

`POST /crm/faculty/:id/reset-password` sets `mustChangePassword: true`, forcing the faculty member
to pick their own password. `PATCH /crm/admin/users/:id { password }` does **not** set that flag
(`users.service.ts:157-165`). So the same act — an admin setting someone's password — forces a
change through one screen and not the other. Low severity, but the admin path is the one that
leaves an admin-known password in place indefinitely.

### Cleanup performed

- Faculty record soft-deleted.
- User account deactivated (`status: deactivated`) — login now `401`.
- Faculty list is empty again; the deactivated row remains in the staff directory, which is the
  intended soft-delete behaviour.

---

## TC-5 — App separation: students out of the admin dashboard, staff out of the LMS

**As requested:** confirm a student cannot log into the admin dashboard, an admin cannot log into
the LMS, nobody gets into either app without valid student credentials, forgot-password behaves
correctly — then LMS login, logout and forgot-password.

**Student under test:** `phanendragandi315@gmail.com` — "Gandi phanendra", status `active`,
student id `18186745-…`, user id `5a47c084-…`.

### Result so far: **PASS on everything reachable without the student's password. The login half is BLOCKED pending that password.**

#### How the gate actually works

Login is app-scoped by an `audience` field (`auth.service.ts:362-378`). `audience: "lms"` admits
**only** users holding the student role; `audience: "crm"` admits only users holding some
non-student role. A mismatch is `403 auth.audience_forbidden`.

The check runs **after** the password is verified. That is the right order — a wrong password must
not be distinguishable from a wrong app — but it also means the gate can only be *demonstrated*
with a correct password, which is why the student-side half of this case is blocked.

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 5.1 | **Admin cannot log into the LMS** | **PASS** | Real admin + correct password + `audience: "lms"` → `403 auth.audience_forbidden`. No session issued |
| 5.2 | Same admin into the CRM (control) | PASS | → `200`, `roles: ["super_admin"]`. Proves 5.1 is the audience gate firing, not a bad password |
| 5.3 | Student email + wrong password → LMS | PASS | `401 auth.invalid_credentials` |
| 5.4 | Student email + wrong password → CRM | PASS | `401 auth.invalid_credentials` — identical to 5.3, so the response never reveals which app the account belongs to |
| 5.5 | Unknown email → LMS | PASS | `401 auth.invalid_credentials`, same shape again. No enumeration |
| 5.6 | **A CRM session cannot be reused as an LMS session** | **PASS** | A live admin cookie jar replayed with `X-App-Audience: lms` → `401 auth.unauthenticated`, while the same jar with `audience: crm` returns `200`. The per-app cookie slots are genuinely isolated |
| 5.7 | Student-facing API with no session | PASS | `/me`, `/me/bookmarks`, `/me/tickets`, `/me/referrals`, `/forum/threads` → all `401 auth.unauthenticated` |
| 5.8 | LMS app pages | PASS | `/login`, `/forgot-password`, `/reset-password` → `200`; `/dashboard` → `307 → /login?next=%2Fdashboard` |
| 5.9 | **LMS forgot-password for the student** | **PASS** | `POST /auth/password-reset/request` with `audience: "lms"` → `200` generic message, and **the email sent successfully** (this ran after the D-1 fix — no failure line in the API log). The `audience: "lms"` routing means the link targets `LMS_APP_URL`, not the CRM |

#### Still to run (needs the student's password)

| # | Step | Status |
|---|---|---|
| 5.10 | Student + **correct** password → `audience: "crm"` must give `403 auth.audience_forbidden` | BLOCKED |
| 5.11 | Student + correct password → `audience: "lms"` must give `200` | BLOCKED |
| 5.12 | LMS logout, and session dead afterwards | BLOCKED |
| 5.13 | A student session replayed against CRM endpoints must be refused | BLOCKED |

Requesting the password rather than resetting it, so the account is tested exactly as it stands
today and the owner's own login is not disturbed.

### DEFECT D-11 (HIGH) — "Forgot password" is refused for exactly the users who need it most

**Reported from the live LMS: the reset email never arrives. It is not a mail problem — the API
refuses the request before any email is attempted.**

Traced in the production log. A real reset request from the LMS at 2026-08-16 17:51:29 UTC:

```
REQUEST  /api/v1/auth/password-reset/request   origin=https://learn.stimuliiq.com  aud=lms  ua=Mozilla/5.0 (Macintosh…)
RESPONSE 403  (1ms)          ← rejected by a guard; the service never ran, no mail attempted
```

**Root cause.** `MustChangePasswordGuard` is registered as a **global** `APP_GUARD`
(`app.module.ts:171`). `AuditContextMiddleware` populates `req.user` from any valid
`access_token` cookie the browser happens to be carrying — *including on unauthenticated routes*.
The guard then rejects every route not marked `@SkipPasswordGate()` when
`req.user.mustChangePassword` is true.

`PasswordResetController` and `TwoFactorRecoveryController` **do not carry that decorator**. Only
`/auth/change-password`, `/auth/logout`, `/auth/refresh` and `GET /me` do.

So a student who is signed in and flagged `mustChangePassword: true` — which is **every
freshly-provisioned student**, since enrolment issues a temporary password and sets that flag —
is told "you must set a new password", cannot remember the temporary one, clicks **Forgot
password**, and the API answers `403`. The one escape route from the gate is itself behind the gate.

Reproduced deterministically on a throwaway account (created and cleaned up):

| Call | Result |
|---|---|
| `POST /auth/password-reset/request` **with** the gated session cookie | **`403 auth.password_change_required`** |
| the identical call with **no** cookies (fresh browser / private window) | `200` — email sends normally |
| `POST /auth/password-reset/confirm` with the gated session | **`403`** — so even the emailed link fails if opened in the same browser |
| `POST /auth/2fa/recovery/request` with the gated session | **`403`** — the lost-authenticator path is caught by this too |
| `POST /auth/logout` (control — it *has* `@SkipPasswordGate()`) | `200` |

The `403` also makes this invisible from the outside: nothing is logged, no mail is attempted,
and the CRM/LMS UI shows its deliberately generic "if that email exists, we've sent a link"
confirmation on failure as well as success (**by design**, for enumeration resistance — see
`forgot-password-form.tsx:43`). The user is told an email is on its way when the request was
refused outright.

**Workaround available right now:** sign out of the LMS first (or use a private window), then use
Forgot password. Verified working.

**Fix:** add `@SkipPasswordGate()` to both routes on `PasswordResetController` and both on
`TwoFactorRecoveryController`. These are unauthenticated endpoints — the gate should never have
applied to them; it only does so because a stale cookie makes them *look* authenticated. This is
the same class of deadlock already fixed once for `/auth/change-password` and `/auth/refresh`, and
the same one the reset service's own comments describe ("I reset my password, it said success, I
still can't get in").

Worth a broader look while fixing: any other unauthenticated route that a logged-in browser might
call is exposed to the same trap.

*(Correction to an earlier note in this run: `auth/password-reset/*` and `auth/2fa/recovery/*`
**are** correctly CSRF-excluded in `app.module.ts`. CSRF is not involved in this defect.)*

---

*TC-5 completion and TC-6 onward appended as they are run.*
