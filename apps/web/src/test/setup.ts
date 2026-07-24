// Test setup for @stimuliiq/web component tests.
// Mirrors @repo/ui/src/test/setup.ts (same jsdom environment + RTL cleanup).

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Unmount components after each test so DOM/ids don't leak across tests.
afterEach(() => {
  cleanup();
});

// jsdom stubs for Radix UI / browser APIs not present in jsdom.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom global shim
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
