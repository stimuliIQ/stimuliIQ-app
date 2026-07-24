// apps/api/jest.integration.config.js
//
// Separate Jest project for the auth/RBAC INTEGRATION suite (qa-engineer, Wave 5,
// docs/plans/phase-0.md task #10) — deliberately NOT merged into jest.config.js because:
//   1. It must NOT stub `jose` (jest.config.js's moduleNameMapper points jose at
//      test/__mocks__/jose.ts for fast unit tests) — these tests boot the REAL Nest app
//      and need real RS256 signing/verification end-to-end over HTTP.
//   2. It needs a longer default timeout (testcontainers image pulls + container start
//      can take well over Jest's 5s default on a cold Docker cache).
// Run via `pnpm test:integration` (apps/api/package.json) — `turbo run test` continues
// to run ONLY jest.config.js (fast unit suite); CI's dedicated integration step runs
// this config explicitly (see .github/workflows/ci.yml "Integration tests" job).
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testRegex: ".*\\.integration-spec\\.ts$",
  testTimeout: 120_000,
  // Phase-7 Wave 4 (devops CI hardening): pin to a single worker EXPLICITLY in config
  // (belt-and-braces alongside the `--runInBand` CLI flag already set in this package's
  // `test:integration` script) so this suite stays serialized even if ever invoked a
  // different way (IDE test runner, `npx jest --config ...` without the flag, etc.).
  // Each of the 14 `*.integration-spec.ts` files boots a full Nest `AppModule` (2 pooled
  // PrismaClients via PrismaService) plus its own fixtures PrismaClient — running files
  // in parallel workers multiplies that pool count and was observed to exhaust the
  // testcontainers Postgres's connection slots ("too many clients already"). Combined
  // with the `connection_limit` cap on the generated DATABASE_URL (see
  // test/integration/global-setup.ts), this bounds concurrent connections to one file's
  // worth at a time.
  maxWorkers: 1,
  globalSetup: "<rootDir>/test/integration/global-setup.ts",
  globalTeardown: "<rootDir>/test/integration/global-teardown.ts",
  // qa-engineer Wave 5 fix (docs/plans/phase-9-completion.md T41, item 3a): raises
  // AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS for the whole integration run so the shared-Redis,
  // shared-loopback-IP AuthIpRateLimitGuard bucket doesn't trip across files that have
  // nothing to do with rate-limit behavior — see setup-env.ts's header for the full
  // rationale. Runs once per test FILE (Jest re-executes `setupFiles` per file), before
  // that file's own module-level `process.env` assignments.
  setupFiles: ["<rootDir>/test/integration/setup-env.ts"],
  moduleNameMapper: {
    // @repo/types builds as pure ESM (`"type": "module"`, dist/index.js uses `export`),
    // which Jest's default CJS transform cannot `require()`. Map the import straight at
    // its TypeScript SOURCE so ts-jest compiles it to CJS like everything else in this
    // test run — test-only; production code still consumes the real built dist.
    "^@repo/types$": "<rootDir>/../../packages/types/src/index.ts",
  },
  // @repo/types' own relative specifiers explicitly end in `.js` per its NodeNext
  // moduleResolution config (e.g. `./common/envelope.js`, imported FROM inside
  // packages/types/src) — ts-jest needs the sibling `.ts` file. A `moduleNameMapper`
  // regex stripping `.js` (e.g. `^(\.{1,2}/.*)\.js$` => `$1`) is NOT safe: Jest applies
  // moduleNameMapper to every relative specifier project-wide with no awareness of WHICH
  // file is importing it — that broader rule ALSO matched jose's own internal barrel
  // re-exports (jose's dist/webapi/index.js does `export { SignJWT } from
  // './jwt/sign.js'`), silently breaking jose's real resolution and making jose's real
  // exports look EXACTLY like test/__mocks__/jose.ts's stub (literal "stub.jwt.token"
  // strings, `{}` JWT payloads) even with no explicit jose mock present in this config.
  // `resolver` below inspects `options.basedir` (the importing file's own directory) and
  // only strips `.js` for specifiers resolved from within packages/types/src, leaving
  // every other package (including jose) to resolve normally.
  resolver: "<rootDir>/test/integration/repo-types-resolver.js",
  transformIgnorePatterns: [
    // Allow ts-jest/babel to transform jose's ESM output instead of treating it as an
    // opaque pre-built CJS node_modules package (the default `node_modules/` ignore
    // pattern would otherwise skip it entirely and Jest would try to `require()` raw
    // ESM `export` syntax, which fails). jose has no CJS build (package.json
    // `"type": "module"`) — this lets Jest's transform pipeline handle it as ESM-aware
    // source instead.
    //
    // pnpm nests the real package under `node_modules/.pnpm/jose@<ver>/node_modules/
    // jose/...` — the lookahead must check what comes after `node_modules/.pnpm/` (or
    // any other prefix) too, not just a literal top-level `node_modules/jose/`. A plain
    // `/node_modules/(?!jose)` only inspects the FIRST `node_modules/` segment it finds;
    // since pnpm's first segment is `node_modules/.pnpm/...` (not `node_modules/jose/`),
    // the negative lookahead succeeded and jose's pnpm-nested path was WRONGLY left in
    // the default ignore set — Jest then tried to `require()` jose's raw ESM `export`
    // syntax and crashed with "Unexpected token 'export'". Matching on `jose/dist` (a
    // path segment that only ever appears once we're actually inside jose's own
    // directory, regardless of how many `.pnpm/<name>@<ver>/node_modules/` segments
    // precede it) avoids the ambiguity.
    "[\\\\/]node_modules[\\\\/](?!.*jose[\\\\/]dist)",
  ],
  extensionsToTreatAsEsm: [],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {}],
    // jose ships plain `.js` ESM with no TS types compiled in — transform its `.js`
    // files through ts-jest too (allowJs-equivalent), which is happy to compile ESM
    // `export`/`import` syntax down to CommonJS `exports`/`require` for Jest's runtime.
    // Matches jose's dist files regardless of how many `node_modules/.pnpm/...` segments
    // precede `jose/dist` in the resolved path (see transformIgnorePatterns comment above
    // for why a simpler `node_modules/jose/...` pattern is insufficient under pnpm), and
    // regardless of `/` vs `\` path separators (Windows resolves absolute paths with
    // backslashes; the patterns here must match both).
    ".*jose[\\\\/]dist[\\\\/].+\\.js$": [
      "ts-jest",
      { isolatedModules: true, tsconfig: { allowJs: true, module: "commonjs", target: "es2022" } },
    ],
  },
};
