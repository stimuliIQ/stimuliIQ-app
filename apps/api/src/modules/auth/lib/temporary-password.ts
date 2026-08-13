// apps/api/src/modules/auth/lib/temporary-password.ts
//
// One generator for every temporary credential we email (student LMS provisioning, staff
// account creation, credential re-send).
//
// It validates its own output against `PasswordSchema` — the SAME schema the login route
// validates the submitted password with — because the two drifting apart is not a
// hypothetical. A bare `randomBytes(12).toString("base64url")` draws 16 characters from a
// 64-symbol alphabet, and about 6.6% of those draws contain no digit at all. The password
// policy requires one. So roughly one in fifteen provisioned users received a password the
// login form refused to even submit: the credential was correct in the database and the
// request never reached the hash comparison. It reads to the user as "the credentials you
// sent me don't work", which is exactly how it was reported.
//
// Deriving the check from the schema rather than restating the rules here means a future
// change to the policy cannot silently start minting unusable passwords again.

import { randomBytes } from "node:crypto";
import { PasswordSchema } from "@repo/types";

/** Bounded so a policy that no draw can satisfy fails loudly instead of spinning forever. */
const MAX_ATTEMPTS = 32;

/**
 * A readable, reasonably strong one-time password: 16 url-safe base64 chars from 12 random
 * bytes, guaranteed to satisfy the login password policy. Never persisted in plaintext (only
 * its argon2 hash) and rotated on first login. Not a long-lived credential, so
 * human-friendliness (no ambiguous separators) matters more than maximal entropy here.
 */
export function generateTemporaryPassword(): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = randomBytes(12).toString("base64url");
    if (PasswordSchema.safeParse(candidate).success) return candidate;
  }

  // Unreachable for the current policy (a rejected draw is ~6.6% likely, so this needs 32
  // consecutive misses). Reachable only if the policy gains a rule this alphabet cannot meet
  // — in which case failing here beats emailing a password nobody can use.
  throw new Error(
    "Could not generate a temporary password satisfying the password policy — the policy and " +
      "the generator's alphabet are incompatible.",
  );
}
