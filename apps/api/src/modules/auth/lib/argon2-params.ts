// apps/api/src/modules/auth/lib/argon2-params.ts
//
// Pinned argon2id cost parameters (Phase-7 Wave 2 security hardening batch A, item 5 —
// closes the P0 followups item: "argon2id cost parameters are not pinned/versioned").
// Explicit constants instead of relying on the `argon2` package's built-in defaults, so a
// future library upgrade that silently changes its defaults cannot silently weaken (or
// change) password-hashing cost without an explicit, reviewed change here.
//
// CURRENT PARAMS (node-argon2 v0.31's own current defaults — comfortably above OWASP's
// 2024 Password Storage Cheat Sheet MINIMUM baseline for argon2id, m=19456 KiB/t=2/p=1):
//   type:        argon2id  — the ONLY variant OWASP recommends for password hashing
//                            (hybrid: resists both GPU/ASIC cracking AND side-channel
//                            timing attacks, unlike pure argon2i or argon2d).
//   memoryCost:  65536 KiB (64 MiB)
//   timeCost:    3 iterations
//   parallelism: 4 threads
//
// UPGRADE PATH: argon2's output hash STRING embeds its own parameters
// (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`) — `argon2.verify()` ALWAYS re-derives
// using the parameters encoded in the STORED hash, never these constants. Raising these
// constants in a future reviewed PR only changes the cost of NEWLY created hashes; every
// existing stored hash remains verifiable exactly as before (no forced mass rehash, no
// locked-out accounts, no migration needed).
//
// Consumed by:
//   - public-funnel.service.ts (student self-registration — argon2.hash())
//   - auth.service.ts (login enumeration-resistance dummy-hash timing pad — see
//     DUMMY_PASSWORD_HASH below)

import * as argon2 from "argon2";

export const ARGON2_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * A FIXED, precomputed argon2id hash of a well-known, NON-SECRET placeholder password,
 * hashed with the exact `ARGON2_HASH_OPTIONS` above. This is NOT a credential for any
 * real account — it exists purely so `argon2.verify()` can be called against a
 * structurally valid hash (and therefore perform a REAL, full-cost verification that
 * always returns false) when no real user/passwordHash was found, so the response
 * timing for "no such account" is statistically indistinguishable from "wrong password
 * for a real account" (closes P0 followups M-5, login/OTP enumeration via response
 * timing — see auth.service.ts#login).
 *
 * Regenerate with (only if ARGON2_HASH_OPTIONS above ever changes):
 *   node -e "require('argon2').hash('dummy-password-for-timing-padding-only-not-a-real-credential', <ARGON2_HASH_OPTIONS>).then(console.log)"
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$ZrDSFCgRFRF4SluSIfzM+Q$mTji1EKXYxNMFlOQ18eN+plSahSPfgcVGWxVGg3mIq4";
