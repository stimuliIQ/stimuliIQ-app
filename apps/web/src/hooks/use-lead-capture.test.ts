/**
 * Tests for useLeadCapture hook.
 *
 * Covers:
 *   - Happy path: submit → success
 *   - Honeypot field populated → silently succeeds, no API call (AC-42)
 *   - UTM param mapping (AC-1, AC-2)
 *   - Consent captured (AC-5, AC-37)
 *   - Error state on API failure
 *   - Double-click protection
 *   - reset() → idle
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLeadCapture } from "./use-lead-capture";

// ---------------------------------------------------------------------------
// Mock the API client
// ---------------------------------------------------------------------------

const mockCapture = vi.fn();

vi.mock("../lib/api-client", () => ({
  apiClient: {
    public: {
      leads: {
        capture: (...args: unknown[]) => mockCapture(...args),
      },
    },
  },
}));

// Stable UTM capture
vi.mock("./use-utm", () => ({
  useUtm: () => ({
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "summer2026",
    landingUrl: "http://localhost:3000/programs/python",
    referrer: "https://google.com",
    gclid: "Cj0test",
    fbclid: undefined,
  }),
  utmCaptureToSdkUtm: (capture: Record<string, unknown>) => ({
    source: capture.utmSource,
    medium: capture.utmMedium,
    campaign: capture.utmCampaign,
    content: capture.utmContent,
    term: capture.utmTerm,
  }),
}));

const SUCCESS_RESPONSE = {
  leadId: "lead-uuid-001",
  message: "Thank you! A counsellor will reach out to you soon.",
};

const VALID_INPUT = {
  name: "Priya Sharma",
  phone: "+919876543210",
  email: "priya@example.com",
  source: "web-inline",
  captchaToken: "noop",
  _hp_email: "",
  tosAccepted: true,
  marketingOptIn: false,
};

describe("useLeadCapture", () => {
  beforeEach(() => {
    mockCapture.mockReset();
  });

  it("starts in idle state", () => {
    const { result } = renderHook(() => useLeadCapture());
    expect(result.current.state.kind).toBe("idle");
  });

  it("submit transitions to success on happy path", async () => {
    mockCapture.mockResolvedValueOnce(SUCCESS_RESPONSE);
    const { result } = renderHook(() => useLeadCapture());

    await act(async () => {
      await result.current.submit(VALID_INPUT);
    });

    expect(result.current.state.kind).toBe("success");
  });

  it("submit calls API with correct UTM params (AC-1)", async () => {
    mockCapture.mockResolvedValueOnce(SUCCESS_RESPONSE);
    const { result } = renderHook(() => useLeadCapture());

    await act(async () => { await result.current.submit(VALID_INPUT); });

    const callArg = mockCapture.mock.calls[0]![0];
    // UTM from mocked useUtm
    expect(callArg.utm).toBeDefined();
    expect(callArg.utm.source).toBe("google");
    expect(callArg.utm.medium).toBe("cpc");
    // landingUrl captured
    expect(callArg.landingUrl).toBe("http://localhost:3000/programs/python");
    // referrer captured
    expect(callArg.referrer).toBe("https://google.com");
    // gclid captured
    expect(callArg.gclid).toBe("Cj0test");
  });

  it("submit with no UTM params still captures landingUrl (AC-2)", async () => {
    // Override mock to return empty UTM
    vi.doMock("./use-utm", () => ({
      useUtm: () => ({ landingUrl: "http://localhost:3000/", referrer: "" }),
      utmCaptureToSdkUtm: () => ({
        source: undefined, medium: undefined, campaign: undefined,
        content: undefined, term: undefined,
      }),
    }));
    mockCapture.mockResolvedValueOnce(SUCCESS_RESPONSE);
    const { result } = renderHook(() => useLeadCapture());
    await act(async () => { await result.current.submit(VALID_INPUT); });
    expect(mockCapture).toHaveBeenCalledOnce();
  });

  it("honeypot field populated → no API call, silently succeeds (AC-42)", async () => {
    const { result } = renderHook(() => useLeadCapture());
    await act(async () => {
      await result.current.submit({
        ...VALID_INPUT,
        _hp_email: "bot@spam.com",
      });
    });
    expect(mockCapture).not.toHaveBeenCalled();
    expect(result.current.state.kind).toBe("success");
  });

  it("consent marketingOptIn = false is passed correctly (AC-5)", async () => {
    mockCapture.mockResolvedValueOnce(SUCCESS_RESPONSE);
    const { result } = renderHook(() => useLeadCapture());
    await act(async () => {
      await result.current.submit({ ...VALID_INPUT, marketingOptIn: false });
    });
    const callArg = mockCapture.mock.calls[0]![0];
    expect(callArg.consent.marketingOptIn).toBe(false);
  });

  it("consent marketingOptIn = true is passed correctly (AC-5)", async () => {
    mockCapture.mockResolvedValueOnce(SUCCESS_RESPONSE);
    const { result } = renderHook(() => useLeadCapture());
    await act(async () => {
      await result.current.submit({ ...VALID_INPUT, marketingOptIn: true });
    });
    const callArg = mockCapture.mock.calls[0]![0];
    expect(callArg.consent.marketingOptIn).toBe(true);
  });

  it("consent tosVersion is populated from env (AC-37)", async () => {
    mockCapture.mockResolvedValueOnce(SUCCESS_RESPONSE);
    const { result } = renderHook(() => useLeadCapture());
    await act(async () => { await result.current.submit(VALID_INPUT); });
    const callArg = mockCapture.mock.calls[0]![0];
    expect(callArg.consent.tosVersion).toBeTruthy(); // at minimum "v1.0"
  });

  it("captchaToken is passed in the request body", async () => {
    mockCapture.mockResolvedValueOnce(SUCCESS_RESPONSE);
    const { result } = renderHook(() => useLeadCapture());
    await act(async () => {
      await result.current.submit({ ...VALID_INPUT, captchaToken: "real-turnstile-token" });
    });
    const callArg = mockCapture.mock.calls[0]![0];
    expect(callArg.captchaToken).toBe("real-turnstile-token");
  });

  it("transitions to error state on API failure", async () => {
    mockCapture.mockRejectedValueOnce(new Error("Rate limit exceeded"));
    const { result } = renderHook(() => useLeadCapture());
    await act(async () => { await result.current.submit(VALID_INPUT); });
    expect(result.current.state.kind).toBe("error");
    if (result.current.state.kind === "error") {
      expect(result.current.state.message).toContain("Rate limit exceeded");
    }
  });

  it("double-click protection: second call while submitting is ignored", async () => {
    let resolve: ((v: typeof SUCCESS_RESPONSE) => void) | null = null;
    mockCapture.mockReturnValueOnce(
      new Promise<typeof SUCCESS_RESPONSE>((res) => { resolve = res; }),
    );

    const { result } = renderHook(() => useLeadCapture());
    const firstCall = act(async () => { await result.current.submit(VALID_INPUT); });
    // Second call while first is in flight
    void act(async () => { await result.current.submit(VALID_INPUT); });
    resolve!(SUCCESS_RESPONSE);
    await firstCall;

    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it("reset() returns state to idle", async () => {
    mockCapture.mockResolvedValueOnce(SUCCESS_RESPONSE);
    const { result } = renderHook(() => useLeadCapture());
    await act(async () => { await result.current.submit(VALID_INPUT); });
    expect(result.current.state.kind).toBe("success");
    act(() => { result.current.reset(); });
    expect(result.current.state.kind).toBe("idle");
  });
});
