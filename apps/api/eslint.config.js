const base = require("@repo/config/eslint/node");

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  ...base,
  {
    // test/integration/*.integration-spec.ts intentionally uses `require()` (not static
    // top-level `import`) inside its `describe.skip`-guarded block — see that file's own
    // header comment: when the suite is skipped (no reachable Postgres/Redis), nothing
    // inside must ever be `require()`d against unset env vars. A static `import` would
    // be hoisted and evaluated regardless of `describe.skip`, defeating the whole
    // graceful-skip design (docs/04 §6 "Integration | Jest + testcontainers").
    files: ["test/integration/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  },
  {
    // test/integration/repo-types-resolver.js is a plain Node CommonJS file consumed
    // directly by Jest's `resolver` option (jest.integration.config.js) — not compiled
    // by ts-jest, so it runs under Node's native CJS module system with `require`/
    // `module`/`__dirname` as real globals.
    files: ["test/integration/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "writable",
        require: "readonly",
        exports: "writable",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // scripts/*.cjs are plain Node CommonJS helper scripts (run directly with `node`,
    // never compiled by tsc) — same posture as test/integration/*.js above.
    files: ["scripts/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "writable",
        require: "readonly",
        exports: "writable",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
