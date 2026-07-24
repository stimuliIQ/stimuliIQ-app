// apps/api/src/modules/commerce/lib/gst.ts
//
// India GST breakdown helper for invoice generation (T27, docs/plans/
// phase-9-completion.md, B8 fix). Pure function — no I/O, no Prisma, no provider calls.
//
// SIMPLIFICATION (documented, not a silent gap): the shipped schema has no
// buyer-state/place-of-supply field on Order/StudentProfile, so this cannot
// distinguish an intra-state sale (CGST+SGST) from an inter-state sale (IGST) — it
// always computes an intra-state CGST+SGST split. `amountPaise` is treated as
// TAX-INCLUSIVE (standard practice for advertised course fees in India) at the
// standard 18% GST rate for educational/training services. A future wave should add a
// `place_of_supply`/buyer-state field to compute IGST correctly for out-of-state
// students — tracked as a phase-9 follow-up.

export const GST_RATE_PERCENT = 18;

export interface GstBreakdown {
  taxRate: number;
  taxAmountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  taxableAmountPaise: number;
  totalAmountPaise: number;
}

/** Computes a GST breakdown assuming `amountPaise` is tax-inclusive at GST_RATE_PERCENT. */
export function computeGstBreakdown(amountPaise: number): GstBreakdown {
  const taxAmountPaise = Math.round((amountPaise * GST_RATE_PERCENT) / (100 + GST_RATE_PERCENT));
  const taxableAmountPaise = amountPaise - taxAmountPaise;
  const cgstPaise = Math.round(taxAmountPaise / 2);
  const sgstPaise = taxAmountPaise - cgstPaise; // remainder paise goes to SGST — sums exactly.

  return {
    taxRate: GST_RATE_PERCENT,
    taxAmountPaise,
    cgstPaise,
    sgstPaise,
    taxableAmountPaise,
    totalAmountPaise: amountPaise,
  };
}
