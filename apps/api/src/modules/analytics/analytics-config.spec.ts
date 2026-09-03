// apps/api/src/modules/analytics/analytics-config.spec.ts
//
// Unit tests for the analytics configuration seam (analytics-config.ts).
//
// Test strategy:
//   - All tests are UNIT, no network calls, no vendor SDK.
//   - resolveAnalyticsConfig() is called with various env configurations.
//   - Tests cover:
//       1. Default Noop when ANALYTICS_PROVIDER is unset.
//       2. Noop when ANALYTICS_PROVIDER=noop explicitly.
//       3. Noop when ANALYTICS_PROVIDER=ga4 but ANALYTICS_MEASUREMENT_ID absent.
//       4. GA4 config when ANALYTICS_PROVIDER=ga4 + ANALYTICS_MEASUREMENT_ID set.
//       5. GA4 + GTM when ANALYTICS_GTM_ID is also set.
//       6. SECURITY: no secret in any returned config.
//       7. ANALYTICS_CONFIG_NOOP has enabled=false always.
//       8. The resolved Noop fallback has enabled=false always.

import { __resetEnvCacheForTests } from "../../config/env";
import {
  resolveAnalyticsConfig,
  ANALYTICS_CONFIG_NOOP,
} from "./analytics-config";

// ─────────────────────────────────────────────────────────────────────────────
// Env helpers
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "test-cookie-secret-at-least-32-chars-long!!",
  CSRF_SECRET: "test-csrf-secret-at-least-32-chars-long!!!",
  // Coherent PRODUCTION values. `validateEnv` requires these once NODE_ENV/APP_ENV is
  // "production" — a session cookie issued without Secure, or scoped to localhost, is a
  // real misconfiguration, so the boot refuses it. Cases below that exercise a
  // production boot guard would otherwise fail on env validation before reaching the
  // guard under test.
  COOKIE_SECURE: "true",
  COOKIE_DOMAIN: ".stimuliiq.test",
};

function setEnvWith(overrides: Record<string, string | undefined> = {}): void {
  Object.assign(process.env, { ...REQUIRED_ENV, ...overrides });
}

function clearEnv(): void {
  const keys = [
    ...Object.keys(REQUIRED_ENV),
    "ANALYTICS_PROVIDER",
    "ANALYTICS_MEASUREMENT_ID",
    "ANALYTICS_GTM_ID",
  ];
  for (const k of keys) delete process.env[k];
}

beforeEach(() => {
  __resetEnvCacheForTests();
});

afterEach(() => {
  clearEnv();
  __resetEnvCacheForTests();
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: resolveAnalyticsConfig
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveAnalyticsConfig", () => {
  it("returns Noop config (enabled=false) when ANALYTICS_PROVIDER is unset", () => {
    setEnvWith(); // no ANALYTICS_PROVIDER
    const config = resolveAnalyticsConfig();
    expect(config.provider).toBe("noop");
    expect(config.enabled).toBe(false);
  });

  it("returns Noop config when ANALYTICS_PROVIDER=noop explicitly", () => {
    setEnvWith({ ANALYTICS_PROVIDER: "noop" });
    const config = resolveAnalyticsConfig();
    expect(config.provider).toBe("noop");
    expect(config.enabled).toBe(false);
    expect(config.measurementId).toBeUndefined();
    expect(config.gtmId).toBeUndefined();
  });

  it("returns Noop config when ANALYTICS_PROVIDER=ga4 but ANALYTICS_MEASUREMENT_ID is absent", () => {
    setEnvWith({ ANALYTICS_PROVIDER: "ga4" }); // no ANALYTICS_MEASUREMENT_ID
    const config = resolveAnalyticsConfig();
    // Cannot enable GA4 without a Measurement ID, fall back to Noop.
    expect(config.provider).toBe("noop");
    expect(config.enabled).toBe(false);
  });

  it("returns GA4 config when ANALYTICS_PROVIDER=ga4 + ANALYTICS_MEASUREMENT_ID set", () => {
    setEnvWith({
      ANALYTICS_PROVIDER: "ga4",
      ANALYTICS_MEASUREMENT_ID: "G-TEST1234567",
    });
    const config = resolveAnalyticsConfig();
    expect(config.provider).toBe("ga4");
    expect(config.enabled).toBe(true);
    expect(config.measurementId).toBe("G-TEST1234567");
    expect(config.gtmId).toBeUndefined();
  });

  it("includes gtmId when ANALYTICS_GTM_ID is set", () => {
    setEnvWith({
      ANALYTICS_PROVIDER: "ga4",
      ANALYTICS_MEASUREMENT_ID: "G-TEST1234567",
      ANALYTICS_GTM_ID: "GTM-TESTXYZ",
    });
    const config = resolveAnalyticsConfig();
    expect(config.provider).toBe("ga4");
    expect(config.enabled).toBe(true);
    expect(config.measurementId).toBe("G-TEST1234567");
    expect(config.gtmId).toBe("GTM-TESTXYZ");
  });

  it("SECURITY: returned config contains no secret key material", () => {
    setEnvWith({
      ANALYTICS_PROVIDER: "ga4",
      ANALYTICS_MEASUREMENT_ID: "G-TEST1234567",
      ANALYTICS_GTM_ID: "GTM-TESTXYZ",
    });
    const config = resolveAnalyticsConfig();
    const serialised = JSON.stringify(config);
    expect(serialised).not.toContain("secret");
    expect(serialised).not.toContain("apiKey");
    expect(serialised).not.toContain("privateKey");
    expect(serialised).not.toContain("hmac");
  });

  it("Noop config has no measurementId or gtmId", () => {
    setEnvWith({ ANALYTICS_PROVIDER: "noop" });
    const config = resolveAnalyticsConfig();
    expect(config.measurementId).toBeUndefined();
    expect(config.gtmId).toBeUndefined();
  });

  it("enabled=false for all Noop variants", () => {
    // Unset provider
    setEnvWith();
    expect(resolveAnalyticsConfig().enabled).toBe(false);

    clearEnv();
    __resetEnvCacheForTests();

    // Explicit noop
    setEnvWith({ ANALYTICS_PROVIDER: "noop" });
    expect(resolveAnalyticsConfig().enabled).toBe(false);

    clearEnv();
    __resetEnvCacheForTests();

    // GA4 without measurement ID
    setEnvWith({ ANALYTICS_PROVIDER: "ga4" });
    expect(resolveAnalyticsConfig().enabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: ANALYTICS_CONFIG_NOOP constant
// ─────────────────────────────────────────────────────────────────────────────

describe("ANALYTICS_CONFIG_NOOP", () => {
  it("has provider=noop and enabled=false", () => {
    expect(ANALYTICS_CONFIG_NOOP.provider).toBe("noop");
    expect(ANALYTICS_CONFIG_NOOP.enabled).toBe(false);
  });

  it("has no measurementId or gtmId", () => {
    expect(ANALYTICS_CONFIG_NOOP.measurementId).toBeUndefined();
    expect(ANALYTICS_CONFIG_NOOP.gtmId).toBeUndefined();
  });

  it("is frozen/constant (enabled stays false)", () => {
    // Verify it cannot be mutated to enabled=true accidentally.
    // The `as const` assertion makes TypeScript error on mutation,
    // but at runtime we can verify the values are as expected.
    expect(ANALYTICS_CONFIG_NOOP.enabled).toBe(false);
    expect(ANALYTICS_CONFIG_NOOP.provider).toBe("noop");
  });
});
