// Vitest config for @stimuliiq/crm — component + a11y smoke tests (R12,
// docs/plans/phase-9-completion.md T41). Mirrors @repo/ui's and @stimuliiq/web's
// vitest setup (jsdom + @testing-library/react + the same Radix/browser-API stubs) so
// crm's component tests behave identically to the rest of the monorepo's FE test suites.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    css: false,
    setupFiles: ["./src/test/setup.ts"],
    // Vitest's 5s default is a wall-clock budget, and this suite spends most of its time
    // inside `userEvent` (which types character-by-character through jsdom) across 40+
    // test files on parallel workers. The four assessment-form-drawer submit cases pass
    // in ~2s each when that file runs alone and time out at 5s when the whole suite
    // contends for the CPU — a scheduling race reported as a functional failure, which
    // is the worst kind of merge gate: red on a loaded CI box, green on a laptop. The
    // budget below is generous enough that only a genuine hang trips it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["src/**/*.test.{ts,tsx}"],
    // Playwright e2e specs live under e2e/ and use @playwright/test's own runner
    // (`pnpm e2e`) — exclude them from the vitest run explicitly so `pnpm test`
    // doesn't try to execute them (they have no describe/it exports vitest expects).
    exclude: ["**/node_modules/**", "e2e/**"],
    // Resolve workspace packages to their TS source (avoids needing to build them
    // first) — same alias set as apps/lms/vitest.config.ts.
    alias: {
      "@repo/api-client": path.resolve(__dirname, "../../packages/api-client/src/index.ts"),
      "@repo/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
      "@repo/ui": path.resolve(__dirname, "../../packages/ui/src/index.ts"),
    },
  },
});
