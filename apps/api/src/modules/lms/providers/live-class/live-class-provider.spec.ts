// apps/api/src/modules/lms/providers/live-class/live-class-provider.spec.ts
//
// Unit tests for the LiveClassProvider adapters + the module's fail-closed boot guard
// (docs/plans/phase-9-completion.md T15). Mirrors video-provider.spec.ts /
// payment-provider.module.spec.ts's test strategy:
//   - All tests are UNIT, no live network calls, no real Zoom/Google credentials.
//   - node:crypto HMAC is real (verifies actual signature correctness).
//   - The module-level fail-closed guard is driven through NestJS compilation exactly
//     as boot does.

import { Test } from "@nestjs/testing";
import { createHmac } from "node:crypto";
import { NoopLiveClassProvider, DEFAULT_NOOP_LIVE_CLASS_WEBHOOK_SECRET } from "./noop-live-class.provider";
import {
  buildZoomUrlValidationResponse,
  timingSafeEqualHexZoom,
  ZoomLiveClassProvider,
} from "./zoom-live-class.provider";
import { LiveClassProviderModule } from "./live-class-provider.module";
import { LIVE_CLASS_PROVIDER } from "./live-class-provider.interface";
import { __resetEnvCacheForTests } from "../../../../config/env";

const BASE_ENV = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stimuliiq",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
};

const ZOOM_KEYS = {
  ZOOM_ACCOUNT_ID: "acct_test",
  ZOOM_CLIENT_ID: "client_test",
  ZOOM_CLIENT_SECRET: "secret_test",
  ZOOM_WEBHOOK_SECRET_TOKEN: "webhook_secret_test",
};

const GOOGLE_KEYS = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "sa@example.iam.gserviceaccount.com",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "fake-pem-not-used-in-this-test",
  GOOGLE_MEET_IMPERSONATE_USER_EMAIL: "faculty@example.com",
};

async function bootWith(env: Record<string, string | undefined>): Promise<void> {
  const previous = { ...process.env };
  for (const k of [...Object.keys(ZOOM_KEYS), ...Object.keys(GOOGLE_KEYS)]) delete process.env[k];
  Object.assign(process.env, BASE_ENV, env);
  __resetEnvCacheForTests();
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [LiveClassProviderModule],
    }).compile();
    moduleRef.get(LIVE_CLASS_PROVIDER);
    await moduleRef.close();
  } finally {
    process.env = previous;
    __resetEnvCacheForTests();
  }
}

describe("NoopLiveClassProvider", () => {
  let provider: NoopLiveClassProvider;

  beforeEach(() => {
    provider = new NoopLiveClassProvider();
  });

  it("createMeeting returns a deterministic fake meeting", async () => {
    const result = await provider.createMeeting({
      topic: "Test Session",
      startTime: new Date(),
      durationMinutes: 60,
      hostUserId: "host-1",
    });
    expect(result.provider).toBe("noop");
    expect(result.providerMeetingId).toMatch(/^noop-meeting-/);
    expect(result.hostJoinUrl).toContain("host-1");
  });

  it("getJoinUrl returns a URL scoped to userId + role", async () => {
    const result = await provider.getJoinUrl({
      providerMeetingId: "noop-meeting-1",
      userId: "student-1",
      userName: "Student One",
      role: "attendee",
    });
    expect(result.url).toContain("student-1");
    expect(result.url).toContain("role=attendee");
  });

  it("endMeeting resolves without throwing", async () => {
    await expect(provider.endMeeting({ providerMeetingId: "noop-meeting-1" })).resolves.toBeUndefined();
  });

  it("verifyWebhookSignature: accepts a correctly-signed payload", () => {
    const rawBody = JSON.stringify({ noop: true, type: "meeting_started" });
    const sig = NoopLiveClassProvider.makeWebhookSignature(rawBody);
    expect(provider.verifyWebhookSignature({ rawBody, signatureHeader: sig })).toBe(true);
  });

  it("verifyWebhookSignature: rejects an incorrect signature", () => {
    const rawBody = JSON.stringify({ noop: true, type: "meeting_started" });
    expect(provider.verifyWebhookSignature({ rawBody, signatureHeader: "deadbeef" })).toBe(false);
  });

  it("verifyWebhookSignature: FAILS CLOSED when secret is absent", () => {
    const absentSecretProvider = new NoopLiveClassProvider({ simulateWebhookSecretAbsent: true });
    const rawBody = JSON.stringify({ noop: true, type: "meeting_started" });
    const sig = NoopLiveClassProvider.makeWebhookSignature(rawBody, DEFAULT_NOOP_LIVE_CLASS_WEBHOOK_SECRET);
    expect(absentSecretProvider.verifyWebhookSignature({ rawBody, signatureHeader: sig })).toBe(false);
  });

  it("parseRecordingEvent: parses a participant_joined fixture", () => {
    const event = provider.parseRecordingEvent({
      noop: true,
      type: "participant_joined",
      providerMeetingId: "noop-meeting-1",
      participant: { email: "student@example.com", name: "Student One" },
    });
    expect(event).not.toBeNull();
    expect(event?.type).toBe("participant_joined");
    expect(event?.participant?.email).toBe("student@example.com");
  });

  it("parseRecordingEvent: returns null for a non-noop payload", () => {
    expect(provider.parseRecordingEvent({ event: "meeting.started" })).toBeNull();
  });
});

describe("ZoomLiveClassProvider webhook helpers", () => {
  let previousEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    previousEnv = { ...process.env };
    for (const k of Object.keys(ZOOM_KEYS)) delete process.env[k];
    Object.assign(process.env, BASE_ENV, ZOOM_KEYS);
    __resetEnvCacheForTests();
  });

  afterEach(() => {
    process.env = previousEnv;
    __resetEnvCacheForTests();
  });

  it("verifyWebhookSignature: accepts a correctly-signed Zoom-format payload", () => {
    const zoomProvider = new ZoomLiveClassProvider();
    const rawBody = JSON.stringify({ event: "meeting.started" });
    const timestamp = "1230811200";
    const message = `v0:${timestamp}:${rawBody}`;
    const expectedHex = createHmac("sha256", ZOOM_KEYS.ZOOM_WEBHOOK_SECRET_TOKEN).update(message).digest("hex");
    const signatureHeader = `v0=${expectedHex}`;

    expect(
      zoomProvider.verifyWebhookSignature({ rawBody, signatureHeader, timestampHeader: timestamp }),
    ).toBe(true);
  });

  it("verifyWebhookSignature: rejects when secret is not configured (fail closed)", () => {
    for (const k of Object.keys(ZOOM_KEYS)) delete process.env[k];
    Object.assign(process.env, BASE_ENV);
    __resetEnvCacheForTests();

    const zoomProvider = new ZoomLiveClassProvider();
    expect(
      zoomProvider.verifyWebhookSignature({
        rawBody: "{}",
        signatureHeader: "v0=whatever",
        timestampHeader: "123",
      }),
    ).toBe(false);
  });

  it("verifyWebhookSignature: rejects when timestampHeader is missing (fail closed)", () => {
    const zoomProvider = new ZoomLiveClassProvider();
    expect(zoomProvider.verifyWebhookSignature({ rawBody: "{}", signatureHeader: "v0=whatever" })).toBe(false);
  });

  it("buildZoomUrlValidationResponse computes the expected HMAC challenge response", () => {
    const plainToken = "abc123plainToken";
    const secret = "wh-secret";
    const result = buildZoomUrlValidationResponse(plainToken, secret);
    expect(result.plainToken).toBe(plainToken);
    const expected = createHmac("sha256", secret).update(plainToken).digest("hex");
    expect(result.encryptedToken).toBe(expected);
  });

  it("parseRecordingEvent: normalises meeting.participant_joined", () => {
    const zoomProvider = new ZoomLiveClassProvider();
    const event = zoomProvider.parseRecordingEvent({
      event: "meeting.participant_joined",
      event_ts: 1700000000000,
      payload: {
        object: {
          id: 123456789,
          participant: { email: "student@example.com", user_name: "Student One", registrant_id: "reg-1" },
        },
      },
    });
    expect(event?.type).toBe("participant_joined");
    expect(event?.providerMeetingId).toBe("123456789");
    expect(event?.participant?.email).toBe("student@example.com");
  });

  it("parseRecordingEvent: returns null for unrecognised event types", () => {
    const zoomProvider = new ZoomLiveClassProvider();
    expect(zoomProvider.parseRecordingEvent({ event: "endpoint.url_validation", payload: { plainToken: "x" } })).toBeNull();
  });

  it("timingSafeEqualHexZoom: equal strings match, unequal do not", () => {
    expect(timingSafeEqualHexZoom("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualHexZoom("abcd", "abce")).toBe(false);
    expect(timingSafeEqualHexZoom("abc", "abcd")).toBe(false);
  });
});

describe("LiveClassProviderModule fail-closed guard", () => {
  it("boots outside production with LIVE_CLASS_PROVIDER unset (Noop)", async () => {
    await expect(bootWith({ NODE_ENV: "development", APP_ENV: "local" })).resolves.not.toThrow();
  });

  it("boots outside production with zoom keys present", async () => {
    await expect(
      bootWith({ NODE_ENV: "development", APP_ENV: "local", LIVE_CLASS_PROVIDER: "zoom", ...ZOOM_KEYS }),
    ).resolves.not.toThrow();
  });

  it("boots outside production with zoom selected but missing keys (falls back to Noop)", async () => {
    await expect(
      bootWith({ NODE_ENV: "development", APP_ENV: "local", LIVE_CLASS_PROVIDER: "zoom" }),
    ).resolves.not.toThrow();
  });

  it("THROWS in production when LIVE_CLASS_PROVIDER=noop", async () => {
    await expect(bootWith({ NODE_ENV: "production", LIVE_CLASS_PROVIDER: "noop" })).rejects.toThrow(
      /FAKE meetings/i,
    );
  });

  it("THROWS in production when LIVE_CLASS_PROVIDER is unset (defaults to noop)", async () => {
    await expect(bootWith({ NODE_ENV: "production" })).rejects.toThrow(/FAKE meetings/i);
  });

  it("BOOTS in production when LIVE_CLASS_PROVIDER=disabled (feature off, no Zoom/Meet needed)", async () => {
    await expect(
      bootWith({ NODE_ENV: "production", LIVE_CLASS_PROVIDER: "disabled" }),
    ).resolves.not.toThrow();
  });

  it("THROWS in production when zoom is selected but keys are missing", async () => {
    await expect(bootWith({ NODE_ENV: "production", LIVE_CLASS_PROVIDER: "zoom" })).rejects.toThrow(
      /required environment variables are not set/i,
    );
  });

  it("boots in production when zoom is selected with all keys present", async () => {
    await expect(
      bootWith({ NODE_ENV: "production", LIVE_CLASS_PROVIDER: "zoom", ...ZOOM_KEYS }),
    ).resolves.not.toThrow();
  });

  it("THROWS in production when google_meet is selected but keys are missing", async () => {
    await expect(bootWith({ NODE_ENV: "production", LIVE_CLASS_PROVIDER: "google_meet" })).rejects.toThrow(
      /required environment variables are not set/i,
    );
  });

  it("boots in production when google_meet is selected with all keys present", async () => {
    await expect(
      bootWith({ NODE_ENV: "production", LIVE_CLASS_PROVIDER: "google_meet", ...GOOGLE_KEYS }),
    ).resolves.not.toThrow();
  });

  it("THROWS in production for an unrecognised selector", async () => {
    await expect(
      bootWith({ NODE_ENV: "production", LIVE_CLASS_PROVIDER: "webex" as never }),
    ).rejects.toThrow();
  });
});
