/**
 * /onboarding — the student onboarding form. One route on the main site
 * (`stimuliiq.com/onboarding`); this path IS the link staff hand to students.
 *
 * No subdomain: an earlier draft rewrote `onboarding.stimuliiq.com` → here via
 * `middleware.ts`, which was dropped on the product owner's call. A path costs nothing to
 * operate — no extra DNS record, no Vercel domain to attach, no edge middleware on every
 * request to the whole site.
 *
 * Chrome: `SiteShell` drops the marketing header/footer/WhatsApp FAB/lead popup for this
 * path (its `isStandaloneForm` branch), the same treatment `/pay/:token` already gets. A
 * form a student was told to fill should read as a form, not as a landing page with a
 * mega-menu inviting them elsewhere mid-answer.
 *
 * `noindex`: this is a private link for students who have already paid. It must never
 * surface in search results, where a stranger would find an open intake form.
 */
import type { Metadata } from "next";
import { OnboardingForm } from "../../components/onboarding/onboarding-form";

export const metadata: Metadata = {
  title: "Onboarding Form | Stimuli IQ",
  description: "Share your details so we can complete your enrolment.",
  robots: { index: false, follow: false },
};

// The question set is CRM-authored and read at request time by the client hook, so there
// is nothing to prerender or revalidate here — the page shell is static, its contents are
// always live.
export default function OnboardingPage() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <OnboardingForm />
    </main>
  );
}
