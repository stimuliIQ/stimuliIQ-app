// apps/api/src/modules/auth/lib/argon2-params.spec.ts
//
// Unit tests for the pinned argon2id cost parameters (Phase-7 Wave 2 security hardening
// batch A, item 5 — closes P0 followups "argon2id cost parameters are not pinned").

import * as argon2 from "argon2";
import { ARGON2_HASH_OPTIONS, DUMMY_PASSWORD_HASH } from "./argon2-params";

describe("ARGON2_HASH_OPTIONS", () => {
  it("pins the argon2id variant (the only OWASP-recommended variant for password hashing)", () => {
    expect(ARGON2_HASH_OPTIONS.type).toBe(argon2.argon2id);
  });

  it("pins explicit memory/time/parallelism costs (not left to library defaults)", () => {
    expect(ARGON2_HASH_OPTIONS.memoryCost).toBe(65536);
    expect(ARGON2_HASH_OPTIONS.timeCost).toBe(3);
    expect(ARGON2_HASH_OPTIONS.parallelism).toBe(4);
  });

  it("a hash produced with these options round-trips through argon2.verify()", async () => {
    const hash = await argon2.hash("some-real-password", ARGON2_HASH_OPTIONS);

    expect(hash.startsWith("$argon2id$")).toBe(true);
    await expect(argon2.verify(hash, "some-real-password")).resolves.toBe(true);
    await expect(argon2.verify(hash, "wrong-password")).resolves.toBe(false);
  });

  it("a future param change does NOT invalidate a hash created under the OLD params — verify() reads params embedded in the stored hash string, never these constants", async () => {
    // Simulates "upgrading" ARGON2_HASH_OPTIONS in a future PR: a hash created with
    // DIFFERENT (lower-cost) params must still verify correctly, proving no forced
    // rehash / no locked-out accounts on a cost upgrade.
    const oldParams = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
    const legacyHash = await argon2.hash("legacy-password", oldParams);

    await expect(argon2.verify(legacyHash, "legacy-password")).resolves.toBe(true);
  });
});

describe("DUMMY_PASSWORD_HASH", () => {
  it("is a structurally valid argon2id hash using the pinned params", () => {
    expect(DUMMY_PASSWORD_HASH.startsWith("$argon2id$")).toBe(true);
    expect(DUMMY_PASSWORD_HASH).toContain("m=65536,t=3,p=4");
  });

  it("verifies true for its own known (non-secret) placeholder password", async () => {
    await expect(
      argon2.verify(DUMMY_PASSWORD_HASH, "dummy-password-for-timing-padding-only-not-a-real-credential"),
    ).resolves.toBe(true);
  });

  it("verifies false for any real login attempt (never accidentally accepts a guess)", async () => {
    await expect(argon2.verify(DUMMY_PASSWORD_HASH, "password123")).resolves.toBe(false);
    await expect(argon2.verify(DUMMY_PASSWORD_HASH, "")).resolves.toBe(false);
  });
});
