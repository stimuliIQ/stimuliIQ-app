# infra/docker/api.Dockerfile — production image for @stimuliiq/api (NestJS modular
# monolith), CLAUDE.md §1/§2, docs/04-trd-architecture.md §4-5.
#
# BUILD CONTEXT MUST BE THE REPO ROOT (monorepo-aware — needs the pnpm workspace
# lockfile + the @repo/* packages @stimuliiq/api depends on):
#
#   docker build -f infra/docker/api.Dockerfile -t stimuliiq-api .
#
# Multi-stage:
#   1. `deps`    — install the full workspace (frozen lockfile) so `pnpm install`
#                  can resolve every `workspace:*` reference.
#   2. `build`   — regenerate the Prisma Client against the real schema, compile
#                  @repo/types then @stimuliiq/api.
#   3. `runtime` — copies the ENTIRE built /repo forward (not a `pnpm deploy
#                  --prod`-pruned subset — see the note below on why).
#
# BUILD-VERIFIED (Phase-7 Wave 4, devops CI hardening): `docker build` was run
# end-to-end against this file and a smoke-tested container (`docker run` +
# `curl /api/v1/health/ready` → 200, Docker's own HEALTHCHECK → "healthy") confirmed
# the packaged app actually boots and serves traffic, including via the full
# `docker compose --profile full up` path against real Postgres/Redis containers.
# Three real bugs were found and fixed by that verification, all captured in
# comments (two below, one in infra/docker-compose.yml's `api.environment` comment)
# — don't remove any of the three fixes without re-verifying with a real build+run:
#   1. Missing root `.dockerignore` let `COPY . .` clobber the container's own
#      freshly `pnpm install`-ed (Linux) node_modules with the HOST's node_modules.
#   2. `pnpm deploy --prod <dir>` (the originally-attempted slimming approach) does
#      NOT carry the repo-root `prisma/schema.prisma` into its output directory, so
#      `@prisma/client`'s postinstall (which runs again during `pnpm deploy`'s own
#      fresh install) silently fails to generate a client — the container then
#      crashed at runtime with "@prisma/client did not initialize yet." Rather than
#      chase pnpm's internal store layout to hand-copy the generated engine binary to
#      exactly the right nested path, this Dockerfile takes the simpler, more robust
#      route: carry the ENTIRE already-built `/repo` forward (full workspace
#      node_modules, all apps' source, all devDependencies) into the runtime image.
#      This trades image size for correctness/robustness. Revisit `pnpm deploy
#      --prod` as a size optimization ONLY with a real build to verify the Prisma
#      Client resolves correctly in the pruned output — do not reintroduce it
#      without that verification.
#
# Migrations (`prisma migrate deploy`, forward-only — CLAUDE.md §3.8) run from the
# CI/CD PIPELINE, not from inside this container/an entrypoint script — see the
# `deploy-api` job in .github/workflows/ci.yml. Running migrations once from CI
# (with the full toolchain) avoids N replicas racing to apply the same migration
# concurrently on every container boot.
#
# NEVER bake secrets into this image. SENTRY_DSN, OTEL_EXPORTER_OTLP_ENDPOINT,
# METRICS_TOKEN, DATABASE_URL, REDIS_URL, JWT key paths/material, COOKIE_SECRET,
# CSRF_SECRET, RAZORPAY_*, MAIL_*, WHATSAPP_*, STORAGE_*, etc. are injected at
# container-start time by the deploy platform (Railway service variables / ECS task
# definition `secrets` + `environment` — see railway.json and
# infra/ecs/task-definition.json). See .env.example for the full documented list.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ─── deps: resolve the full workspace lockfile graph ─────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/lms/package.json apps/lms/package.json
COPY apps/crm/package.json apps/crm/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

# ─── build: regenerate Prisma Client against the real schema, then compile ───────
FROM deps AS build
COPY . .
# `@prisma/client`'s postinstall (in the `deps` stage above) could not generate the
# Prisma Client yet — `prisma/schema.prisma` isn't copied until THIS `COPY . .`, so
# the client stayed unresolved/stale (confirmed by a real `docker build` reproduction:
# @stimuliiq/api's tsc build failed with "Module '@prisma/client' has no exported
# member 'X'" for every Prisma-derived type until this explicit generate step was
# added). Regenerate now that the real schema is present, BEFORE building
# @stimuliiq/api (which imports the generated types).
RUN pnpm db:generate
RUN pnpm --filter=@repo/types run build
RUN pnpm --filter=@stimuliiq/api run build

# ─── runtime: carry the full built workspace forward (see header note) ──────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN apk add --no-cache curl
COPY --from=build /repo /repo
WORKDIR /repo/apps/api

EXPOSE 4000

# Most orchestrators (ECS, Railway) use their OWN platform-level health check
# config instead of this Docker HEALTHCHECK (see infra/ecs/task-definition.json /
# railway.json) — this is kept for `docker run`/local/Compose usage.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:4000/api/v1/health/ready || exit 1

CMD ["node", "dist/main.js"]
