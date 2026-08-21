/**
 * Refund Policy — /refund-policy
 * Static page, SSG, referenced from pricing, terms and the footer.
 *
 * CONTENT SOURCE OF TRUTH: this page must agree with the refund answer the rest of the
 * site already gives — `apps/web/content/faq/refund.mdx` and the `faq` block of
 * `prisma/fixtures/builder-pages/home.json`, both of which state that programs are
 * non-refundable. It previously advertised a "7-day no-questions-asked refund" plus a
 * pro-rata window, which was the pre-repositioning policy and directly contradicted
 * those two. Change all three together or the site contradicts itself again.
 */
import type { Metadata } from "next";
import { buildMetadata } from "../../lib/seo/metadata";
import { SUPPORT_EMAIL, WHATSAPP_DISPLAY, buildWhatsAppHref } from "../../lib/contact";
import { ContactLink, LegalContactCard, LegalHeader, LegalItemList } from "../../components/legal/legal-ui";

export const metadata: Metadata = buildMetadata({
  title: "Refund Policy",
  description:
    "Stimuli IQ's refund policy: programs are non-refundable once enrolled. What that covers, the limited exceptions we do honour, and how to reach us.",
  canonicalPath: "/refund-policy",
});

const LAST_UPDATED = "July 2026";

/** The limited cases where money does come back — all failures on our side, not change of mind. */
const EXCEPTIONS = [
  {
    title: "Duplicate payment",
    body: "If the same enrolment is charged more than once, the extra charge is returned in full.",
  },
  {
    title: "Failed or cancelled enrolment",
    body: "If a payment succeeds but your enrolment is not created, or we cancel your seat, the amount is returned in full.",
  },
  {
    title: "Program cancelled by us",
    body: "If we cancel a program before it begins and cannot offer you a place on the next batch, the fee is returned in full.",
  },
];

export default function RefundPolicyPage() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-3xl px-4 py-12 md:px-6 lg:py-16"
      data-testid="refund-policy"
    >
      <LegalHeader
        title="Refund Policy"
        lastUpdated={LAST_UPDATED}
        intro="Our programs are non-refundable once you enrol. This page explains exactly what
          that means, the limited cases where we do return a payment, and how to reach us."
      />

      {/* The policy itself, stated once and unmissably — a reader who only takes in one
          block should take in this one. */}
      <section
        aria-labelledby="policy-heading"
        className="mt-10 rounded-2xl border border-border bg-surface p-6 md:p-8"
      >
        <h2 id="policy-heading" className="text-xl font-bold text-fg">
          Programs are non-refundable
        </h2>
        <div className="mt-4 flex flex-col gap-4 text-base leading-relaxed text-fg-muted">
          <p>
            Every program is built and delivered by practising healthcare professionals, and
            your seat is reserved and mentor time allocated the moment you enrol. For that
            reason we do not offer refunds, including where a program has been started but
            not completed.
          </p>
          <p>
            Please use the free counselling slot before you pay. It exists so you can ask a
            mentor anything about the curriculum, the schedule and the outcome before any
            money changes hands.
          </p>
        </div>
      </section>

      <section aria-labelledby="exceptions-heading" className="mt-12">
        <h2 id="exceptions-heading" className="text-xl font-bold text-fg">
          When we do return a payment
        </h2>
        <p className="mt-3 text-base leading-relaxed text-fg-muted">
          These are billing and delivery failures on our side, not a change of mind:
        </p>
        <LegalItemList items={EXCEPTIONS} />
      </section>

      <section aria-labelledby="process-heading" className="mt-12">
        <h2 id="process-heading" className="text-xl font-bold text-fg">
          How an approved return is processed
        </h2>
        <div className="mt-4 flex flex-col gap-4 text-base leading-relaxed text-fg-muted">
          <p>
            Where one of the cases above applies, write to us with your payment reference.
            Approved amounts go back to the original payment method within 7&ndash;10
            business days. We cannot return a payment to a different account or method.
          </p>
          <p>
            Bank or payment-gateway processing times are outside our control and may add a
            few days after we have released the amount.
          </p>
        </div>
      </section>

      <LegalContactCard id="contact-heading" title="Questions about a payment">
        Email <ContactLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</ContactLink> or
        message us on WhatsApp at{" "}
        <ContactLink href={buildWhatsAppHref()} external>
          {WHATSAPP_DISPLAY}
        </ContactLink>
        . Include your registered phone number and the payment reference so we can find
        the transaction quickly.
      </LegalContactCard>
    </main>
  );
}
