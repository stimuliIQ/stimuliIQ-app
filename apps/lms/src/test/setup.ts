// Vitest setup for @stimuliiq/lms component tests.
//
// Mirrors apps/crm/src/test/setup.ts deliberately: the two apps should fail the same way, so
// a test written against one behaves the same when moved to the other.
//
// NOTE on jest-axe: its own `toHaveNoViolations` matcher relies on Jest's internal `expect`
// state machinery and throws under Vitest's `expect.extend()`. Component tests in this repo
// therefore import `axe` directly and assert `expect(results.violations).toEqual([])`, which
// is exactly equivalent (same axe-core scan, same violations array) without the
// Jest/Vitest incompatibility.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount components after each test so DOM/ids don't leak across tests (React 19 + RTL).
afterEach(() => {
  cleanup();
});

// jsdom has no matchMedia. `useFlyoutNav` probes `(hover: hover) and (pointer: fine)` on
// mount; answering `false` makes the default test render a TOUCH device, which is the harder
// case — hover-open is unavailable there, so the click path is what gets exercised.
if (typeof window !== "undefined" && typeof window.matchMedia === "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}
