/**
 * TurnstileWidget component tests.
 *
 * In the test environment, NEXT_PUBLIC_TURNSTILE_SITE_KEY is absent, so
 * TurnstileWidget renders in noop mode (immediately fires onToken("noop")).
 *
 * Covers:
 *   - Noop mode: renders a hidden placeholder, calls onToken immediately
 *   - No real Turnstile script loaded in noop mode (AC-41)
 *   - Honeypot field is NOT the Turnstile widget (separate concern)
 *   - No secret in the component (compile-time trivial, runtime: just tests widget)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TurnstileWidget } from "./turnstile-widget";

describe("TurnstileWidget", () => {
  it("renders in noop mode when site key is absent (test env)", () => {
    const onToken = vi.fn();
    render(<TurnstileWidget onToken={onToken} />);
    // Noop mode renders a hidden div with the default testid
    expect(screen.getByTestId("turnstile-noop")).toBeInTheDocument();
  });

  it("calls onToken('noop') immediately in noop mode", async () => {
    const onToken = vi.fn();
    render(<TurnstileWidget onToken={onToken} />);
    await waitFor(() => {
      expect(onToken).toHaveBeenCalledWith("noop");
    });
  });

  it("noop placeholder is aria-hidden (AC-42: honeypot separate, widget hidden)", () => {
    const onToken = vi.fn();
    render(<TurnstileWidget onToken={onToken} />);
    const el = screen.getByTestId("turnstile-noop");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("does NOT load external scripts in noop mode (AC-41: no script for dev)", () => {
    const onToken = vi.fn();
    render(<TurnstileWidget onToken={onToken} />);
    // In noop mode, no Turnstile script tag should be added to document
    const scripts = document.querySelectorAll(
      'script[src*="challenges.cloudflare.com/turnstile"]',
    );
    expect(scripts).toHaveLength(0);
  });

  it("onExpire is optional (does not throw if not provided)", () => {
    const onToken = vi.fn();
    expect(() => {
      render(<TurnstileWidget onToken={onToken} />);
    }).not.toThrow();
  });
});
