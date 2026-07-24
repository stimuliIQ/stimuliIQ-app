"use client";

/**
 * useCaptchaToken — reusable hook for managing a Turnstile captcha token.
 *
 * Provides:
 *   - `token`       — the current captcha token (undefined = not yet solved)
 *   - `setToken`    — passed to TurnstileWidget's onToken prop
 *   - `resetToken`  — called when the challenge expires or on error
 *   - `hasToken`    — true when a valid token is available
 *
 * Usage:
 *   const { token, setToken, resetToken, hasToken } = useCaptchaToken();
 *
 *   <TurnstileWidget
 *     onToken={setToken}
 *     onExpire={resetToken}
 *     onError={resetToken}
 *   />
 *
 *   // Prevent submit if no token
 *   const canSubmit = hasToken && !isSubmitting;
 *
 *   // Include in DTO
 *   captchaToken: token ?? "noop"  // "noop" is accepted by the Noop provider (dev only)
 */

import { useState, useCallback } from "react";

export interface CaptchaTokenState {
  /** Current captcha token. undefined = not yet solved. */
  token: string | undefined;
  /** Pass to TurnstileWidget.onToken */
  setToken: (token: string) => void;
  /** Call on expiry or error to clear the current token */
  resetToken: () => void;
  /** True when a token is available */
  hasToken: boolean;
}

export function useCaptchaToken(): CaptchaTokenState {
  const [token, setTokenState] = useState<string | undefined>(undefined);

  const setToken = useCallback((t: string) => {
    setTokenState(t);
  }, []);

  const resetToken = useCallback(() => {
    setTokenState(undefined);
  }, []);

  return {
    token,
    setToken,
    resetToken,
    hasToken: token !== undefined && token.length > 0,
  };
}
