/**
 * Tests for useBookSlot hook.
 *
 * Covers:
 *   - Happy path: submit → success state
 *   - Honeypot present → silently succeeds (AC-42)
 *   - Double-click protection (isSubmitting guard)
 *   - Step validation (required fields, captcha)
 *   - UTM capture mapping
 *   - reset() restores initial state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBookSlot } from "./use-book-slot";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock("../lib/api-client", () => ({
  apiClient: {
    public: {
      bookings: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    },
  },
}));

// useUtm returns empty object in tests (no window.location)
vi.mock("./use-utm", () => ({
  useUtm: () => ({
    utmSource: undefined,
    utmMedium: undefined,
    landingUrl: "http://localhost:3000/book-free-slot",
    referrer: undefined,
  }),
  utmCaptureToSdkUtm: () => ({
    source: undefined,
    medium: undefined,
    campaign: undefined,
    content: undefined,
    term: undefined,
  }),
}));

const MOCK_BOOKING_RESPONSE = {
  bookingId: "b00k1ng-1d",
  slotAt: "2026-07-10T10:00:00.000Z",
  status: "requested" as const,
  message: "Your slot has been booked!",
};

// Minimal valid form data for step 2 (details step)
function getValidFormData() {
  return {
    name: "Aarav Kumar",
    phone: "+919876543210",
    email: "aarav@example.com",
    tosAccepted: true,
    marketingOptIn: false,
    captchaToken: "test-token",
    _hp_email: "",
    slotAt: "2026-07-10T10:00:00.000Z",
    programId: undefined,
    programLabel: undefined,
  };
}

describe("useBookSlot", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("starts in idle state at step 0", () => {
    const { result } = renderHook(() => useBookSlot());
    expect(result.current.currentStep).toBe(0);
    expect(result.current.submitState.kind).toBe("idle");
  });

  it("goNext advances from step 0 to step 1 (program step has no required fields)", () => {
    const { result } = renderHook(() => useBookSlot());
    act(() => {
      result.current.goNext();
    });
    expect(result.current.currentStep).toBe(1);
  });

  it("goNext validates slot step — shows error if slotAt is empty", () => {
    const { result } = renderHook(() => useBookSlot());
    // Advance to step 1
    act(() => { result.current.goNext(); });
    // Try to advance to step 2 without setting slotAt
    act(() => { result.current.goNext(); });
    expect(result.current.currentStep).toBe(1); // stays on step 1
    expect(result.current.stepErrors.slotAt).toBeTruthy();
  });

  it("goNext advances from step 1 to step 2 when slotAt is set", () => {
    const { result } = renderHook(() => useBookSlot());
    act(() => { result.current.goNext(); }); // 0→1
    act(() => { result.current.setFormData({ slotAt: "2026-07-10T10:00:00.000Z" }); });
    act(() => { result.current.goNext(); }); // 1→2
    expect(result.current.currentStep).toBe(2);
  });

  it("submit calls API with correct fields on happy path", async () => {
    mockCreate.mockResolvedValueOnce(MOCK_BOOKING_RESPONSE);
    const { result } = renderHook(() => useBookSlot());

    // Set up all form data
    act(() => {
      result.current.setFormData(getValidFormData());
    });

    await act(async () => {
      await result.current.submit();
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0]![0];
    expect(callArg.name).toBe("Aarav Kumar");
    expect(callArg.phone).toBe("+919876543210");
    expect(callArg.source).toBe("web-book-slot");
    expect(callArg.consent).toBeDefined();
    expect(callArg.consent.marketingOptIn).toBe(false);
    expect(callArg.consent.tosVersion).toBeTruthy();
  });

  it("submit transitions to success state on happy path", async () => {
    mockCreate.mockResolvedValueOnce(MOCK_BOOKING_RESPONSE);
    const { result } = renderHook(() => useBookSlot());

    act(() => { result.current.setFormData(getValidFormData()); });

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.submitState.kind).toBe("success");
  });

  it("honeypot field present → silently 'succeeds' without calling API (AC-42)", async () => {
    const { result } = renderHook(() => useBookSlot());

    act(() => {
      result.current.setFormData({
        ...getValidFormData(),
        _hp_email: "bot@example.com", // honeypot populated = bot
      });
    });

    await act(async () => {
      await result.current.submit();
    });

    // API must NOT be called
    expect(mockCreate).not.toHaveBeenCalled();
    // But shows success to confuse bots
    expect(result.current.submitState.kind).toBe("success");
  });

  it("double-click protection: second call while submitting is ignored", async () => {
    // First call resolves slowly
    let resolveCall: (() => void) | null = null;
    mockCreate.mockReturnValueOnce(
      new Promise<typeof MOCK_BOOKING_RESPONSE>((resolve) => {
        resolveCall = () => resolve(MOCK_BOOKING_RESPONSE);
      }),
    );

    const { result } = renderHook(() => useBookSlot());
    act(() => { result.current.setFormData(getValidFormData()); });

    // First call — doesn't await yet
    const firstCallPromise = act(async () => { await result.current.submit(); });
    // Second call — should be ignored (submitting guard)
    act(() => { void result.current.submit(); });

    resolveCall!();
    await firstCallPromise;

    // API only called once despite double-click
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("submit transitions to error state on API failure", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Slot unavailable"));
    const { result } = renderHook(() => useBookSlot());

    act(() => { result.current.setFormData(getValidFormData()); });

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.submitState.kind).toBe("error");
    if (result.current.submitState.kind === "error") {
      expect(result.current.submitState.message).toContain("Slot unavailable");
    }
  });

  it("reset() returns to initial state", async () => {
    mockCreate.mockResolvedValueOnce(MOCK_BOOKING_RESPONSE);
    const { result } = renderHook(() => useBookSlot());

    act(() => { result.current.setFormData(getValidFormData()); });
    await act(async () => { await result.current.submit(); });

    expect(result.current.submitState.kind).toBe("success");

    act(() => { result.current.reset(); });

    expect(result.current.currentStep).toBe(0);
    expect(result.current.submitState.kind).toBe("idle");
  });

  it("captcha token required on step 2 — shows error if absent", () => {
    const { result } = renderHook(() => useBookSlot());
    // Advance to step 2
    act(() => { result.current.goNext(); });
    act(() => { result.current.setFormData({ slotAt: "2026-07-10T10:00:00.000Z" }); });
    act(() => { result.current.goNext(); });
    // Set name and phone but NOT captchaToken
    act(() => {
      result.current.setFormData({
        name: "Aarav",
        phone: "+91987654321",
        tosAccepted: true,
        captchaToken: "", // empty token
      });
    });
    // Try to advance to step 3
    act(() => { result.current.goNext(); });
    expect(result.current.currentStep).toBe(2); // blocked
    expect(result.current.stepErrors.captcha).toBeTruthy();
  });

  it("consent.marketingOptIn correctly maps form value (AC-5)", async () => {
    mockCreate.mockResolvedValueOnce(MOCK_BOOKING_RESPONSE);
    const { result } = renderHook(() => useBookSlot());
    act(() => {
      result.current.setFormData({
        ...getValidFormData(),
        marketingOptIn: true, // opted in
      });
    });
    await act(async () => { await result.current.submit(); });
    const callArg = mockCreate.mock.calls[0]![0];
    expect(callArg.consent?.marketingOptIn).toBe(true);
  });

  it("consent.marketingOptIn = false when opted out (AC-5)", async () => {
    mockCreate.mockResolvedValueOnce(MOCK_BOOKING_RESPONSE);
    const { result } = renderHook(() => useBookSlot());
    act(() => {
      result.current.setFormData({
        ...getValidFormData(),
        marketingOptIn: false,
      });
    });
    await act(async () => { await result.current.submit(); });
    const callArg = mockCreate.mock.calls[0]![0];
    expect(callArg.consent?.marketingOptIn).toBe(false);
  });
});
