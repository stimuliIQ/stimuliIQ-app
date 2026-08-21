// Vitest config for @stimuliiq/lms — Phase 4 Task #10.
// Hook unit tests + sanitize utility tests + key structure tests.
// Uses jsdom environment to allow DOMPurify (isomorphic-dompurify uses DOM on client).
// globals: true injects describe/it/expect/vi — tsconfig.test.json types them.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // jest-dom matchers + RTL cleanup + a matchMedia stub, so component tests behave the
    // same here as they do in apps/crm.
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // e2e/ holds @playwright/test specs (R13, docs/plans/phase-9-completion.md T41) —
    // they use Playwright's own `test`/`test.describe`/`test.skip` API (run via
    // `pnpm e2e`, playwright.config.ts), not vitest's, and must never be collected by
    // this config's default test discovery.
    exclude: ["**/node_modules/**", "e2e/**"],
    // Point vitest at the test tsconfig so it picks up vitest global types.
    typecheck: {
      tsconfig: path.resolve(__dirname, "tsconfig.test.json"),
    },
    // Resolve workspace packages to their TS source (avoids needing to build them first).
    alias: {
      "@repo/api-client": path.resolve(__dirname, "../../packages/api-client/src/index.ts"),
      "@repo/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
      "@repo/ui": path.resolve(__dirname, "../../packages/ui/src/index.ts"),
    },
  },
});
