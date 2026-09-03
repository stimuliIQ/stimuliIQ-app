// @repo/config/eslint/next — preset for React apps (web, lms, crm, and @repo/ui).
const base = require("./base");
const reactHooks = require("eslint-plugin-react-hooks");

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  ...base,
  {
    // RULES OF HOOKS. This was not configured anywhere in the monorepo, and it cost a
    // production crash: `assignment-detail-content.tsx` called React.useMemo AFTER four
    // conditional early returns, so the render where the data arrived ran one more hook
    // than the loading render before it and React threw "Rendered more hooks than during
    // the previous render" — on every cold load of the LMS assignment page, with no error
    // boundary anywhere in apps/lms/app to catch it. `rules-of-hooks` is an ERROR because
    // violating it is never a style question; `exhaustive-deps` stays a warning, since a
    // deliberately narrow dependency list is a legitimate (if rare) choice.
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
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
