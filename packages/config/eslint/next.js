// @repo/config/eslint/next — preset for Next.js apps (web, lms).
const base = require("./base");

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  ...base,
  {
    rules: {
      // React 19 + the new JSX transform do not require React in scope.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Hand-written service worker (public/sw.js) runs in the ServiceWorkerGlobalScope,
    // not a normal browser window — declare its globals so `no-undef` passes.
    files: ["**/public/sw.js", "**/public/service-worker.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        clients: "readonly",
        URL: "readonly",
        Response: "readonly",
        Request: "readonly",
        importScripts: "readonly",
      },
    },
  },
];
