# System Health (CRM ▸ Admin ▸ System Health)

A super-admin-only screen answering "is the platform healthy right now, and how big is it?".

## Access

- Route `/admin/system-health`, API `GET /api/v1/crm/system-health`.
- Permission `system.health.view`, **super_admin only**. It is upserted in `prisma/seed.ts` outside the
  permission catalog (the array the admin catch-all iterates), the same device as `leave.approve` and
  `org.teams.manage`. The screen shows topology, versions, which integrations are off and headcounts,
  which is the owner's view. `permission-catalog.spec` style test: `system-health.permission-catalog.spec.ts`.
- This is **not** the public `/health` and `/health/ready` probes, which stay unauthenticated and reveal
  only ok/down.

## What is checked

| Component | How | Status rules |
|---|---|---|
| API server | The process answering the request: heap vs V8 limit, event-loop p99, 5xx rate | degraded on heap >= 90% of the V8 limit, p99 >= 250 ms, or 5xx rate >= 5% over >= 20 requests |
| PostgreSQL | `SELECT 1`, plus version, size, connections | down on failure or 3 s timeout; degraded at >= 500 ms |
| Redis | `PING`, plus `INFO` | same as Postgres |
| Web / LMS / CRM | One `GET` to the URL in `WEB_APP_URL` / `LMS_APP_URL` / `CRM_APP_URL`, redirects not followed | down on network error, timeout (5 s) or 5xx; degraded at >= 3 s |
| Integrations | **Configuration only, never pinged**: payments, email, SMS, WhatsApp, storage, video, captcha, Sentry, queue driver | healthy = provider on with credentials present; degraded = on without credentials, or off where production needs it (payments, email, storage, Sentry); unknown = deliberately off |

Overall verdict (`rollUpSystemHealth`, shared in `@repo/types`): **down** if API, Postgres or Redis is down;
**degraded** if anything else is down or degraded; otherwise **healthy**. `unknown` never degrades it.

## Students

From `student_profiles` (not soft-deleted): total, active accounts, signed in last 24 h / 7 d, never signed
in, new in 7 / 30 days, plus live (unrevoked, unexpired) sessions across the tenant.

## Design notes

- **Leak-safe.** Failures are logged server-side only. The response carries short sentences the server wrote:
  no hostnames, ports, driver errors or secrets.
- **Cached 10 s and single-flighted per tenant**, because the page polls every 30 s and each snapshot fans out
  to Postgres, Redis and three HTTP calls.
- Traffic counters come from the in-process metrics registry and reset on every restart/deploy.
- The frontend checks run from the API server, so they prove the API can reach the sites, not that a user's
  network can. A frontend that is "down" because it simply is not running locally is expected in dev.
- Integrations are not pinged on purpose: it would spend vendor quota on every refresh. Their summary text says
  "not pinged" so a green tile is never read as reachability.

## DB setup on an existing / live database

No migration. Run `pnpm db:seed:system-health`, which writes only the permission and one grant to
`super_admin`. Do **not** run the full `pnpm db:seed` against a live DB.
