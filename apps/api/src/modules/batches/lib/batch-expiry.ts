// apps/api/src/modules/batches/lib/batch-expiry.ts
//
// ONE definition of "this batch's end date has passed", shared by the two places that
// need it:
//   - BatchesRepository.list()'s `enrollable` filter (hide expired batches from the
//     student-assignment pickers immediately)
//   - BatchAutoCloseScheduler (flip expired batches to `completed`)
//
// They must agree. If the filter treated a batch as expired while the sweep did not, a
// batch would vanish from the pickers yet sit `active` forever; if they disagreed the
// other way, a closed batch could still be offered for enrolment.

/**
 * Midnight UTC today. A batch is expired when `endDate < ` this — so a batch whose end
 * date IS today is still open for its final day, which is what "ends on the 1st" means
 * to a human.
 *
 * UTC rather than server-local because `end_date` is a date-only value the API stores at
 * midnight UTC (IsoDateSchema). Comparing it against a local midnight would shift the
 * cutoff by the host's offset, so a batch could expire a day early or late purely from
 * where the process happens to run — and the CRM and the sweep could disagree if they
 * ran in different zones.
 */
export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Statuses a batch can be enrolled into / can still be auto-closed FROM. */
export const OPEN_BATCH_STATUSES = ["planned", "active"] as const;
