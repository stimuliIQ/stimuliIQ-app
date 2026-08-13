// apps/api/test/unit-setup-env.ts
//
// Jest `setupFiles` hook: seeds the three signing/encryption secrets that `config/env.ts`
// requires whenever NODE_ENV or APP_ENV is "production".
//
// Plenty of specs flip the env to production to exercise some unrelated production
// behaviour — the mail/sms/video/live-class/payment provider factories, Sentry, OTel, the
// metrics guard. Without these defaults, every one of them fails env validation on secrets
// that have nothing to do with what the spec is testing, and the failure message points at
// the env layer rather than the assertion that actually matters. Restating three unrelated
// secrets in fifteen spec files would be the alternative, and it would rot.
//
// These are DEFAULTS, not overrides: a spec that needs a secret absent (see
// two-factor-crypto.spec.ts, which asserts the fail-closed throw) deletes it explicitly and
// still gets the behaviour it asserts. Values are obvious non-secrets — they only have to
// clear the >= 32-character floor.

const UNIT_TEST_SECRET_DEFAULTS: Record<string, string> = {
  TWO_FACTOR_ENC_KEY: "unit-test-two-factor-enc-key-0123456789abcdef",
  CERT_SIGNING_SECRET: "unit-test-cert-signing-secret-0123456789abcdef",
  NOTIFICATION_SIGNING_SECRET: "unit-test-notification-signing-secret-0123456789",
};

for (const [key, value] of Object.entries(UNIT_TEST_SECRET_DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}
