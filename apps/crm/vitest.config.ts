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
