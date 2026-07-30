/**
 * Book-Free-Slot page — /book-free-slot
 *
 * Multi-step funnel: Program → Date/Time → Details → Confirm → Submit
 * → POST /public/bookings (reused P2 endpoint)
 *
 * Security: honeypot + Turnstile captcha + DPDP consent + UTM capture.
 * No WhatsApp/email send here — the API enqueues the event (P6 handles fanout).
 *
 * a11y (AC-38, AC-39):
 *   - Focus moves to step heading on step change (MultiStepForm handles this).
 *   - Screen-reader step announcement via aria-live.
 *   - All form fields have associated labels.
 *   - Keyboard-navigable step indicator.
 *
 * Loading/empty/error+retry: all states implemented.
 * Idempotent: double-click on final step is safe (isSubmitting guard).
 */

import type { Metadata } from "next";
import { buildMetadata } from "../../lib/seo/metadata";
import { serverApiClient } from "../../lib/api-client";
import type { ProgramOption } from "./_components/book-slot-step-program";

export const revalidate = 3600; // ISR: new CRM programs surface within the hour

export const metadata: Metadata = buildMetadata({
  title: "Book a Free Counselling Slot — Stimuli IQ",
  description:
    "Book a free 30-minute counselling session with a Stimuli IQ mentor. Choose your program, pick a slot, and start your tech career journey.",
  canonicalPath: "/book-free-slot",
  noIndex: false,
});

export default async function BookFreeSlotPage() {
  // Bind the "Program of interest" dropdown to the live CRM catalog (published,
  // public programs). Empty on failure → the form still works ("Not sure yet").
  let programs: ProgramOption[] = [];
  try {
    const result = await serverApiClient.public.programs.list({ limit: 50, sort: "popularity" });
    programs = Array.isArray(result.items)
      ? result.items.map((p) => ({ id: p.id, title: p.title }))
      : [];
  } catch {
    programs = [];
  }

  return (
    <main
      id="main-content"
      className="mx-auto max-w-lg px-4 pb-16 pt-8 md:pt-12"
      data-testid="book-free-slot-page"
    >
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-fg">Book a <span className="text-chart-3">Free Slot</span></h1>
        <p className="mt-2 text-fg-muted">
          A mentor will call you for a free 30-minute career counselling session.
          No commitment required.
        </p>
      </div>

      {/* Client component: the multi-step form (programs bound from the CRM catalog) */}
      <BookSlotForm programs={programs} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Import the client component (must be below the metadata export)
// ---------------------------------------------------------------------------

import { BookSlotForm } from "./_components/book-slot-form";
