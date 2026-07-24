// apps/api/test/unit-mocks/jose.ts
//
// `jose` v6 ships ESM-only and has no CommonJS build, which ts-jest (running under Jest's
// default CJS transform) cannot `require()` directly — Jest fails to parse the package's
// `export { ... }` syntax (see jest.config.js's `moduleNameMapper` wiring this stub in for
// the unit-test environment only; production code is unaffected, this file is never
// bundled). None of the unit tests exercise the REAL RS256 signing/verification path —
// every test that touches AuthService/guards injects a fully mocked `TokenService`
// (apps/api/src/modules/auth/auth.spec.ts) — so a minimal stub satisfying TokenService's
// and VideoProvider's import surface (SignJWT/jwtVerify/importPKCS8/importSPKI + the
// type-only exports) is sufficient here. The integration suite (jest.integration.config.js)
// needs the REAL `jose` package end-to-end and explicitly does NOT reference this file.
//
// IMPORTANT — directory naming: this file deliberately is NOT named `test/__mocks__/
// jose.ts`. Jest auto-applies any `__mocks__/<pkg>.ts` file adjacent to `roots` as a
// manual mock for that node_modules package for EVERY test file under those roots,
// regardless of which jest config/project is running and with no `jest.mock()` call
// needed — there is no per-config opt-out once the file exists at that conventional
// path. That silently broke the integration suite (which shares `roots: ["<rootDir>"]`
// with the unit config): every real `jose` export resolved to this stub even though
// jest.integration.config.js's `moduleNameMapper`/`transform` never reference it.
// Keeping the stub in `test/unit-mocks/` (a non-magic directory name) and wiring it in
// ONLY via jest.config.js's explicit `moduleNameMapper` (rather than relying on the
// automatic `__mocks__` convention) keeps the two suites fully isolated.
//
// P3 extension: the CloudflareStreamVideoProvider and MuxVideoProvider import
// `importPKCS8` from jose to load their RS256 signing keys. The unit-test suite for
// these providers (video-provider.spec.ts) mocks jose's SignJWT and importPKCS8 at the
// jest.mock() level (per-file), overriding this stub's already-stub behaviour where
// needed. This stub's importPKCS8 returns a stable fake CryptoKey object so that the
// provider constructor does not throw during module load in the unit suite.

class SignJWTStub {
  setProtectedHeader() {
    return this;
  }
  setSubject() {
    return this;
  }
  setIssuer() {
    return this;
  }
  setAudience() {
    return this;
  }
  setIssuedAt() {
    return this;
  }
  setNotBefore() {
    return this;
  }
  setExpirationTime() {
    return this;
  }
  setJti() {
    return this;
  }
  async sign(): Promise<string> {
    return "stub.jwt.token";
  }
}

export const SignJWT = SignJWTStub;

export async function jwtVerify(): Promise<{ payload: Record<string, unknown> }> {
  return { payload: {} };
}

/**
 * Returns a stable fake CryptoKey-like object. The VideoProvider unit tests
 * mock this at the per-file level with jest.mock('jose', ...) to control exact
 * JWT output. This default ensures modules that import importPKCS8 do not throw
 * during module resolution in the unit suite.
 */
export async function importPKCS8(): Promise<Record<string, never>> {
  return {} as Record<string, never>;
}

export async function importSPKI(): Promise<Record<string, never>> {
  return {} as Record<string, never>;
}

// CryptoKey type stub — jose v6 re-exports CryptoKey from the WebCrypto API.
// We expose a minimal opaque type stub so TypeScript is satisfied for
// `type CryptoKey` imports in the unit suite without needing the real jose ESM build.
export type CryptoKey = { type: string };
