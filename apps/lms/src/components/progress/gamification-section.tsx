// Gamification section — folded into the Progress surface. Phase 6, Task #10.
// docs/02 §7.10 / §7.12, docs/specs/phase-6-engagement.md WS-3.
//
// Renders:
//   - PointsBadge (total XP)
//   - StreakFlame (current streak)
//   - BadgeGrid (earned badges)
//   - Leaderboard opt-in toggle + LeaderboardTable (ONLY when opted in)
//
// Leaderboard opt-in rules (LOCK-D5 / AC-50/51):
//   - Only rendered when leaderboardOptIn = true in the student's gamification summary.
//   - Toggle changes opt-in via gamification.updatePrefs.
//   - The table shows display name / alias only — no PII (enforced by LeaderboardEntry type).
//   - Opt-out removes the student from the leaderboard within cache TTL (60 s).
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { RefreshCw, Trophy } from "lucide-react";
import {
  BadgeGrid,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  LeaderboardTable,
  PointsBadge,
  StreakFlame,
  Skeleton,
  type BadgeGridItem,
  type LeaderboardEntry,
} from "@repo/ui";
import type { UserBadgeDto } from "@repo/types";

import { useGamificationSummary, useLeaderboard } from "../../hooks/use-gamification";

// ---------------------------------------------------------------------------
// GamificationSection
// ---------------------------------------------------------------------------

interface GamificationSectionProps {
  /** The batch ID to scope the leaderboard to. Required for leaderboard. */
  batchId?: string | null;
}

export function GamificationSection({
  batchId,
}: GamificationSectionProps): React.JSX.Element {
  const gamification = useGamificationSummary();

  // Only enable leaderboard when the student has opted in
  const leaderboardEnabled =
    gamification.summary?.leaderboardOptIn === true && Boolean(batchId);

  const leaderboard = useLeaderboard(leaderboardEnabled ? batchId : null);

  // ── Signed-out ────────────────────────────────────────────────────────────
  if (gamification.isSignedOut) {
    return (
      <Card data-testid="gamification-signed-out">
        <CardHeader>
          <CardTitle>Sign in to see your progress</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (gamification.isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading gamification"
        className="space-y-4"
        data-testid="gamification-skeleton"
      >
        <div className="flex gap-3">
          <Skeleton shape="block" className="h-10 w-28 rounded-full" />
          <Skeleton shape="block" className="h-10 w-28 rounded-full" />
        </div>
        <Skeleton shape="block" className="h-24 w-full rounded-md" />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (gamification.isError) {
    return (
      <Card data-testid="gamification-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load gamification</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={gamification.refetch}>
            <RefreshCw aria-hidden="true" className="mr-1.5 size-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!gamification.summary) return <></>;

  const {
    totalPoints,
    badges,
    streak,
    leaderboardOptIn,
    leaderboardDisplayName,
  } = gamification.summary;

  // Display floor: never show negative XP in the UI (AC-49 / WS-3 edge case)
  const displayPoints = Math.max(0, totalPoints);

  // Map UserBadgeDto[] → BadgeGridItem[]
  const badgeItems: BadgeGridItem[] = badges.map((ub: UserBadgeDto) => ({
    id: ub.id,
    name: ub.badge.name,
    icon: ub.badge.icon,
    description: ub.badge.description,
    earned: true,
  }));

  // Map LeaderboardEntryDto[] → LeaderboardEntry[] (PII-safe by type).
  // `isMe` comes from the server, which is the only place that knows: the DTO carries no
  // user id for anyone. This used to stamp `currentUserId` onto every row, which made the
  // table's "is this me?" comparison true for all of them — the whole leaderboard rendered
  // highlighted, every name labelled "(you)".
  const leaderboardEntries: LeaderboardEntry[] = leaderboard.entries.map((e) => ({
    isMe: e.isMe,
    displayName: e.displayName,
    points: e.totalPoints,
    rank: e.rank,
  }));

  return (
    <div className="space-y-6" data-testid="gamification-section">
      {/* Points + Streak badges */}
      <section aria-labelledby="stats-heading">
        <h2
          id="stats-heading"
          className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted"
        >
          Your Stats
        </h2>
        <div className="flex flex-wrap gap-3">
          <PointsBadge
            points={displayPoints}
            label="XP"
            size="md"
            data-testid="gamification-points"
          />
          <StreakFlame
            days={streak.currentDays}
            size="md"
            data-testid="gamification-streak"
          />
        </div>
        {streak.longestDays > 0 && (
          <p className="mt-2 text-xs text-fg-muted">
            Longest streak: {streak.longestDays} day{streak.longestDays !== 1 ? "s" : ""}
          </p>
        )}
      </section>

      {/* Badge grid */}
      <BadgeGrid
        badges={badgeItems}
        heading="Badges Earned"
        size="md"
        data-testid="gamification-badges"
      />

      {/* Leaderboard section */}
      <section aria-labelledby="leaderboard-heading" data-testid="gamification-leaderboard-section">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2
            id="leaderboard-heading"
            className="text-sm font-semibold uppercase tracking-wide text-fg-muted flex items-center gap-1.5"
          >
            <Trophy aria-hidden="true" className="size-4" />
            Batch Leaderboard
          </h2>

          {/* Opt-in toggle */}
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={leaderboardOptIn}
              onCheckedChange={(val) => {
                void gamification.updateLeaderboardPrefs({
                  leaderboardOptIn: val === true,
                  leaderboardDisplayName: leaderboardDisplayName ?? null,
                });
              }}
              disabled={gamification.isUpdatingPrefs}
              aria-label="Appear on batch leaderboard"
              data-testid="leaderboard-opt-in-toggle"
            />
            <span className="text-fg-muted">Appear on leaderboard</span>
          </label>
        </div>

        {!leaderboardOptIn ? (
          <Card className="border-dashed" data-testid="leaderboard-opt-out-notice">
            <CardContent className="py-4">
              <p className="text-sm text-fg-muted">
                You are not currently on the leaderboard. Toggle above to opt in and
                compete with your batchmates. Only your display name and XP are visible
                to others.
              </p>
            </CardContent>
          </Card>
        ) : !batchId ? (
          <Card className="border-dashed">
            <CardContent className="py-4">
              <p className="text-sm text-fg-muted">
                Open a course to see the batch leaderboard.
              </p>
            </CardContent>
          </Card>
        ) : leaderboard.isNotEnrolled ? (
          <Card className="border-dashed" data-testid="leaderboard-not-enrolled">
            <CardContent className="py-4">
              <p className="text-sm text-fg-muted">
                Leaderboard is not available for this batch.
              </p>
            </CardContent>
          </Card>
        ) : (
          <LeaderboardTable
            entries={leaderboardEntries}
            loading={leaderboard.isLoading}
            heading={undefined}
            data-testid="gamification-leaderboard"
          />
        )}
      </section>
    </div>
  );
}
