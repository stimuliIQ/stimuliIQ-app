// vitest config for @stimuliiq/web — component tests only.
// Mirrors the @repo/ui setup (jsdom + @testing-library/react).
// Next.js App Router RSC pages are NOT tested here (they need a Next.js
// integration harness); this covers presentational components + hooks.
//
// Phase 4, Task #11: VerifyPanel tests (valid / revoked / invalid states + a11y).

import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    // Use the automatic React 17+ JSX runtime so tests don't need `import React`
    // (Next.js tsconfig uses "preserve" for JSX — vitest/esbuild must handle it).
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
