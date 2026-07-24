import { defineConfig } from "vitest/config";

// Minimal vitest setup for @repo/ui — render/a11y smoke tests for the design system
// primitives. apps/api uses Jest; FE packages have no test runner wired yet, so this is
// scoped to @repo/ui only (per phase-0 task #5 DoD).
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    globals: false,
  },
});
