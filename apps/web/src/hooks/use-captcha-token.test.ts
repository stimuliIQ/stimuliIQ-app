/**
 * Tests for useCaptchaToken hook.
 *
 * Covers:
 *   - Initial state: token = undefined, hasToken = false
 *   - setToken sets the token and hasToken = true
 *   - resetToken clears token and hasToken = false
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCaptchaToken } from "./use-captcha-token";

describe("useCaptchaToken", () => {
  it("starts with no token", () => {
    const { result } = renderHook(() => useCaptchaToken());
    expect(result.current.token).toBeUndefined();
    expect(result.current.hasToken).toBe(false);
  });

  it("setToken stores the token and sets hasToken to true", () => {
    const { result } = renderHook(() => useCaptchaToken());
    act(() => {
      result.current.setToken("test-turnstile-token-abc");
    });
    expect(result.current.token).toBe("test-turnstile-token-abc");
    expect(result.current.hasToken).toBe(true);
  });

  it("resetToken clears the token", () => {
    const { result } = renderHook(() => useCaptchaToken());
    act(() => {
      result.current.setToken("some-token");
    });
    expect(result.current.hasToken).toBe(true);
    act(() => {
      result.current.resetToken();
    });
    expect(result.current.token).toBeUndefined();
    expect(result.current.hasToken).toBe(false);
  });

  it("noop dev token ('noop') is considered a valid token", () => {
    const { result } = renderHook(() => useCaptchaToken());
    act(() => {
      result.current.setToken("noop");
    });
    expect(result.current.hasToken).toBe(true);
  });
});
