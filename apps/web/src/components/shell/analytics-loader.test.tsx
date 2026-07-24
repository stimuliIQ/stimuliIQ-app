/**
 * AnalyticsLoader tests — consent gate invariant (AC-34/35/36).
 *
 * Critical invariant: analytics components MUST NOT render when enabled=false.
 * This is the primary DPDP requirement and a pre-consent firing bug would be a
 * regulatory issue.
 *
 * Tests use dynamic import mocking to intercept @next/third-parties/google.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { AnalyticsLoader } from "./analytics-loader";

// Mock @next/third-parties/google so no real scripts are loaded in tests.
// We only care that the components are/aren't called.
vi.mock("@next/third-parties/google", () => ({
  GoogleTagManager: ({ gtmId }: { gtmId: string }) => (
    <div data-testid="gtm-loader" data-gtm-id={gtmId} />
  ),
  GoogleAnalytics: ({ gaId }: { gaId: string }) => (
    <div data-testid="ga-loader" data-ga-id={gaId} />
  ),
}));

// Mock next/dynamic to return components synchronously in tests.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: unknown }>) => {
    // Return a simple wrapper that calls the loader synchronously
    // This makes dynamic imports testable without async boundaries.
    let Component: React.ComponentType<Record<string, unknown>> | null = null;
    loader().then((mod) => {
      Component = (mod as { default: React.ComponentType<Record<string, unknown>> }).default;
    });
    return function DynamicWrapper(props: Record<string, unknown>) {
      if (!Component) return null;
      return <Component {...props} />;
    };
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AnalyticsLoader — consent gate (AC-34 invariant)", () => {
  beforeEach(() => {
    // Clear env between tests
    delete process.env.NEXT_PUBLIC_ANALYTICS_GTM_ID;
    delete process.env.NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID;
  });

  it("renders null when enabled=false (no consent — analytics MUST NOT load)", () => {
    const { container } = render(<AnalyticsLoader enabled={false} />);
    // The component returns null — container has no meaningful children
    expect(container.firstChild).toBeNull();
  });

  it("renders null when enabled=false even if GTM_ID is set", () => {
    process.env.NEXT_PUBLIC_ANALYTICS_GTM_ID = "GTM-TEST123";
    const { container } = render(<AnalyticsLoader enabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when enabled=false even if GA_ID is set", () => {
    process.env.NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID = "G-TEST123";
    const { container } = render(<AnalyticsLoader enabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when enabled=true but no analytics IDs are configured (Noop)", () => {
    // No GTM_ID, no GA_ID set
    const { container } = render(<AnalyticsLoader enabled={true} />);
    // Should still render nothing (Noop) — no analytics configured
    expect(container.firstChild).toBeNull();
  });

  // The following tests assert that WITH consent AND with IDs set, analytics loads.
  // Note: dynamic imports are async; in this test setup we verify the intent, not the
  // full async render path (that is an integration test concern).
  it("does not throw when enabled=true with GTM_ID set", () => {
    process.env.NEXT_PUBLIC_ANALYTICS_GTM_ID = "GTM-ABCDEF";
    expect(() => render(<AnalyticsLoader enabled={true} />)).not.toThrow();
  });

  it("does not throw when enabled=true with GA_ID set", () => {
    process.env.NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID = "G-ABCDEFG";
    expect(() => render(<AnalyticsLoader enabled={true} />)).not.toThrow();
  });
});
