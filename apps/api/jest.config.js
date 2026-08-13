/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  collectCoverageFrom: ["src/**/*.(t|j)s"],
  coverageDirectory: "./coverage",
  // `jose` v6 is ESM-only (no CJS build) and cannot be `require()`d by Jest's default
  // CJS transform — see test/unit-mocks/jose.ts for why a stub is safe for the current
  // unit test surface (TokenService is always injected as a jest mock, never exercised
  // for real, in any spec that currently exists). Deliberately NOT named
  // `test/__mocks__/jose.ts` — see that file's header comment: Jest's automatic
  // `__mocks__` convention applies this manual mock to EVERY project sharing these
  // `roots` (including jest.integration.config.js, which needs the REAL jose), with no
  // way to opt a specific config out of it. Wiring the stub in explicitly here (and only
  // here) keeps the integration suite unaffected.
  // Seeds the production-required signing secrets so specs that flip APP_ENV/NODE_ENV to
  // "production" to test something else don't fail env validation on unrelated vars.
  // See the file header; it sets defaults only, so absence-asserting specs still work.
  setupFiles: ["<rootDir>/test/unit-setup-env.ts"],
  moduleNameMapper: {
    "^jose$": "<rootDir>/test/unit-mocks/jose.ts",
    // @repo/types builds as pure ESM (`"type": "module"`, dist/index.js uses `export`),
    // which Jest's default CJS transform cannot `require()`. Unit-tested services now
    // consume RUNTIME values from it (e.g. `resolveLifecycleStage`, lifecycle-redesign
    // P1) — not just erased type imports — so map the import straight at its TypeScript
    // SOURCE, exactly as jest.integration.config.js already does. Test-only; production
    // code still consumes the real built dist.
    "^@repo/types$": "<rootDir>/../../packages/types/src/index.ts",
  },
  // Reuse the integration suite's scoped resolver so @repo/types' own NodeNext `.js`
  // relative specifiers (e.g. `./crm/lifecycle.schemas.js`) resolve to their sibling
  // `.ts` sources — and ONLY for imports originating inside packages/types/src, leaving
  // the jose stub and every other package to resolve normally. See the resolver's header
  // and jest.integration.config.js for why a blanket `.js`-stripping mapper is unsafe.
  resolver: "<rootDir>/test/integration/repo-types-resolver.js",
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
};
