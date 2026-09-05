// The arithmetic and the rules behind a manual order reprice, on their own so they can be
// tested without a database and reused by anything that needs to reason about a discount.
//
// WHY A DISCOUNT AND NOT AN OVERWRITTEN AMOUNT. An order carries `amountPaise` (what is
// actually charged) and `discountPaise` (how far below list that is). Selling a ₹14,999
// programme for ₹10,000 sets 1000000 / 499900, not 1000000 / 0. The difference matters the
// moment anybody asks where revenue went: with the discount recorded, gross, discount and net
// all reconcile and a discounted sale is distinguishable from a cheap programme. With the
// amount simply overwritten, they are not, and no report can recover it.

/** Paise, always integers — money is never a float in this codebase (CLAUDE.md §3.6). */
export interface RepricedOrder {
  amountPaise: number;
  discountPaise: number;
}

export type RepriceRejection =
  | { code: "above_list_price"; listPricePaise: number }
  | { code: "unchanged" };

/**
 * Work out the two stored numbers for a new agreed price.
 *
 * `listPricePaise` is the order's CURRENT amount + discount, not the programme's price today.
 * Deliberate: a programme's price can change after an order is raised, and re-deriving from
 * today's price would silently reprice an old order against a list it was never sold at.
 * The order is its own record of what it was worth.
 */
export function computeReprice(
  current: RepricedOrder,
  newAmountPaise: number,
): { ok: true; next: RepricedOrder } | { ok: false; reason: RepriceRejection } {
  const listPricePaise = current.amountPaise + current.discountPaise;

  // A "discount" that raises the price is an upsell, and letting one through here would make
  // discountPaise negative — quietly inflating gross in every report that sums it.
  if (newAmountPaise > listPricePaise) {
    return { ok: false, reason: { code: "above_list_price", listPricePaise } };
  }

  // Writing the same number back would still stamp a reason, fire a notification to every
  // super admin and add an audit row, for a change that did not happen.
  if (newAmountPaise === current.amountPaise) {
    return { ok: false, reason: { code: "unchanged" } };
  }

  return {
    ok: true,
    next: { amountPaise: newAmountPaise, discountPaise: listPricePaise - newAmountPaise },
  };
}

/** "₹14,999.00" — for notification and audit text, never for arithmetic. */
export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}
