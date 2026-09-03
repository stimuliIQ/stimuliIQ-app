import * as React from "react";
import { Medal } from "lucide-react";

import { cn } from "../lib/cn";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

/**
 * LeaderboardTable — opt-in, PII-minimal leaderboard for a batch/program.
 * Per docs/02-prd-lms.md §7.12, docs/07 §11.
 *
 * Privacy rules (structural enforcement — not just policy):
 * - The component's `LeaderboardEntry` type CANNOT carry email, phone, or any PII
 *   field. Only `displayName` (alias or display name) + `points` + `rank`.
 * - Opt-out: if a student has opted out, they are simply absent from the `entries`
 *   array (the backend excludes them). The component has no opt-out controls —
 *   those live in the notification prefs or profile settings.
 * - The component renders a notice that the leaderboard only shows students who
 *   opted in (informational transparency).
 *
 * A11y:
 * - Native <table> with a caption (visually hidden by default, visible to SR).
 * - Rank medals for top-3 positions use both color AND label text (not color-only).
 * - `aria-sort` on sortable columns would apply if columns were sortable; here rank
 *   order is fixed server-side, so `aria-rowindex` is used instead.
 * - Loading skeleton uses `aria-busy`.
 *
 * Usage:
 *   <LeaderboardTable
 *     entries={leaderboard}   // no email/phone in this type!
 *     loading={isFetching}
 *   />
 */

/**
 * Structural type — cannot carry email, phone, or PII.
 * Intentional: this type is the enforcement mechanism.
 */
export interface LeaderboardEntry {
  /**
   * True on the viewer's own row. Resolved server-side, because the leaderboard payload
   * deliberately carries no user id for anybody — see LeaderboardEntryDto in
   * `@repo/types`. This replaced a `userId` field the caller had to match against
   * `currentUserId`: the API never returns one, so the LMS filled it with the current
   * user's id on EVERY row and the table highlighted the entire leaderboard as "you".
   */
  isMe: boolean;
  /** Display name / alias. Never email or phone. */
  displayName: string;
  /** Aggregate points. */
  points: number;
  /** 1-indexed rank as computed server-side. */
  rank: number;
}

/**
 * Type-level guard: the presence of `email` or `phone` fields would be a compile error,
 * since `LeaderboardEntry` does not declare them and we use a strict object type.
 */
type _NoPII = LeaderboardEntry extends { email: string } ? never : true;
type _NoPII2 = LeaderboardEntry extends { phone: string } ? never : true;
// If this ever evaluates to `never`, the types file has a bug.
type _AssertNoPII = _NoPII & _NoPII2;
// Suppress "unused type" lint warnings
const _assertNoPII: _AssertNoPII = true;
void _assertNoPII;

export interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  loading?: boolean;
  loadingRowCount?: number;
  /** Optional heading for the section. */
  heading?: string;
  /** Opt-in notice shown below the table. Defaults to a standard privacy notice. */
  optInNotice?: string;
  className?: string;
  /** Test hook; defaults to "leaderboard-table". */
  "data-testid"?: string;
}

const RANK_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "1st", color: "text-warning" },
  2: { label: "2nd", color: "text-fg-muted" },
  3: { label: "3rd", color: "text-warning/70" },
};

function RankCell({ rank }: { rank: number }): React.JSX.Element {
  const medal = RANK_LABELS[rank];
  if (medal) {
    return (
      <span className={cn("inline-flex items-center gap-1 font-semibold", medal.color)}>
        <Medal aria-hidden="true" className="size-4 shrink-0" />
        {medal.label}
      </span>
    );
  }
  return <span className="tabular-nums text-fg-muted">{rank}</span>;
}

export function LeaderboardTable({
  entries,
  loading = false,
  loadingRowCount = 10,
  heading,
  optInNotice,
  className,
  "data-testid": testId,
}: LeaderboardTableProps): React.JSX.Element {
  const hasEntries = entries.length > 0;

  return (
    <section
      data-testid={testId ?? "leaderboard-table"}
      aria-label={heading ?? "Leaderboard"}
      className={cn("flex flex-col gap-3", className)}
    >
      {heading ? (
        <h3 className="text-sm font-semibold text-fg">{heading}</h3>
      ) : null}

      {loading ? (
        <div
          aria-busy="true"
          aria-label="Loading leaderboard"
          className="rounded-md border border-border overflow-hidden"
        >
          {Array.from({ length: loadingRowCount }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
              <Skeleton shape="line" className="w-8" />
              <Skeleton shape="line" className="flex-1" />
              <Skeleton shape="line" className="w-16" />
            </div>
          ))}
        </div>
      ) : !hasEntries ? (
        <EmptyState
          title="No entries yet"
          description="Students who opt in to the leaderboard will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table
            className="w-full text-sm"
            aria-label={heading ?? "Leaderboard"}
          >
            <caption className="sr-only">
              Leaderboard showing opted-in students ranked by points.
              display names only. No personal contact information is shown.
            </caption>
            <thead className="bg-surface">
              <tr className="border-b border-border">
                <th
                  scope="col"
                  className="w-16 px-4 py-3 text-left font-medium text-fg-muted"
                >
                  Rank
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left font-medium text-fg-muted"
                >
                  Name
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right font-medium text-fg-muted"
                >
                  Points
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => {
                const isMe = entry.isMe;
                return (
                  <tr
                    key={entry.rank}
                    aria-rowindex={index + 2} // +2 because header row is 1
                    data-testid="leaderboard-row"
                    data-current-user={isMe || undefined}
                    className={cn(
                      "border-b border-border last:border-0",
                      isMe
                        ? "bg-brand-50 font-medium dark:bg-brand-500/10"
                        : "hover:bg-surface",
                    )}
                  >
                    <td className="px-4 py-3">
                      <RankCell rank={entry.rank} />
                    </td>
                    <td className="px-4 py-3 text-fg">
                      {entry.displayName}
                      {isMe ? (
                        <span className="ml-2 text-xs text-brand-500">(you)</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-fg">
                      {entry.points.toLocaleString("en-IN")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Opt-in transparency notice */}
      <p className="text-xs text-fg-subtle">
        {optInNotice ??
          "Only students who opted in to leaderboard visibility are listed. Names shown are display names only."}
      </p>
    </section>
  );
}
