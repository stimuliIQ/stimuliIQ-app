// apps/api/src/common/webhook/signature-freshness.spec.ts
//
// Unit tests for the shared webhook signature-timestamp freshness check (Phase-7 Wave 2
// security hardening batch A, item 2a, AC-59).

import { isWithinSignatureFreshnessWindow } from "./signature-freshness";

describe("isWithinSignatureFreshnessWindow", () => {
  const NOW_MS = 1_700_000_000_000;
  const NOW_SECONDS = NOW_MS / 1000;

  it("returns true for a timestamp exactly now", () => {
    expect(isWithinSignatureFreshnessWindow(NOW_SECONDS, 300, NOW_MS)).toBe(true);
  });

  it("returns true for a timestamp within the window in the past", () => {
    expect(isWithinSignatureFreshnessWindow(NOW_SECONDS - 200, 300, NOW_MS)).toBe(true);
  });

  it("returns false for a timestamp older than the window (replay)", () => {
    expect(isWithinSignatureFreshnessWindow(NOW_SECONDS - 301, 300, NOW_MS)).toBe(false);
  });

  it("returns true at exactly the window boundary", () => {
    expect(isWithinSignatureFreshnessWindow(NOW_SECONDS - 300, 300, NOW_MS)).toBe(true);
  });

  it("returns false for a timestamp too far in the future (clock-skew tolerance is symmetric)", () => {
    expect(isWithinSignatureFreshnessWindow(NOW_SECONDS + 301, 300, NOW_MS)).toBe(false);
  });

  it("returns false for NaN / non-finite input", () => {
    expect(isWithinSignatureFreshnessWindow(NaN, 300, NOW_MS)).toBe(false);
    expect(isWithinSignatureFreshnessWindow(Number.POSITIVE_INFINITY, 300, NOW_MS)).toBe(false);
  });
});
