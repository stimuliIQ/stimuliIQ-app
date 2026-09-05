// The reprice arithmetic, on its own.
//
// These are the rules that decide what gets STORED, and a mistake here is not visible on any
// screen — it shows up months later as revenue reports that do not add up. Worth pinning
// separately from the service, where they would be buried behind scope and payment guards.
import { computeReprice, formatPaise } from "./order-price.helper";

describe("computeReprice", () => {
  // The whole point of the feature: selling a ₹14,999 programme for ₹10,000 must record BOTH
  // numbers, so gross, discount and net reconcile. Overwriting the amount alone would make a
  // discounted sale indistinguishable from a cheap programme.
  it("splits a lower price into amount + discount rather than overwriting the amount", () => {
    const result = computeReprice({ amountPaise: 1499900, discountPaise: 0 }, 1000000);
    expect(result).toEqual({ ok: true, next: { amountPaise: 1000000, discountPaise: 499900 } });
  });

  // The list price is the order's OWN amount + discount, not the programme's price today.
  // Re-discounting must measure from what the order was worth when it was raised, or a
  // second reduction would be computed against an already-reduced figure.
  it("measures a further discount from the ORIGINAL list price, not the current amount", () => {
    const once = computeReprice({ amountPaise: 1499900, discountPaise: 0 }, 1200000);
    expect(once).toMatchObject({ ok: true });
    if (!once.ok) return;

    const twice = computeReprice(once.next, 1000000);
    expect(twice).toEqual({ ok: true, next: { amountPaise: 1000000, discountPaise: 499900 } });
  });

  it("allows a free seat", () => {
    const result = computeReprice({ amountPaise: 1499900, discountPaise: 0 }, 0);
    expect(result).toEqual({ ok: true, next: { amountPaise: 0, discountPaise: 1499900 } });
  });

  // A "discount" that raises the price would make discountPaise negative, quietly inflating
  // gross in every report that sums it. An upsell is a different action and must not hide here.
  it("refuses a price above the list price", () => {
    const result = computeReprice({ amountPaise: 1000000, discountPaise: 499900 }, 1600000);
    expect(result).toEqual({ ok: false, reason: { code: "above_list_price", listPricePaise: 1499900 } });
  });

  it("allows restoring exactly the list price, which clears the discount", () => {
    const result = computeReprice({ amountPaise: 1000000, discountPaise: 499900 }, 1499900);
    expect(result).toEqual({ ok: true, next: { amountPaise: 1499900, discountPaise: 0 } });
  });

  // Writing the same number back would still stamp a reason, add an audit row and notify
  // every super admin, for a change that did not happen.
  it("refuses a no-op", () => {
    const result = computeReprice({ amountPaise: 1000000, discountPaise: 499900 }, 1000000);
    expect(result).toEqual({ ok: false, reason: { code: "unchanged" } });
  });

  // Money is integer paise everywhere (CLAUDE.md §3.6); a float would round somebody's fee.
  it("keeps both numbers integer paise", () => {
    const result = computeReprice({ amountPaise: 1499900, discountPaise: 0 }, 333333);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(Number.isInteger(result.next.amountPaise)).toBe(true);
    expect(Number.isInteger(result.next.discountPaise)).toBe(true);
    expect(result.next.amountPaise + result.next.discountPaise).toBe(1499900);
  });
});

describe("formatPaise", () => {
  it("renders paise as rupees with two decimals", () => {
    expect(formatPaise(1499900)).toBe("₹14,999.00");
    expect(formatPaise(0)).toBe("₹0.00");
  });
});
