# Local Dev — Running the Stack & Login Credentials

> **Local development only.** These are non-secret demo credentials for a seeded
> local database. They do not exist in staging/production.

## Prerequisites

- Docker running with the compose stack up:
  ```
  docker compose -f infra/docker-compose.yml --env-file .env up -d
  ```
  (Postgres on host port **55433**, Redis on **6380** — see `.env`.)
- `pnpm install` done, and JWT keys generated (`keys/jwt-private.pem` / `jwt-public.pem`).
- DB migrated + seeded: `pnpm --filter @stimuliiq/api exec prisma migrate deploy` then the seed.

## One-time: set demo passwords

Seeded users are created `status="invited"` with placeholder hashes and **cannot log
in** (auth requires `status="active"`). The admin password is randomly generated at
seed time and printed once. Run this to set stable, known passwords and activate the
demo accounts:

```
node scripts/dev-set-passwords.cjs
```

(The script refuses to run against a non-local `DATABASE_URL` or in production.)

## Start each app

| App | Command | URL |
|-----|---------|-----|
| API (NestJS) | `pnpm --filter @stimuliiq/api dev` | http://localhost:4000 (base path `/api/v1`) |
| web (marketing) | `pnpm --filter @stimuliiq/web dev` | http://localhost:3000 * |
| lms (student) | `pnpm --filter @stimuliiq/lms dev` | http://localhost:3001 |
| crm (admin) | `pnpm --filter @stimuliiq/crm dev` | http://localhost:3002 |

\* The web dev script defaults to **3000**. If 3000 is occupied, run it elsewhere with
`pnpm --filter @stimuliiq/web exec next dev --port 3003` **and** set
`WEB_APP_URL=http://localhost:3003` in `.env` before starting the API, so the API's
credentialed-CORS allowlist accepts it. The API sources its allowlist from
`WEB_APP_URL` / `LMS_APP_URL` / `CRM_APP_URL`.

Health check: `GET http://localhost:4000/api/v1/health/ready` → `{"status":"ok","db":"ok","redis":"ok"}`.

## Demo logins

| Email | Password | Role | Use in |
|-------|----------|------|--------|
| `admin@stimuliiq.test` | `Admin@12345` | Super Admin (full catalog, scope=all) | **CRM** (3002) |
| `faculty.priya@stimuliiq.test` | `Faculty@12345` | Faculty (assigned-scope grading) | **CRM** (3002) |
| `counsellor.sneha@stimuliiq.test` | `Counsellor@12345` | Counsellor (leads/bookings) | **CRM** (3002) |
| `mentor.ramesh@stimuliiq.test` | `Mentor@12345` | Mentor (own batches + completion) | **CRM** (3002), `/mentor/dashboard` |
| `student.ananya@stimuliiq.test` | `Student@12345` | Student (enrolled) | **LMS** (3001) |

Login endpoint: `POST /api/v1/auth/login` with `{ "email", "password" }`. On success it
sets `access_token` (15 min, httpOnly), `refresh_token` (7 d, httpOnly, rotating), and a
readable `csrf_token` cookie; send that value back as the `X-CSRF-Token` header on unsafe
mutations (double-submit CSRF).

## Notes

- `web` is mostly public and does not require login. The enrollment/booking funnel calls
  the public API.
- Phone-OTP login (`POST /api/v1/auth/otp/request`) is stubbed locally — the SMS provider
  is a no-op (go-live blocker B3). Use email+password above for local testing.
- Password login is rejected for any account not `status="active"`; the script above
  activates only the five demo accounts, not the whole seed set.
