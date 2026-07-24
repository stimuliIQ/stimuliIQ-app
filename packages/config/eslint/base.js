// @repo/config/eslint/base — shared flat ESLint config for all workspace packages.
// CommonJS on purpose so it can be `require()`'d from any consumer regardless of
// that consumer's own "type" field.
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      // Next.js-generated, not hand-authored — see "This file should not be edited".
      "**/next-env.d.ts",
    ],
  },
  {
    rules: {
      // CLAUDE.md §3.1 — no `any` without an inline justification comment.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Config files themselves run under plain Node/CommonJS (eslint.config.*,
    // *.config.js, tailwind/postcss configs, etc.), not the app's own module system.
    files: ["**/*.config.js", "**/*.config.cjs", "**/*.config.mjs"],
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
];
