// apps/api/src/modules/auth/lib/access-token-revocation.spec.ts
//
// The property under test: revoking a user's sessions must also stop the ACCESS token
// that is already in somebody's hands. Before this store existed, `revokedAt` on the
// `sessions` rows only governed refresh — a stolen access token kept working for the rest
// of its 15 minutes after the password reset meant to kill it.

import { AccessTokenRevocationStore } from "./access-token-revocation";
import type { RedisService } from "../../../redis/redis.service";

function makeStore(client: Partial<Record<"get" | "set", jest.Mock>>): {
  store: AccessTokenRevocationStore;
  get: jest.Mock;
  set: jest.Mock;
} {
  const get = (client.get ?? jest.fn().mockResolvedValue(null)) as jest.Mock;
  const set = (client.set ?? jest.fn().mockResolvedValue("OK")) as jest.Mock;
  const store = new AccessTokenRevocationStore({ client: { get, set } } as unknown as RedisService);
  return { store, get, set };
}

describe("AccessTokenRevocationStore", () => {
  describe("revokeAllBefore", () => {
    it("stamps the epoch in WHOLE SECONDS, so a token minted in the same second is caught", async () => {
      const { store, set } = makeStore({});
      // 1_700_000_000.999s — a millisecond value here would compare against a truncated
      // `iat` of 1_700_000_000 and let that token through.
      await store.revokeAllBefore("user-1", new Date(1_700_000_000_999));

      expect(set).toHaveBeenCalledWith("auth:revoked-before:user-1", "1700000000", "EX", expect.any(Number));
    });

    it("never throws when Redis is down — a password reset must not 500 over this", async () => {
      const { store } = makeStore({ set: jest.fn().mockRejectedValue(new Error("redis down")) });
      await expect(store.revokeAllBefore("user-1")).resolves.toBeUndefined();
    });
  });

  describe("isRevoked", () => {
    it("is false when nothing has been revoked for the user", async () => {
      const { store } = makeStore({ get: jest.fn().mockResolvedValue(null) });
      expect(await store.isRevoked("user-1", 1_700_000_500)).toBe(false);
    });

    it("refuses a token issued BEFORE the revocation", async () => {
      const { store } = makeStore({ get: jest.fn().mockResolvedValue("1700000000") });
      expect(await store.isRevoked("user-1", 1_699_999_999)).toBe(true);
    });

    // The comparison is STRICT. `iat` is whole seconds, and the very next thing after a
    // password change is the client signing back in — that replacement token is minted in
    // the same second as the revocation, and refusing it would bounce the user straight
    // back to the login screen they just came from. The attacker's token was minted
    // earlier and still fails (the case above).
    it("allows a token issued IN the same second — that is the replacement session", async () => {
      const { store } = makeStore({ get: jest.fn().mockResolvedValue("1700000000") });
      expect(await store.isRevoked("user-1", 1_700_000_000)).toBe(false);
    });

    it("allows a token issued after it — the new session from signing back in", async () => {
      const { store } = makeStore({ get: jest.fn().mockResolvedValue("1700000000") });
      expect(await store.isRevoked("user-1", 1_700_000_001)).toBe(false);
    });

    it("refuses a token with no iat at all — it cannot prove it is current", async () => {
      const { store } = makeStore({ get: jest.fn().mockResolvedValue("1700000000") });
      expect(await store.isRevoked("user-1", undefined)).toBe(true);
    });

    it("ignores a corrupt value rather than locking the user out", async () => {
      const { store } = makeStore({ get: jest.fn().mockResolvedValue("not-a-number") });
      expect(await store.isRevoked("user-1", 1_700_000_000)).toBe(false);
    });

    // FAIL OPEN, deliberately, and unlike the rate limiters. There "closed" refuses one
    // request; here it would sign out every user in the product over a Redis blip, to
    // narrow a window that is at most one access-token lifetime — and the behaviour
    // without this store is no check at all, so a Redis outage degrades to exactly the
    // previous behaviour rather than to an outage of its own.
    it("allows the request when Redis is unreachable", async () => {
      const { store } = makeStore({ get: jest.fn().mockRejectedValue(new Error("redis down")) });
      expect(await store.isRevoked("user-1", 1_700_000_000)).toBe(false);
    });
  });
});
