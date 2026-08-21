// apps/api/src/modules/captcha/providers/captcha/replay-tolerant-captcha.provider.spec.ts
//
// Unit tests for ReplayTolerantCaptchaProvider, the decorator that lets ONE solved
// Turnstile challenge cover the two captcha-gated calls a file-bearing public form makes
// (upload-url, then submit). See that file's header for the production defect it fixes.

import { ReplayTolerantCaptchaProvider } from "./replay-tolerant-captcha.provider";
import type { CaptchaProvider, CaptchaVerifyResult } from "./captcha-provider.interface";
import type { RedisService } from "../../../../redis/redis.service";

/** Minimal in-memory stand-in for the two ioredis calls this provider makes. */
function fakeRedis(): { service: RedisService; store: Map<string, string>; failing: boolean } {
  const store = new Map<string, string>();
  const state = { failing: false };
  const service = {
    client: {
      get: jest.fn(async (k: string) => {
        if (state.failing) throw new Error("redis down");
        return store.get(k) ?? null;
      }),
      set: jest.fn(async (k: string, v: string) => {
        if (state.failing) throw new Error("redis down");
        store.set(k, v);
        return "OK";
      }),
    },
  } as unknown as RedisService;
  return {
    service,
    store,
    get failing() {
      return state.failing;
    },
    set failing(v: boolean) {
      state.failing = v;
    },
  } as { service: RedisService; store: Map<string, string>; failing: boolean };
}

function innerProvider(results: CaptchaVerifyResult[]): CaptchaProvider & { verify: jest.Mock } {
  const verify = jest.fn(async () => results.shift() ?? { success: false, errorCodes: ["exhausted"] });
  return { verify } as unknown as CaptchaProvider & { verify: jest.Mock };
}

describe("ReplayTolerantCaptchaProvider", () => {
  const IP = "203.0.113.7";

  it("verifies upstream on first use and passes the result through", async () => {
    const redis = fakeRedis();
    const inner = innerProvider([{ success: true }]);
    const provider = new ReplayTolerantCaptchaProvider(inner, redis.service);

    await expect(provider.verify("tok-1", IP)).resolves.toEqual({ success: true });
    expect(inner.verify).toHaveBeenCalledTimes(1);
  });

  it("THE FIX: the same token from the same IP passes again WITHOUT a second upstream call", async () => {
    const redis = fakeRedis();
    // Only ONE success is queued, a second upstream call would return the
    // exhausted failure, exactly as Cloudflare answers `timeout-or-duplicate`.
    const inner = innerProvider([{ success: true }]);
    const provider = new ReplayTolerantCaptchaProvider(inner, redis.service);

    await provider.verify("tok-1", IP); // upload-url
    await expect(provider.verify("tok-1", IP)).resolves.toEqual({ success: true }); // submit
    expect(inner.verify).toHaveBeenCalledTimes(1);
  });

  it("never remembers a FAILED verification, a rejected token cannot become a pass", async () => {
    const redis = fakeRedis();
    const inner = innerProvider([
      { success: false, errorCodes: ["invalid-input-response"] },
      { success: false, errorCodes: ["invalid-input-response"] },
    ]);
    const provider = new ReplayTolerantCaptchaProvider(inner, redis.service);

    await expect(provider.verify("bad", IP)).resolves.toMatchObject({ success: false });
    await expect(provider.verify("bad", IP)).resolves.toMatchObject({ success: false });
    expect(inner.verify).toHaveBeenCalledTimes(2);
    expect(redis.store.size).toBe(0);
  });

  it("does NOT honour the memo for a different IP, a farmed token is worthless elsewhere", async () => {
    const redis = fakeRedis();
    const inner = innerProvider([{ success: true }, { success: false, errorCodes: ["timeout-or-duplicate"] }]);
    const provider = new ReplayTolerantCaptchaProvider(inner, redis.service);

    await provider.verify("tok-1", IP);
    // Same token, attacker's IP -> falls through to Cloudflare, which rejects it.
    await expect(provider.verify("tok-1", "198.51.100.99")).resolves.toMatchObject({ success: false });
    expect(inner.verify).toHaveBeenCalledTimes(2);
  });

  it("stores only the token's HASH, never the token itself", async () => {
    const redis = fakeRedis();
    const provider = new ReplayTolerantCaptchaProvider(innerProvider([{ success: true }]), redis.service);

    await provider.verify("super-secret-token", IP);
    const keys = [...redis.store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("super-secret-token");
    expect(keys[0]).toMatch(/^captcha:verified:[0-9a-f]{64}$/);
  });

  it("an empty token is always sent upstream, one solve must not cover token-less requests", async () => {
    const redis = fakeRedis();
    const inner = innerProvider([{ success: false, errorCodes: ["missing-input-response"] }]);
    const provider = new ReplayTolerantCaptchaProvider(inner, redis.service);

    await expect(provider.verify("", IP)).resolves.toMatchObject({ success: false });
    expect(inner.verify).toHaveBeenCalledWith("", IP);
    expect(redis.store.size).toBe(0);
  });

  it("FAILS OPEN on a Redis read error, falls through to the real verify, never rejects on its own", async () => {
    const redis = fakeRedis();
    redis.failing = true;
    const inner = innerProvider([{ success: true }]);
    const provider = new ReplayTolerantCaptchaProvider(inner, redis.service);

    await expect(provider.verify("tok-1", IP)).resolves.toEqual({ success: true });
    expect(inner.verify).toHaveBeenCalledTimes(1);
  });
});
