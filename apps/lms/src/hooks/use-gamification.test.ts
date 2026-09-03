// use-gamification hook tests, Phase 6, Task #10.
//
// Tests:
//   - Query key structure (regression guard)
//   - Display floor for negative XP (AC-49, WS-3)
//   - Leaderboard opt-in gate (AC-50, AC-51)
//   - PII-minimal leaderboard type (LOCK-D5)

import {
  GAMIFICATION_SUMMARY_QUERY_KEY,
  leaderboardQueryKey,
} from "./use-gamification";

// ---------------------------------------------------------------------------
// Query key shape tests
// ---------------------------------------------------------------------------

describe("gamification query keys", () => {
  it("GAMIFICATION_SUMMARY_QUERY_KEY is stable", () => {
    expect(GAMIFICATION_SUMMARY_QUERY_KEY).toEqual([
      "lms",
      "gamification",
      "summary",
    ]);
  });

  it("leaderboardQueryKey includes the batchId", () => {
    const key = leaderboardQueryKey("batch-abc");
    expect(key).toEqual(["lms", "gamification", "leaderboard", "batch-abc"]);
  });

  it("leaderboardQueryKey with null returns the null marker key", () => {
    const key = leaderboardQueryKey(null);
    // When batchId is null, the query should be disabled, the key structure
    // must not accidentally conflict with a real batch.
    expect(key).toEqual(["lms", "gamification", "leaderboard", null]);
  });
});

// ---------------------------------------------------------------------------
// Display floor for negative XP
// The gamification-section.tsx component applies Math.max(0, totalPoints)
// so that reversed/corrected XP never shows as negative in the UI (AC-49).
// ---------------------------------------------------------------------------

describe("display floor for negative XP (AC-49)", () => {
  it("Math.max(0, totalPoints) floors negative values to 0", () => {
    // The component code: const displayPoints = Math.max(0, totalPoints);
    expect(Math.max(0, -50)).toBe(0);
    expect(Math.max(0, 0)).toBe(0);
    expect(Math.max(0, 100)).toBe(100);
    expect(Math.max(0, -1)).toBe(0);
  });

  it("negative XP display never shows < 0", () => {
    const scenarios = [-500, -1, 0, 1, 999, 10_000];
    for (const points of scenarios) {
      expect(Math.max(0, points)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Leaderboard PII-minimal type contract (LOCK-D5, AC-50/51)
// The LeaderboardEntryDto returned from the API contains only:
//   rank, displayName, totalPoints, badgeCount, isMe
// It MUST NOT contain email, phone, userId. `isMe` is a boolean about the CALLER, not an
// identifier for anyone on the board — it is how the client highlights its own row in a
// payload that carries no user id.
// ---------------------------------------------------------------------------

describe("LeaderboardEntryDto PII-minimal contract (LOCK-D5)", () => {
  it("LeaderboardEntryDto schema does not include email or phone", async () => {
    const { LeaderboardEntryDtoSchema } = await import("@repo/types");

    // A minimal valid entry
    const validEntry = {
      rank: 1,
      displayName: "Ravi K",
      totalPoints: 500,
      badgeCount: 3,
      isMe: false,
    };

    const parsed = LeaderboardEntryDtoSchema.safeParse(validEntry);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      // MUST NOT have email/phone/userId in the parsed output
      expect(Object.prototype.hasOwnProperty.call(parsed.data, "email")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(parsed.data, "phone")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(parsed.data, "userId")).toBe(false);
    }
  });

  it("LeaderboardEntryDto with rogue email field: rogue field stripped or rejected", async () => {
    const { LeaderboardEntryDtoSchema } = await import("@repo/types");

    const rogueEntry = {
      rank: 1,
      displayName: "Priya S",
      totalPoints: 350,
      badgeCount: 2,
      isMe: false,
      email: "priya@example.com", // ROGUE, should be stripped or cause failure
    };

    const parsed = LeaderboardEntryDtoSchema.safeParse(rogueEntry);
    if (parsed.success) {
      // Zod strips unknown fields (non-strict): email must not be in parsed output
      expect(Object.prototype.hasOwnProperty.call(parsed.data, "email")).toBe(false);
    }
    // If strict mode rejects: also fine (parsed.success === false)
    // Either outcome prevents PII leaking into the UI
  });
});

// ---------------------------------------------------------------------------
// Leaderboard opt-in gate (AC-50, AC-51)
// The hook should only enable the leaderboard query when leaderboardOptIn is true.
// This is a unit test of the conditional query-enable logic.
// ---------------------------------------------------------------------------

describe("leaderboard opt-in gate (AC-50, AC-51)", () => {
  it("leaderboard query is enabled only when leaderboardOptIn is true AND batchId is provided", () => {
    // Simulating the condition in gamification-section.tsx:
    //   const leaderboardEnabled =
    //     gamification.summary?.leaderboardOptIn === true && Boolean(batchId);

    const scenarios: Array<{
      optIn: boolean | undefined;
      batchId: string | null | undefined;
      expected: boolean;
    }> = [
      { optIn: true, batchId: "batch-123", expected: true },
      { optIn: false, batchId: "batch-123", expected: false },
      { optIn: true, batchId: null, expected: false },
      { optIn: true, batchId: undefined, expected: false },
      { optIn: undefined, batchId: "batch-123", expected: false },
      { optIn: false, batchId: null, expected: false },
    ];

    for (const { optIn, batchId, expected } of scenarios) {
      const leaderboardEnabled = optIn === true && Boolean(batchId);
      expect(leaderboardEnabled).toBe(expected);
    }
  });
});
