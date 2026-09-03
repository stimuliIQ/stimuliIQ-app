// apps/api/src/modules/notifications/providers/sms/sms-extension-p6.spec.ts
//
// Unit tests for the REAL Msg91SmsProvider (docs/plans/phase-9-completion.md T16 / B3).
// Originally covered the Phase-6 STUB `sendSms()` extension; rewritten for the real
// MSG91 HTTP-backed implementation (msg91-sms.provider.ts). Network calls are mocked
// via `global.fetch`, no live MSG91 account/credentials are used or required.
//
// ACs covered:
//   AC-76 , No secret (MSG91_AUTH_KEY) or OTP code in ANY log line or returned object.
//   AC-78 , sendSms is parameterized with dltTemplateId (Rule C-3 passthrough).
//   T16   , real HTTP call behind SmsProvider; no OTP plaintext logging; fails properly
//            (throws for sendSms / returns delivered:false for sendOtp) when creds are
//            missing, rather than silently no-op.

import { Logger as NestLogger } from "@nestjs/common";
import { Msg91SmsProvider } from "../../../auth/providers/sms/msg91-sms.provider";
import { __resetEnvCacheForTests } from "../../../../config/env";

const BASE_ENV = {
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

const MSG91_KEYS = {
  MSG91_AUTH_KEY: "test-auth-key-never-logged",
  MSG91_SENDER: "STMLIQ",
  MSG91_TEMPLATE_ID: "1207162000000001234",
};

function withEnv(extra: Record<string, string | undefined>): () => void {
  const previous = { ...process.env };
  for (const k of Object.keys(MSG91_KEYS)) delete process.env[k];
  Object.assign(process.env, BASE_ENV, extra);
  __resetEnvCacheForTests();
  return () => {
    process.env = previous;
    __resetEnvCacheForTests();
  };
}

describe("Msg91SmsProvider (real MSG91 HTTP adapter, T16/B3)", () => {
  let provider: Msg91SmsProvider;
  let restoreEnv: () => void;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    provider = new Msg91SmsProvider();
    // Capture every Logger call so we can assert secrets/OTP codes never appear.
    logSpy = jest.spyOn(NestLogger.prototype, "log").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(NestLogger.prototype, "error").mockImplementation(() => undefined);
    debugSpy = jest.spyOn(NestLogger.prototype, "debug").mockImplementation(() => undefined);
    warnSpy = jest.spyOn(NestLogger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (restoreEnv) restoreEnv();
    jest.restoreAllMocks();
  });

  function allLoggedText(): string {
    const calls = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...debugSpy.mock.calls, ...warnSpy.mock.calls];
    return calls.map((c) => c.join(" ")).join("\n");
  }

  // ─── sendSms() ────────────────────────────────────────────────────────────

  describe("sendSms", () => {
    it("THROWS when MSG91_AUTH_KEY/MSG91_SENDER are not configured (fail properly, not silent no-op)", async () => {
      restoreEnv = withEnv({});
      await expect(
        provider.sendSms({ phone: "+919876543210", body: "Test message", dltTemplateId: "d1" }),
      ).rejects.toThrow(/MSG91_AUTH_KEY\/MSG91_SENDER not configured/);
    });

    it("THROWS when dltTemplateId is missing (Rule C-3 defence-in-depth)", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      await expect(
        // @ts-expect-error, intentionally omitting a required field to test the guard
        provider.sendSms({ phone: "+919876543210", body: "Test message" }),
      ).rejects.toThrow(/dltTemplateId is required/);
    });

    it("makes a real HTTP call and returns providerMessageId + delivered=true on success", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      const fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue({ ok: true, text: async () => "298345234523452345" } as Response);

      const result = await provider.sendSms({
        phone: "+919876543210",
        body: "Your assignment has been graded. Score: 95%",
        dltTemplateId: "1207162000000001234",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("sendhttp.php");
      expect(calledUrl).toContain("DLT_TE_ID=1207162000000001234");
      expect(calledUrl).toContain("mobiles=919876543210");

      expect(result.providerMessageId).toBe("298345234523452345");
      expect(result.delivered).toBe(true);
    });

    it("THROWS when MSG91 returns a non-OK HTTP status", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 500, text: async () => "" } as Response);

      await expect(
        provider.sendSms({ phone: "+919876543210", body: "Test", dltTemplateId: "d1" }),
      ).rejects.toThrow(/HTTP 500/);
    });

    it("THROWS when MSG91's response body indicates an error", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue({ ok: true, text: async () => "Invalid mobile number" } as Response);

      await expect(
        provider.sendSms({ phone: "+919876543210", body: "Test", dltTemplateId: "d1" }),
      ).rejects.toThrow(/rejected/i);
    });

    it("THROWS on a network error (fetch rejects)", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNRESET"));

      await expect(
        provider.sendSms({ phone: "+919876543210", body: "Test", dltTemplateId: "d1" }),
      ).rejects.toThrow(/Network error/);
    });

    it("AC-76: no log line ever contains MSG91_AUTH_KEY", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, text: async () => "12345" } as Response);

      await provider.sendSms({
        phone: "+919876543210",
        body: "Your score is 99%, private content",
        dltTemplateId: "d1",
      });

      const logged = allLoggedText();
      expect(logged).not.toContain(MSG91_KEYS.MSG91_AUTH_KEY);
    });

    it("AC-76: the returned result never contains the message body or MSG91_AUTH_KEY", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, text: async () => "12345" } as Response);

      const result = await provider.sendSms({
        phone: "+919876543210",
        body: "Your score is 99%, private content",
        dltTemplateId: "d1",
      });

      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain("99%");
      expect(serialised).not.toContain("private content");
      expect(serialised).not.toContain(MSG91_KEYS.MSG91_AUTH_KEY);
    });
  });

  // ─── sendOtp() ────────────────────────────────────────────────────────────

  describe("sendOtp", () => {
    it("returns delivered:false (never throws) when MSG91 keys are not configured", async () => {
      restoreEnv = withEnv({});
      const result = await provider.sendOtp({ phone: "+919876543210", code: "123456" });
      expect(result).toEqual({ delivered: false });
    });

    it("makes a real HTTP call and returns delivered:true on success", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      const fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue({ ok: true, json: async () => ({ type: "success", message: "OTP sent" }) } as Response);

      const result = await provider.sendOtp({ phone: "+919876543210", code: "654321" });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("otp=654321"); // our own code passed to MSG91's override param
      expect(result.delivered).toBe(true);
    });

    it("returns delivered:false when MSG91 rejects the OTP send", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue({ ok: true, json: async () => ({ type: "error", message: "invalid mobile" }) } as Response);

      const result = await provider.sendOtp({ phone: "+919876543210", code: "654321" });
      expect(result.delivered).toBe(false);
    });

    it("returns delivered:false on a network error (never throws)", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      jest.spyOn(global, "fetch").mockRejectedValue(new Error("ETIMEDOUT"));

      const result = await provider.sendOtp({ phone: "+919876543210", code: "654321" });
      expect(result.delivered).toBe(false);
    });

    it("AC-76/T16: the OTP code NEVER appears in any log line", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ type: "success" }) } as Response);

      await provider.sendOtp({ phone: "+919876543210", code: "999888" });

      const logged = allLoggedText();
      expect(logged).not.toContain("999888");
    });

    it("T16: the OTP code NEVER appears in any log line even when MSG91 rejects the send", async () => {
      restoreEnv = withEnv(MSG91_KEYS);
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue({ ok: true, json: async () => ({ type: "error", message: "bad request" }) } as Response);

      await provider.sendOtp({ phone: "+919876543210", code: "777666" });

      const logged = allLoggedText();
      expect(logged).not.toContain("777666");
    });

    it("T16: the phone number is masked in log output, never logged in full", async () => {
      restoreEnv = withEnv({});
      await provider.sendOtp({ phone: "+919876543210", code: "123456" });

      const logged = allLoggedText();
      expect(logged).not.toContain("9876543210");
      expect(logged).toContain("***");
    });
  });

  // ─── Interface conformance ────────────────────────────────────────────────

  it("Msg91SmsProvider implements SmsProvider.sendSms/sendOtp (methods exist)", () => {
    expect(typeof provider.sendSms).toBe("function");
    expect(typeof provider.sendOtp).toBe("function");
  });
});
