/**
 * Refund Policy — /refund-policy
 * Static page, SSG, referenced from pricing and footer.
 */
import type { Metadata } from "next";
import { buildMetadata } from "../../lib/seo/metadata";
import { SUPPORT_EMAIL, WHATSAPP_DISPLAY, buildWhatsAppHref } from "../../lib/contact";

export const metadata: Metadata = buildMetadata({
  title: "Refund Policy",
  description:
    "StimuliiQ's refund policy — 7-day no-questions-asked refund on all programs. Understand the terms and how to request a refund.",
  canonicalPath: "/refund-policy",
});

export default function RefundPolicyPage() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-3xl px-4 py-10 md:px-6"
      data-testid="refund-policy"
    >
      <h1 className="mb-6 text-3xl font-bold text-fg">Refund Policy</h1>
      <p className="mb-4 text-sm text-fg-muted">Last updated: June 2026</p>

      <div className="prose prose-neutral max-w-none text-fg-muted leading-relaxed">
        <h2 className="text-xl font-semibold text-fg mt-8 mb-3">7-Day Refund Window</h2>
        <p>
          We offer a full refund within 7 days of purchase, no questions asked. If you enroll
          in a program and are not satisfied after accessing it, contact our support team at{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-brand-500 hover:underline focus-visible:outline-none focus-visible:underline"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          within 7 days of your enrollment date.
        </p>

        <h2 className="text-xl font-semibold text-fg mt-8 mb-3">After 7 Days</h2>
        <p>
          After the 7-day window, a pro-rated refund is calculated based on the percentage
          of the program you have not yet accessed or completed. This is assessed on a
          case-by-case basis.
        </p>

        <h2 className="text-xl font-semibold text-fg mt-8 mb-3">Refund Process</h2>
        <p>
          Approved refunds are processed within 7-10 business days to the original payment
          method. EMI plans: the remaining EMI installments are cancelled; any already-charged
          installments are refunded where eligible.
        </p>

        <h2 className="text-xl font-semibold text-fg mt-8 mb-3">Contact Us</h2>
        <p>
          To request a refund or for any queries, contact us at{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-brand-500 hover:underline focus-visible:outline-none focus-visible:underline"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          or via WhatsApp at{" "}
          <a
            href={buildWhatsAppHref()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-500 hover:underline focus-visible:outline-none focus-visible:underline"
          >
            {WHATSAPP_DISPLAY}
          </a>.
        </p>
      </div>
    </main>
  );
}
