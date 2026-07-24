# 08 — Monorepo Scaffold Spec (Phase 0 / "G0")

*Paste-ready target for the `devops` agent. This is the skeleton everything else builds on.*

---

## 1. Target tree
```
stimuliiq/
├── apps/
│   ├── web/          # Next.js 15 (App Router) — marketing
│   ├── lms/          # Next.js 15 (App Router, PWA) — student portal
│   ├── crm/          # Vite + React 19 SPA — admin
│   └── api/          # NestJS — backend
├── packages/
│   ├── ui/           # design system (shadcn + tokens)
│   ├── types/        # zod schemas + shared DTOs
│   ├── api-client/   # typed SDK (generated from OpenAPI)
│   └── config/       # eslint, tsconfig, tailwind presets
├── prisma/           # schema.prisma, migrations, seed.ts
├── infra/            # docker-compose.yml, deploy config
├── docs/             # PRD/TRD/flows/design/plans/specs/adr
├── .claude/
│   ├── agents/       # subagents
│   └── commands/     # slash commands
├── .github/workflows/ci.yml
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── CLAUDE.md
```

## 2. Workspace config
`pnpm-workspace.yaml`:
```yaml
packages: ["apps/*", "packages/*"]
```
`turbo.json` pipelines: `build` (depends ^build), `lint`, `test`, `e2e`, `dev` (persistent),
`db:migrate`, `db:seed`.

## 3. Phase-0 Definition of Done
- [ ] `pnpm i` installs the whole workspace; `turbo run build lint test` is green (empty but
      wired).
- [ ] `docker-compose up` starts Postgres + Redis; `.env.example` documented + zod-validated.
- [ ] `prisma migrate dev` applies the **core** schema (tenants, branches, users, roles,
      permissions, role_permissions, user_roles, sessions, programs, modules, lessons) and
      `seed.ts` creates a tenant, the default roles + permission matrix, and an admin user.
- [ ] `apps/api` boots with **auth** (email+password argon2id, OTP stub, JWT access+refresh
      rotation) and the **RBAC guard + scope interceptor** working end-to-end on one
      protected route.
- [ ] `packages/ui` exports a themed Button + Card + Input + Toast with light/dark tokens.
- [ ] `packages/types` exports the auth zod schemas; `packages/api-client` is generated from
      the OpenAPI of the auth routes.
- [ ] `apps/web`, `apps/lms`, `apps/crm` each render a shell that calls one real API route
      through `@repo/api-client` and shows loading/empty/error states.
- [ ] CI runs typecheck → lint → unit/integration → build on every PR; preview deploys wired.
- [ ] Sentry + pino logging + OTel tracing initialized in `apps/api`.

## 4. Suggested execution (orchestrator → specialists)
```
Wave 1: devops (scaffold + docker + CI + env)        ‖  design-system (tokens + 4 primitives)
Wave 2: db-architect (core schema + seed + soft-delete/audit middleware)
Wave 3: api-designer (auth contracts + zod + OpenAPI + client)
Wave 4: backend-builder (auth module + RBAC guard + scope interceptor)
Wave 5: frontend-builder (3 app shells calling /me)   →  qa-engineer (auth + RBAC tests)
Wave 6: security-reviewer (auth/RBAC audit)           →  docs-writer (sync docs + ADRs)
```

## 5. Kickoff prompt (paste into Claude Code at repo root)
```
Read CLAUDE.md and docs/08-monorepo-scaffold.md.
Use the orchestrator subagent to plan Phase 0 from docs/08, write the plan to docs/plans/,
and return the delegation list. Then execute it wave by wave, delegating each task to the
named specialist subagent, and stop at the Phase-0 Definition of Done with a status report.
```
