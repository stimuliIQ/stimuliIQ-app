// Unit tests for the shared batch-expiry cutoff.
//
// This helper is small but load-bearing: BatchesRepository's `enrollable` filter and
// BatchAutoCloseScheduler both compare against it, and they must agree. The two
// properties worth pinning are the boundary (a batch ending TODAY is still open) and the
// use of UTC (so the cutoff does not move with the host's timezone).

import { startOfTodayUtc, OPEN_BATCH_STATUSES } from "./batch-expiry";

describe("startOfTodayUtc", () => {
  it("truncates to midnight UTC", () => {
    const result = startOfTodayUtc(new Date("2026-09-01T17:43:12.345Z"));
    expect(result.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("keeps a batch that ends TODAY on the open side of the cutoff", () => {
    const cutoff = startOfTodayUtc(new Date("2026-09-01T09:00:00Z"));
    const endsToday = new Date("2026-09-01T00:00:00Z"); // date-only values land at midnight UTC.
    // The repository filter is `endDate >= cutoff` and the sweep is `endDate < cutoff`.
    expect(endsToday.getTime() >= cutoff.getTime()).toBe(true);
  });

  it("puts a batch that ended yesterday on the expired side", () => {
    const cutoff = startOfTodayUtc(new Date("2026-09-01T09:00:00Z"));
    expect(new Date("2026-08-31T00:00:00Z").getTime() < cutoff.getTime()).toBe(true);
  });

  it("uses the UTC date, not the host's local one", () => {
    // 00:30 UTC on the 1st. A host at UTC-5 is still on Aug 31 locally; a local-midnight
    // implementation would produce an Aug-31 cutoff here and expire batches a day early.
    expect(startOfTodayUtc(new Date("2026-09-01T00:30:00Z")).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("OPEN_BATCH_STATUSES", () => {
  it("is exactly the two pre-terminal statuses", () => {
    // `completed`/`archived` are terminal: neither enrollable nor sweepable. If a new
    // status is ever added to the enum, this forces a deliberate decision about it.
    expect([...OPEN_BATCH_STATUSES]).toEqual(["planned", "active"]);
  });
});
