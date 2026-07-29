"use client";

/**
 * TurnstileWidget — Cloudflare Turnstile captcha widget (no npm dep).
 *
 * Loads the official Turnstile script from:
 *   https://challenges.cloudflare.com/turnstile/v0/api.js
 * and renders the widget into a container div.
 *
 * Site key: NEXT_PUBLIC_TURNSTILE_SITE_KEY (public, safe for bundle).
 *
 * Dev/unset behaviour:
 *   If NEXT_PUBLIC_TURNSTILE_SITE_KEY is absent or empty, renders a "noop"
 *   placeholder div (no real widget) and immediately calls onToken("noop").
 *   The backend CaptchaProvider in noop mode accepts any token — so dev flows
 *   work end-to-end without a real Turnstile site key.
 *
 * Security notes (AC-41):
 *   - Only the PUBLIC site key (NEXT_PUBLIC_*) is used here.
 *   - The CAPTCHA_SECRET_KEY is NEVER present in this file or in the client bundle.
 *     The secret is used only by the backend CaptchaProvider to verify tokens.
 *   - The Turnstile script is loaded from the official CDN (no npm package).
 *
 * Usage:
 *   <TurnstileWidget onToken={(token) => setCaptchaToken(token)} />
 *
 *   Pass the received token as `captchaToken` in the form submission DTO.
 *   The backend verifies it via CaptchaProvider.verify(token, ip).
 *
 * a11y: The Turnstile iframe provides its own accessible challenge (WCAG 2.1 AA).
 *       The container div has role="presentation" so SR doesn't announce the container.
 *       In noop mode the dev placeholder is visually hidden and aria-hidden.
 */

import { useEffect, useRef, useId } from "react";

export interface TurnstileWidgetProps {
  /** Called with the challenge token once the visitor solves the challenge. */
  onToken: (token: string) => void;
  /**
   * Called when the token expires (the challenge needs to be solved again).
   * The caller should reset their captchaToken state.
   */
  onExpire?: () => void;
  /**
   * Called when the widget encounters an error (e.g. network issues).
   * The caller should prevent form submission.
   */
  onError?: () => void;
  /**
   * Turnstile `appearance` render option. "interaction-only" keeps the widget
   * invisible unless Cloudflare requires the visitor to interact — use this for
   * compact forms (newsletter, sticky bar) instead of wrapping the widget in
   * `display:none`, which prevents the challenge from ever running and leaves
   * the form with no token (server then fail-closes with invalid-input-response).
   */
  appearance?: "always" | "interaction-only";
  className?: string;
  "data-testid"?: string;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: Record<string, unknown>,
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js";

const SITE_KEY =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "")
    : "";

/**
 * Whether we're in noop/dev mode (no real site key configured).
 * In noop mode, the widget immediately fires onToken("noop").
 */
const IS_NOOP = !SITE_KEY || SITE_KEY.length === 0;

export function TurnstileWidget({
  onToken,
  onExpire,
  onError,
  appearance = "always",
  className,
  "data-testid": testId,
}: TurnstileWidgetProps): React.JSX.Element {
  const containerId = useId();
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const onExpireRef = useRef(onExpire);
  const onErrorRef = useRef(onError);

  // Keep callbacks fresh without re-triggering the effect
  onTokenRef.current = onToken;
  onExpireRef.current = onExpire;
  onErrorRef.current = onError;

  useEffect(() => {
    // Noop mode (dev / unset site key): fire a dummy token immediately.
    if (IS_NOOP) {
      onTokenRef.current("noop");
      return;
    }

    let scriptEl: HTMLScriptElement | null = null;
    let mounted = true;

    function renderWidget() {
      if (!mounted) return;
      const container = document.getElementById(containerId);
      if (!container || !window.turnstile) return;

      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: SITE_KEY,
        callback: (token: string) => {
          if (mounted) onTokenRef.current(token);
        },
        "expired-callback": () => {
          if (mounted) onExpireRef.current?.();
        },
        "error-callback": () => {
          if (mounted) onErrorRef.current?.();
        },
        theme: "light",
        size: "normal",
        appearance,
        // Tokens expire after ~5 min; auto re-run the (non-interactive) challenge
        // so a visitor who submits late still has a live token.
        "refresh-expired": "auto",
      });
    }

    // If turnstile is already loaded (e.g. script loaded by a previous widget instance)
    if (window.turnstile) {
      renderWidget();
    } else {
      // Load the script once; append to <head>
      const existingScript = document.querySelector<HTMLScriptElement>(
        `script[src^="${TURNSTILE_SCRIPT_SRC}"]`,
      );
      if (existingScript) {
        // Script already in DOM, wait for it to be ready
        const checkReady = () => {
          if (window.turnstile) {
            renderWidget();
          } else {
            setTimeout(checkReady, 50);
          }
        };
        checkReady();
      } else {
        scriptEl = document.createElement("script");
        // async + defer: non-blocking, doesn't delay page load
        scriptEl.src = `${TURNSTILE_SCRIPT_SRC}?render=explicit`;
        scriptEl.async = true;
        scriptEl.defer = true;
        scriptEl.onload = () => renderWidget();
        document.head.appendChild(scriptEl);
      }
    }

    return () => {
      mounted = false;
      // Remove widget when component unmounts to avoid stale callbacks
      if (window.turnstile && widgetIdRef.current != null) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore cleanup errors
        }
        widgetIdRef.current = null;
      }
    };
  }, [containerId, appearance]); // containerId is stable (useId is constant per instance)

  // Noop/dev mode — render a visually-hidden placeholder (no real widget)
  if (IS_NOOP) {
    return (
      <div
        aria-hidden="true"
        data-testid={testId ?? "turnstile-noop"}
        style={{ display: "none" }}
      />
    );
  }

  return (
    <div
      id={containerId}
      role="presentation"
      className={className}
      data-testid={testId ?? "turnstile-widget"}
    />
  );
}

TurnstileWidget.displayName = "TurnstileWidget";
