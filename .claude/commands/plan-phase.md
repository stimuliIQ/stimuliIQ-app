---
description: Plan and execute a build phase using the orchestrator + specialist subagents
argument-hint: <phase, e.g. P0 | "lead pipeline">
---

Use the **orchestrator** subagent to produce the build plan for: **$ARGUMENTS**.

The orchestrator must read `CLAUDE.md` and the relevant files in `/docs`, then write the
plan to `docs/plans/` and return an ordered delegation list.

Then execute that plan: for each task, in dependency order (parallelizing within a wave
where safe), delegate to the named specialist subagent (`db-architect`, `api-designer`,
`backend-builder`, `integrations`, `frontend-builder`, `design-system`, `qa-engineer`,
`devops`, `docs-writer`). After implementation, run the **security-reviewer** subagent on
any auth/payments/RBAC/media/PII work, and the **qa-engineer** subagent to verify acceptance
criteria. Stop at the phase gate and summarize Definition-of-Done status before continuing.
