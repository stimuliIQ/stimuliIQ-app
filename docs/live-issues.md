# Live issues log

Running log of issues observed on production (www.stimuliiq.com / admin.stimuliiq.com /
api.stimuliiq.com). One dated section per reporting day; each issue gets root cause,
fix commit, and status. Fixes are committed locally and pushed in a single batch on
explicit approval (CLAUDE.md §3.13 — every push triggers Vercel deploys).

## 2026-07-26

### 1. `/programs` (and all per-request SSR pages) return 500 on www — FIXED (awaiting push)

- **Symptom:** `https://www.stimuliiq.com/programs` and `/programs/[slug]` return
  `500 Internal Server Error`. `/`, `/about`, `/contact`, `/mentors`, `/blog` still 200.
- **Root cause:** Vercel runtime logs show `Cannot find module 'isomorphic-dompurify'`
  on every SSR render. `apps/web` lists the package in `serverExternalPackages`
  (next.config.mjs) so it is `require()`d at runtime, but never declared it in its own
  `package.json` — Vercel's output tracing therefore omitted it from the serverless
  function. lms/crm/packages-ui all declare it; web was the only consumer missing it.
  Pages that "worked" were only serving stale cached ISR HTML — their background
  revalidations were failing with the same error.
- **Fix:** `f3fb958` — declare `isomorphic-dompurify@^3.18.0` in `apps/web/package.json`
  (+ lockfile).
- **Status:** committed locally; recovers on next push/deploy. Verify `/programs` and a
  `/programs/[slug]` return 200 after deploy.

### 2. CRM lead drawer: "Move stage" dropdown stays on old stage — FIXED (awaiting push)

- **Symptom:** In the lead detail drawer, moving a stage shows the "Stage updated"
  toast, but the dropdown keeps showing the old stage. Re-selecting the same target
  then errors with `Cannot move a lead from "won" to "won"` (server had already moved
  it — DB confirmed `stage=won` immediately). List chips catch up on refetch; the
  dropdown label doesn't.
- **Root cause:** two compounding client issues:
  1. `useMoveLeadStage` optimistically patched only the *list* caches — the *detail*
     cache (which the drawer's `<Select value={lead.stage}>` is bound to) waited on the
     settle-time invalidate round-trip, so the dropdown lagged and its same-stage guard
     compared against a stale stage (hence the won→won 422s).
  2. Radix Select's trigger label (`SelectValue`) does not reliably re-render when the
     controlled `value` prop changes externally — the standard workaround is to remount
     the root via `key` on the value.
- **Fix:** in `apps/crm/src/hooks/use-leads.ts`, patch the detail cache's `stage`
  optimistically in `onMutate` (with rollback) and write the server's returned
  `LeadDetail` into the detail cache in `onSuccess`; in `lead-detail-drawer.tsx`, key
  the stage `<Select>` by `lead.stage` so the trigger label remounts with the fresh value.
- **Status:** committed locally; ships with the same push as issue #1.

### 3. Console WebGL / WOFF warnings on www — NOT A SITE ISSUE (no action)

- **Symptom:** DevTools console on www.stimuliiq.com shows repeated
  `WebGL: INVALID_ENUM`, `powerPreference ignored`, `No available adapters`, and an
  `OTS parsing error` for a WOFF font.
- **Root cause:** every entry traces to `normal?lang=auto:1` — Chrome's built-in
  translation feature / an injected extension context, not site code (the marketing
  site ships no WebGL/WebGPU). Clean in incognito.
