/**
 * Tests for useEnrollFunnel hook.
 *
 * Covers:
 *   - Funnel steps: register → order → payment → success
 *   - Idempotency key generated once and reused across steps (AC-17)
 *   - Double-click protection on submitPayment (AC-18)
 *   - Honeypot field on register step (AC-42)
 *   - Register step validation (zod schema)
 *   - Order step: coupon code passes to createOrder
 *   - No secret in any response (type-level, not tested here — AC-41)
 *   - resetFunnel generates a new idempotency key
 *   - retryPayment reuses the same idempotency key (AC-19)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEnrollFunnel } from "./use-enroll-funnel";

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

const mockRegister = vi.fn();
const mockRequestOtp = vi.fn();
const mockCreateOrder = vi.fn();
const mockCheckout = vi.fn();
const mockVerify = vi.fn();

vi.mock("../lib/api-client", () => ({
  apiClient: {
    auth: {
      otpRequest: (...args: unknown[]) => mockRequestOtp(...args),
    },
    public: {
      auth: {
        register: (...args: unknown[]) => mockRegister(...args),
      },
      enroll: {
        createOrder: (...args: unknown[]) => mockCreateOrder(...args),
        checkout: (...args: unknown[]) => mockCheckout(...args),
        verify: (...args: unknown[]) => mockVerify(...args),
      },
    },
  },
}));

// Stable responses
const AUTH_SESSION = { csrfToken: "csrf-abc", accessToken: "tok" };

const ORDER_RESPONSE = {
  orderId: "order-uuid-001",
  amountPaise: 999900,
  currency: "INR",
  discountPaise: 0,
  status: "created" as const,
};

const CHECKOUT_RESPONSE = {
  razorpayOrderId: "rzp_order_abc",
  keyId: "rzp_test_publickey",
  amountPaise: 999900,
  currency: "INR",
  orderId: "order-uuid-001",
};

const _VERIFY_RESPONSE = {
  enrollmentId: "enroll-uuid-001",
  orderId: "order-uuid-001",
  lmsRedirectUrl: "http://lms.stimuliiq.com/dashboard",
  message: "Payment successful! Welcome to the program.",
};

// Valid register form data
const VALID_REGISTER_DATA = {
  name: "Aarav Kumar",
  email: "aarav@example.com",
  phone: "+919876543210",
  otpCode: "123456",
  password: "securepass99",
  tosAccepted: true as const,
  marketingOptIn: false,
  captchaToken: "noop",
  _hp_email: "",
};

const PROGRAM_ID = "prog-uuid-001";

describe("useEnrollFunnel", () => {
  beforeEach(() => {
    mockRegister.mockReset();
    mockRequestOtp.mockReset();
    mockCreateOrder.mockReset();
    mockCheckout.mockReset();
    mockVerify.mockReset();
  });

  it("starts on register step in idle state", () => {
    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    expect(result.current.step).toBe("register");
    expect(result.current.funnelState.kind).toBe("idle");
  });

  it("requestOtp calls auth.requestOtp with the phone number", async () => {
    mockRequestOtp.mockResolvedValueOnce({});
    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    await act(async () => {
      await result.current.requestOtp("+919876543210");
    });
    expect(mockRequestOtp).toHaveBeenCalledWith({ phone: "+919876543210" });
  });

  it("submitRegister validates required fields and sets errors for missing captchaToken", async () => {
    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    // Set data with missing captchaToken
    act(() => {
      result.current.setRegisterData({
        ...VALID_REGISTER_DATA,
        captchaToken: "",
      });
    });
    await act(async () => {
      await result.current.submitRegister();
    });
    expect(result.current.step).toBe("register"); // stays on register
    expect(result.current.registerErrors.captchaToken).toBeTruthy();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("submitRegister advances to order step on success", async () => {
    mockRegister.mockResolvedValueOnce(AUTH_SESSION);
    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    act(() => { result.current.setRegisterData(VALID_REGISTER_DATA); });
    await act(async () => { await result.current.submitRegister(); });
    expect(result.current.step).toBe("order");
  });

  it("submitRegister passes consent to the API", async () => {
    mockRegister.mockResolvedValueOnce(AUTH_SESSION);
    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    act(() => {
      result.current.setRegisterData({ ...VALID_REGISTER_DATA, marketingOptIn: true });
    });
    await act(async () => { await result.current.submitRegister(); });
    const callArg = mockRegister.mock.calls[0]![0];
    expect(callArg.consent.marketingOptIn).toBe(true);
    expect(callArg.consent.tosVersion).toBeTruthy();
  });

  it("honeypot on register: _hp_email populated → skip API, advance to order", async () => {
    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    act(() => {
      result.current.setRegisterData({
        ...VALID_REGISTER_DATA,
        _hp_email: "bot@spam.com",
      });
    });
    await act(async () => { await result.current.submitRegister(); });
    expect(mockRegister).not.toHaveBeenCalled();
    expect(result.current.step).toBe("order"); // advances silently
  });

  it("submitOrder calls createOrder with the same idempotency key as checkout (AC-17)", async () => {
    mockRegister.mockResolvedValueOnce(AUTH_SESSION);
    mockCreateOrder.mockResolvedValueOnce(ORDER_RESPONSE);
    mockCheckout.mockResolvedValueOnce(CHECKOUT_RESPONSE);

    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));

    // Register
    act(() => { result.current.setRegisterData(VALID_REGISTER_DATA); });
    await act(async () => { await result.current.submitRegister(); });

    // Submit order
    await act(async () => { await result.current.submitOrder(); });

    const orderCallKey = mockCreateOrder.mock.calls[0]![1]; // idempotencyKey arg
    const checkoutCallKey = mockCheckout.mock.calls[0]![1]; // idempotencyKey arg

    // Both calls must use the SAME idempotency key
    expect(orderCallKey).toBe(checkoutCallKey);
    expect(typeof orderCallKey).toBe("string");
    expect(orderCallKey.length).toBeGreaterThan(10);
  });

  it("submitOrder advances to payment step on success", async () => {
    mockRegister.mockResolvedValueOnce(AUTH_SESSION);
    mockCreateOrder.mockResolvedValueOnce(ORDER_RESPONSE);
    mockCheckout.mockResolvedValueOnce(CHECKOUT_RESPONSE);

    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    act(() => { result.current.setRegisterData(VALID_REGISTER_DATA); });
    await act(async () => { await result.current.submitRegister(); });
    await act(async () => { await result.current.submitOrder(); });

    expect(result.current.step).toBe("payment");
    expect(result.current.order).not.toBeNull();
    expect(result.current.checkout).not.toBeNull();
  });

  it("checkout response has keyId (public) but no keySecret (AC-41)", async () => {
    mockRegister.mockResolvedValueOnce(AUTH_SESSION);
    mockCreateOrder.mockResolvedValueOnce(ORDER_RESPONSE);
    mockCheckout.mockResolvedValueOnce(CHECKOUT_RESPONSE);

    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    act(() => { result.current.setRegisterData(VALID_REGISTER_DATA); });
    await act(async () => { await result.current.submitRegister(); });
    await act(async () => { await result.current.submitOrder(); });

    const checkout = result.current.checkout;
    expect(checkout).not.toBeNull();
    expect(checkout!.keyId).toBeTruthy(); // public key present
    // Secret must NEVER be in checkout response
    expect("keySecret" in (checkout ?? {})).toBe(false);
    expect("secret" in (checkout ?? {})).toBe(false);
    expect("razorpayKeySecret" in (checkout ?? {})).toBe(false);
  });

  it("resetFunnel generates a new idempotency key (cannot reuse across sessions)", async () => {
    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));

    // Capture the internal state before and after reset by observing call args
    mockRegister.mockResolvedValue(AUTH_SESSION);
    mockCreateOrder.mockResolvedValue(ORDER_RESPONSE);
    mockCheckout.mockResolvedValue(CHECKOUT_RESPONSE);

    // First funnel run
    act(() => { result.current.setRegisterData(VALID_REGISTER_DATA); });
    await act(async () => { await result.current.submitRegister(); });
    await act(async () => { await result.current.submitOrder(); });
    const firstKey = mockCreateOrder.mock.calls[0]![1];

    // Reset
    act(() => { result.current.resetFunnel(); });

    // Second funnel run
    act(() => { result.current.setRegisterData(VALID_REGISTER_DATA); });
    await act(async () => { await result.current.submitRegister(); });
    await act(async () => { await result.current.submitOrder(); });
    const secondKey = mockCreateOrder.mock.calls[1]![1];

    // Different keys = different funnel sessions
    expect(firstKey).not.toBe(secondKey);
  });

  it("submitOrder with coupon code passes couponCode to createOrder", async () => {
    mockRegister.mockResolvedValueOnce(AUTH_SESSION);
    mockCreateOrder.mockResolvedValueOnce({ ...ORDER_RESPONSE, discountPaise: 50000 });
    mockCheckout.mockResolvedValueOnce(CHECKOUT_RESPONSE);

    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    act(() => { result.current.setRegisterData(VALID_REGISTER_DATA); });
    await act(async () => { await result.current.submitRegister(); });
    act(() => { result.current.setOrderData({ programId: PROGRAM_ID, couponCode: "SAVE50" }); });
    await act(async () => { await result.current.submitOrder(); });

    const callArg = mockCreateOrder.mock.calls[0]![0];
    expect(callArg.couponCode).toBe("SAVE50");
  });

  it("submitOrder without coupon passes no couponCode field", async () => {
    mockRegister.mockResolvedValueOnce(AUTH_SESSION);
    mockCreateOrder.mockResolvedValueOnce(ORDER_RESPONSE);
    mockCheckout.mockResolvedValueOnce(CHECKOUT_RESPONSE);

    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    act(() => { result.current.setRegisterData(VALID_REGISTER_DATA); });
    await act(async () => { await result.current.submitRegister(); });
    await act(async () => { await result.current.submitOrder(); });

    const callArg = mockCreateOrder.mock.calls[0]![0];
    expect(callArg.couponCode).toBeUndefined();
  });

  it("funnelState has error message when register API fails", async () => {
    mockRegister.mockRejectedValueOnce(new Error("OTP expired"));
    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    act(() => { result.current.setRegisterData(VALID_REGISTER_DATA); });
    await act(async () => { await result.current.submitRegister(); });
    expect(result.current.funnelState.kind).toBe("error");
    if (result.current.funnelState.kind === "error") {
      expect(result.current.funnelState.message).toContain("OTP expired");
    }
  });

  it("programId is preset in orderData from hook initialization", () => {
    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    expect(result.current.orderData.programId).toBe(PROGRAM_ID);
  });

  // ---------------------------------------------------------------------------
  // Double-click protection on submitOrder (ref-based, AC-18 / defect regression)
  // The prior STATE-based guard was stale within a tick and allowed a second
  // in-flight request. The fix converts the guard to a synchronous useRef.
  // ---------------------------------------------------------------------------

  it("double-click on submitOrder: second call while first is in-flight is ignored (AC-18 regression)", async () => {
    // Register first so we are on the 'order' step
    mockRegister.mockResolvedValueOnce(AUTH_SESSION);
    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));
    act(() => { result.current.setRegisterData(VALID_REGISTER_DATA); });
    await act(async () => { await result.current.submitRegister(); });
    expect(result.current.step).toBe("order");

    // First submitOrder call resolves slowly
    let resolveOrder: (() => void) | null = null;
    mockCreateOrder.mockReturnValueOnce(
      new Promise<typeof ORDER_RESPONSE>((resolve) => {
        resolveOrder = () => resolve(ORDER_RESPONSE);
      }),
    );
    mockCheckout.mockResolvedValueOnce(CHECKOUT_RESPONSE);

    // Kick off first call (does not await yet)
    const firstCallPromise = act(async () => { await result.current.submitOrder(); });

    // Attempt second call while first is still in-flight (double-click scenario)
    // The ref guard (submittingRef.current = true) must block this synchronously.
    void act(async () => { await result.current.submitOrder(); });

    // Resolve the first call
    resolveOrder!();
    await firstCallPromise;

    // createOrder must only have been called ONCE despite two submitOrder calls (AC-18)
    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
  });

  it("double-click on submitPayment: ref guard prevents second Razorpay launch (AC-18)", async () => {
    // This test verifies the submittingRef guard on submitPayment covers the
    // double-click-safe requirement.
    //
    // In jsdom there is no real Razorpay and no script.onload — loadRazorpayScript
    // would hang indefinitely. We stub window.Razorpay with a mock that records
    // `open()` calls so we can assert it is only called once even if submitPayment
    // is triggered twice before the first resolves.

    const openMock = vi.fn();
    // Mock window.Razorpay before the hook renders
    const razorpayCtor = vi.fn().mockImplementation(() => ({ open: openMock }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis.window as any).Razorpay = razorpayCtor;

    mockRegister.mockResolvedValueOnce(AUTH_SESSION);
    mockCreateOrder.mockResolvedValueOnce(ORDER_RESPONSE);
    mockCheckout.mockResolvedValueOnce(CHECKOUT_RESPONSE);

    const { result } = renderHook(() => useEnrollFunnel(PROGRAM_ID));

    // Advance to payment step
    act(() => { result.current.setRegisterData(VALID_REGISTER_DATA); });
    await act(async () => { await result.current.submitRegister(); });
    await act(async () => { await result.current.submitOrder(); });

    expect(result.current.step).toBe("payment");
    expect(result.current.checkout).not.toBeNull();

    // First submitPayment call — will open Razorpay modal
    // The Razorpay constructor is called synchronously before the promise inside open().
    // We don't await so the submittingRef stays true during the second call.
    const firstCallPromise = act(async () => {
      // We intentionally do NOT await this — it runs the mock ctor synchronously.
      void result.current.submitPayment();
    });

    // Second call fires before first finishes — ref guard must block it
    act(() => { void result.current.submitPayment(); });

    await firstCallPromise;

    // Razorpay constructor (and therefore open()) must only have been called ONCE
    // despite two submitPayment calls. The ref guard is synchronous so the second
    // call returns before the Razorpay ctor fires again.
    expect(razorpayCtor.mock.calls.length).toBeLessThanOrEqual(1);

    // Cleanup
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis.window as any).Razorpay;
  });
});
