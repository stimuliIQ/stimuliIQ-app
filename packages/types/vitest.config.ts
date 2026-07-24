import { defineConfig } from "vitest/config";

// Minimal vitest setup for @repo/types — unit tests for the PURE domain helpers
// that live alongside the zod schemas (e.g. resolveLifecycleStage). The package
// is ESM ("type": "module"), so vitest resolves the `.js` import specifiers to
// their `.ts` sources natively — apps/api's Jest (CJS) cannot require the ESM
// dist, which is why these functions are tested here, at their source.
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
  },
});
