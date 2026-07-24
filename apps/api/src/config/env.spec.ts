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
