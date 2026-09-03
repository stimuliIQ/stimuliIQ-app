// apps/api/src/modules/auth/lib/token.service.spec.ts
//
// Unit tests for TokenService's `aud` (audience) claim (Phase-7 Wave 2 security
// hardening batch A, closes P0 followups M-4: "JWT access tokens have no `aud`
// claim"). Mirrors the per-file `jest.mock("jose", ...)` pattern already established
// by modules/lms/providers/video/video-provider.spec.ts, a controllable SignJWT mock
// lets us assert exactly which claims/options are passed to `sign()`/`jwtVerify()`
// without touching real RS256 keys or the ESM-only `jose` package directly.
//
// Coverage:
//   - signAccessToken / signRefreshToken call `.setAudience(env.JWT_AUDIENCE)`.
//   - verifyAccessToken / verifyRefreshToken pass `audience: env.JWT_AUDIENCE` to
//     jwtVerify (jose itself is responsible for rejecting a mismatched/missing `aud`,
//     proven for real in the integration suite; this unit test proves TokenService
//     ASKS jose to enforce it, which is the actual regression surface for this fix).
//   - A jwtVerify rejection (simulating jose's real JWTClaimValidationFailed for a
//     wrong/missing `aud`) propagates as a thrown error from TokenService.

const FAKE_JWT_TOKEN = "fake.jwt.token.for.testing";

// Captures the last SignJWT instance's recorded state for assertions.
let lastSignJwtState: { payload: Record<string, unknown>; audience?: unknown } | undefined;
// Controls the next jwtVerify() call's behavior, set per-test.
let jwtVerifyImpl: (token: string, key: unknown, opts: unknown) => Promise<{ payload: Record<string, unknown> }>;

jest.mock("jose", () => {
  class MockSignJWT {
    private _payload: Record<string, unknown>;
    private _audience?: unknown;

    constructor(payload: Record<string, unknown>) {
      this._payload = payload;
    }
    setProtectedHeader() {
      return this;
    }
    setSubject(s: string) {
      this._payload["sub"] = s;
      return this;
    }
    setIssuer(s: string) {
      this._payload["iss"] = s;
      return this;
    }
    setAudience(aud: unknown) {
      this._audience = aud;
      return this;
    }
    setJti(s: string) {
      this._payload["jti"] = s;
      return this;
    }
    setIssuedAt() {
      return this;
    }
    setExpirationTime() {
      return this;
    }
    async sign(): Promise<string> {
      lastSignJwtState = { payload: this._payload, audience: this._audience };
      return FAKE_JWT_TOKEN;
    }
  }

  return {
    SignJWT: MockSignJWT,
    importPKCS8: jest.fn().mockResolvedValue({ type: "private" }),
    importSPKI: jest.fn().mockResolvedValue({ type: "public" }),
    jwtVerify: jest.fn((token: string, key: unknown, opts: unknown) => jwtVerifyImpl(token, key, opts)),
  };
});

// Avoid touching real PEM files on disk, jwt-keys.ts is a thin file-loader wrapper
// around jose's importPKCS8/importSPKI, irrelevant to the `aud` claim behavior under test.
jest.mock("./jwt-keys", () => ({
  loadPrivateKey: jest.fn().mockResolvedValue({ type: "private" }),
  loadPublicKey: jest.fn().mockResolvedValue({ type: "public" }),
  JWT_ALG: "RS256",
}));

import { jwtVerify as mockedJwtVerify } from "jose";
import { TokenService } from "./token.service";
import { __resetEnvCacheForTests } from "../../../config/env";

const REQUIRED_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stimuliiq",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
  // Coherent PRODUCTION values. `validateEnv` requires these once NODE_ENV/APP_ENV is
  // "production" (a session cookie without Secure, or scoped to localhost, is a real
  // misconfiguration) — and every case below that exercises a production boot guard
  // sets exactly that. Without them the spec would fail on env validation before ever
  // reaching the guard it is testing.
  COOKIE_SECURE: "true",
  COOKIE_DOMAIN: ".stimuliiq.test",
};

describe("TokenService, aud (audience) claim", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    __resetEnvCacheForTests();
    jwtVerifyImpl = async () => ({ payload: {} });
    lastSignJwtState = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetEnvCacheForTests();
    jest.clearAllMocks();
  });

  it("signAccessToken sets the audience claim to the default JWT_AUDIENCE when unset", async () => {
    process.env = { ...REQUIRED_ENV };
    const service = new TokenService();

    await service.signAccessToken({ userId: "user-1", tenantId: "tenant-1", roles: ["student"] });

    expect(lastSignJwtState?.audience).toBe("stimuliiq-clients");
  });

  it("signAccessToken sets the audience claim to a configured JWT_AUDIENCE", async () => {
    process.env = { ...REQUIRED_ENV, JWT_AUDIENCE: "stimuliiq-lms" };
    const service = new TokenService();

    await service.signAccessToken({ userId: "user-1", tenantId: "tenant-1", roles: ["student"] });

    expect(lastSignJwtState?.audience).toBe("stimuliiq-lms");
  });

  it("signRefreshToken sets the audience claim", async () => {
    process.env = { ...REQUIRED_ENV, JWT_AUDIENCE: "stimuliiq-lms" };
    const service = new TokenService();

    await service.signRefreshToken({ userId: "user-1", sessionId: "session-1" });

    expect(lastSignJwtState?.audience).toBe("stimuliiq-lms");
  });

  it("verifyAccessToken passes { issuer, audience } to jwtVerify", async () => {
    process.env = { ...REQUIRED_ENV, JWT_AUDIENCE: "stimuliiq-crm" };
    const service = new TokenService();

    await service.verifyAccessToken("some.jwt.token");

    expect(mockedJwtVerify).toHaveBeenCalledWith(
      "some.jwt.token",
      expect.anything(),
      expect.objectContaining({ issuer: "stimuliiq-api", audience: "stimuliiq-crm" }),
    );
  });

  it("verifyRefreshToken passes { issuer, audience } to jwtVerify", async () => {
    process.env = { ...REQUIRED_ENV, JWT_AUDIENCE: "stimuliiq-crm" };
    const service = new TokenService();

    await service.verifyRefreshToken("some.jwt.token");

    expect(mockedJwtVerify).toHaveBeenCalledWith(
      "some.jwt.token",
      expect.anything(),
      expect.objectContaining({ issuer: "stimuliiq-api", audience: "stimuliiq-crm" }),
    );
  });

  it("verifyAccessToken propagates a jose audience-mismatch rejection (wrong aud is rejected)", async () => {
    process.env = { ...REQUIRED_ENV, JWT_AUDIENCE: "stimuliiq-crm" };
    jwtVerifyImpl = async () => {
      throw new Error("JWTClaimValidationFailed: unexpected \"aud\" claim value");
    };
    const service = new TokenService();

    await expect(service.verifyAccessToken("some.jwt.token")).rejects.toThrow(/aud/);
  });
});
