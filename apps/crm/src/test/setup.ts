// Test setup for @stimuliiq/crm component tests (R12, docs/plans/phase-9-completion.md
// T41). Mirrors packages/ui/src/test/setup.ts and apps/web/src/test/setup.ts exactly
// (same jsdom environment + RTL cleanup + Radix/browser-API stubs) so behavior is
// consistent across every FE test suite in the monorepo — plus registers jest-axe's
// `toHaveNoViolations` matcher (new to this app; see vitest.config.ts's header).

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// NOTE: jest-axe's own `toHaveNoViolations` custom matcher relies on Jest's internal
// `expect` state machinery and throws `expectAssertion.call is not a function` under
// Vitest's `expect.extend()` (confirmed empirically here) — component tests in this
// repo therefore import `axe` from "jest-axe" directly and assert
// `expect(results.violations).toHaveLength(0)` (or `toEqual([])`) instead of registering
// the matcher, which is fully equivalent (same underlying axe-core scan/violations
// array) without the Jest/Vitest `expect` incompatibility.

// Unmount components after each test so DOM/ids don't leak across tests (React 19 + RTL).
afterEach(() => {
  cleanup();
});

// jsdom lacks ResizeObserver/PointerEvent capture APIs that Radix primitives (Drawer,
// Select, etc. — used throughout crm via @repo/ui) probe for; stub them so component
// tests don't fail on environment gaps unrelated to the code under test.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom global shim, no typed lib entry
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

if (typeof window !== "undefined" && !window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
}

if (typeof window !== "undefined" && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

if (typeof window !== "undefined" && typeof window.matchMedia === "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom has no real clipboard API — TwoFactorPanel's "Copy" buttons call
// navigator.clipboard.writeText(); stub it so those components don't throw under test.
// `configurable: true` is REQUIRED here — @testing-library/user-event v14's own
// `userEvent.setup()` installs its OWN clipboard stub per-test and needs to be able to
// redefine this property; a non-configurable stub throws "Cannot redefine property:
// clipboard" the first time a test calls `userEvent.setup()`.
if (typeof navigator !== "undefined" && !navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    writable: true,
    configurable: true,
    value: { writeText: async () => {} },
  });
}
