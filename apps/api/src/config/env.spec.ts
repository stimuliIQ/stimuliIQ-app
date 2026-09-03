import { validateEnv, isProductionEnv, missingEnvVars, __resetEnvCacheForTests } from "./env";

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stimuliiq",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
};

describe("validateEnv", () => {
  beforeEach(() => {
    __resetEnvCacheForTests();
  });

  it("parses a valid minimal environment with sane defaults", () => {
    const env = validateEnv({ ...REQUIRED_ENV } as NodeJS.ProcessEnv);

    expect(env.API_PORT).toBe(4000);
    expect(env.JWT_ACCESS_TTL).toBe("15m");
    expect(env.SENTRY_DSN).toBeUndefined();

    // Phase-7 Wave 2 security hardening batch A: new vars all have safe defaults so
    // no existing deployment/test config needs to change.
    expect(env.JWT_AUDIENCE).toBe("stimuliiq-clients");
    expect(env.AUTH_IP_RATE_LIMIT_WINDOW_SECONDS).toBe(60);
    expect(env.AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS).toBe(20);
    expect(env.WEBHOOK_IP_RATE_LIMIT_WINDOW_SECONDS).toBe(60);
    expect(env.WEBHOOK_IP_RATE_LIMIT_MAX_ATTEMPTS).toBe(300);
    expect(env.WEBHOOK_SIGNATURE_MAX_AGE_SECONDS).toBe(300);

    // T5/R2: campaign send batch cap defaults to 500.
    expect(env.CAMPAIGN_SEND_BATCH_SIZE).toBe(500);
  });

  it("throws (fails fast) when a required variable is missing", () => {
    const { DATABASE_URL: _omit, ...incomplete } = REQUIRED_ENV;
    expect(() => validateEnv(incomplete as NodeJS.ProcessEnv)).toThrow();
  });

  // Everything below defaults to a value that is right for a laptop and wrong for a
  // server. A production deployment that simply forgets one of them used to boot green.
  describe("production-only refinements", () => {
    const PROD_SECRETS = {
      TWO_FACTOR_ENC_KEY: "c".repeat(64),
      CERT_SIGNING_SECRET: "d".repeat(64),
      NOTIFICATION_SIGNING_SECRET: "e".repeat(64),
    };
    const PROD_BASE = {
      ...REQUIRED_ENV,
      ...PROD_SECRETS,
      NODE_ENV: "production",
      COOKIE_SECURE: "true",
      COOKIE_DOMAIN: ".stimuliiq.com",
    };

    it("accepts a complete production environment", () => {
      expect(() => validateEnv({ ...PROD_BASE } as NodeJS.ProcessEnv)).not.toThrow();
    });

    it("refuses production with COOKIE_SECURE off — session cookies would go over plain HTTP", () => {
      expect(() =>
        validateEnv({ ...PROD_BASE, COOKIE_SECURE: "false" } as NodeJS.ProcessEnv),
      ).toThrow(/Invalid environment configuration/);
    });

    it("refuses production with COOKIE_DOMAIN left at the localhost default", () => {
      expect(() =>
        validateEnv({ ...PROD_BASE, COOKIE_DOMAIN: "localhost" } as NodeJS.ProcessEnv),
      ).toThrow(/Invalid environment configuration/);
    });

    // A CDN can only read a bucket that allows anonymous reads, and object storage grants
    // that per bucket. One bucket + a CDN = submissions, PII exports, invoices, receipts
    // and resumes are all world-readable by key.
    it("refuses a CDN base URL over cloud storage with no separate public bucket", () => {
      expect(() =>
        validateEnv({
          ...PROD_BASE,
          STORAGE_PROVIDER: "r2",
          STORAGE_BUCKET: "stimuliiq-private",
          PUBLIC_ASSET_BASE_URL: "https://cdn.stimuliiq.com",
        } as NodeJS.ProcessEnv),
      ).toThrow(/Invalid environment configuration/);
    });

    it("accepts the same configuration once the public bucket is split out", () => {
      expect(() =>
        validateEnv({
          ...PROD_BASE,
          STORAGE_PROVIDER: "r2",
          STORAGE_BUCKET: "stimuliiq-private",
          STORAGE_PUBLIC_BUCKET: "stimuliiq-public",
          PUBLIC_ASSET_BASE_URL: "https://cdn.stimuliiq.com",
        } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });

    it("leaves the local-storage dev setup alone — no cloud bucket to split", () => {
      expect(() =>
        validateEnv({
          ...PROD_BASE,
          STORAGE_PROVIDER: "local",
          PUBLIC_ASSET_BASE_URL: "http://localhost:4000/api/v1/assets",
        } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });

    it("applies none of this outside production", () => {
      expect(() =>
        validateEnv({
          ...REQUIRED_ENV,
          NODE_ENV: "development",
          APP_ENV: "local",
          STORAGE_PROVIDER: "r2",
          PUBLIC_ASSET_BASE_URL: "https://cdn.stimuliiq.com",
        } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });
  });
});

describe("isProductionEnv", () => {
  beforeEach(() => __resetEnvCacheForTests());

  it("is true when NODE_ENV=production", () => {
    expect(isProductionEnv({ NODE_ENV: "production", APP_ENV: "local" } as never)).toBe(true);
  });

  it("is true when APP_ENV=production (even if NODE_ENV is not)", () => {
    expect(isProductionEnv({ NODE_ENV: "development", APP_ENV: "production" } as never)).toBe(true);
  });

  it("is false for local/dev/staging", () => {
    expect(isProductionEnv({ NODE_ENV: "development", APP_ENV: "local" } as never)).toBe(false);
    expect(isProductionEnv({ NODE_ENV: "test", APP_ENV: "staging" } as never)).toBe(false);
  });
});

describe("missingEnvVars", () => {
  it("returns names whose value is undefined, null or empty", () => {
    expect(
      missingEnvVars({ A: "set", B: undefined, C: null, D: "", E: "also-set" }),
    ).toEqual(["B", "C", "D"]);
  });

  it("returns [] when everything is set", () => {
    expect(missingEnvVars({ A: "x", B: "y" })).toEqual([]);
  });
});
