/**
 * HomePageFallback — the pre-Phase-10 hardcoded homepage body, preserved verbatim as the
 * resilience fallback for `app/page.tsx` (docs/specs/phase-10-page-builder.md item B,
 * this task's non-negotiable resilience requirement): if `GET /public/pages/home` fails,
 * is unpublished, or isn't `isBuilderManaged`, the homepage renders this instead of
 * white-screening because the CMS is down.
 */
import {
  FaqAccordion,
} from "@repo/ui";
import { HeroCentered } from "../../home/hero-centered";
import { WhyUsSection } from "../../home/why-us";
import { StatsBento } from "../../home/stats-bento";
import { ExploreCourses } from "../../home/explore-courses";
import { TestimonialSpotlight } from "../../home/testimonial-spotlight";
import { BrainShowcase } from "../../home/brain-showcase";
import { HowItWorksSteps } from "../../home/how-it-works-steps";
import { UpcomingWorkshopBand } from "../../home/upcoming-workshop";
import { PartnerColleges } from "../../home/partner-colleges";
import { BOOK_SLOT_HREF } from "../../shell/nav-config";
import { LeadFormConnected } from "../../leads/lead-form-connected";
import type { PublicProgramSummary, PublicPartner, PublicTestimonial } from "@repo/types";
import type { TestimonialSpotlightItem } from "../../home/testimonial-spotlight";

const FAQ_ITEMS = [
  {
    id: "faq-1",
    question: "What qualifications do I need to enroll?",
    answer:
      "Our programs are designed for MBBS, BDS, BPT, BA & BSc, BAMS, BHMS and other health sciences students. No prior industry experience is required — just a willingness to learn and build real projects.",
    answerText:
      "Our programs are designed for MBBS, BDS, BPT, BA & BSc, BAMS, BHMS and other health sciences students. No prior industry experience is required — just a willingness to learn and build real projects.",
  },
  {
    id: "faq-2",
    question: "Are the classes live or recorded?",
    answer:
      "Most programs combine scheduled live sessions with clinician mentors and recorded lectures you can rewatch anytime. Some programs are fully self-paced. Check the program detail page for the exact format.",
    answerText:
      "Most programs combine scheduled live sessions with clinician mentors and recorded lectures you can rewatch anytime. Some programs are fully self-paced. Check the program detail page for the exact format.",
  },
  {
    id: "faq-3",
    question: "Is the certificate recognised by employers?",
    answer:
      "Yes. Every Stimuli IQ certificate is digitally verifiable. An employer can scan its QR code or enter the certificate ID on our verification page to confirm it instantly.",
    answerText:
      "Yes. Every Stimuli IQ certificate is digitally verifiable. An employer can scan its QR code or enter the certificate ID on our verification page to confirm it instantly.",
  },
  {
    id: "faq-4",
    question: "What are the payment options?",
    answer:
      "We accept all major payment methods via Razorpay: UPI, credit/debit cards, net banking, and wallets. Coupon codes can be applied at checkout for additional discounts.",
    answerText:
      "We accept all major payment methods via Razorpay: UPI, credit/debit cards, net banking, and wallets. Coupon codes can be applied at checkout for additional discounts.",
  },
  {
    id: "faq-5",
    question: "What is the refund policy?",
    answer:
      "Our courses are crafted with care and commitment, and as such, we do not offer refunds. We believe in the value and quality of our educational services!",
    answerText:
      "Our courses are crafted with care and commitment, and as such, we do not offer refunds. We believe in the value and quality of our educational services!",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Enroll",
    description:
      "Choose an internship program, complete payment, and get instant access to the learning portal. The whole process takes under 5 minutes.",
  },
  {
    title: "Learn live + recorded",
    description:
      "Attend live sessions led by clinicians, rewatch recorded lectures at your own pace, and study from a growing library of case material.",
  },
  {
    title: "Build real projects",
    description:
      "Apply your skills on live case studies evaluated by mentors. Your portfolio of completed case studies and research papers is what sets you apart.",
  },
  {
    title: "Get certified",
    description:
      "Earn a verifiable certificate after assessment. Your gateway into healthcare careers — powered by mentor referrals and a community.",
  },
];

/** Map a live CRM testimonial into the spotlight card's shape. rating is a 0-50 (×10) scale. */
function toTestimonialItem(t: PublicTestimonial): TestimonialSpotlightItem {
  return {
    id: t.id,
    quote: t.quote,
    studentName: t.studentName,
    // rating is stored 0-50 (x10 scale, see prisma model Testimonial) -> 0-5 stars.
    ratingStars: t.rating != null ? Math.round(t.rating / 10) : undefined,
    avatarSrc: t.studentPhotoUrl ?? undefined,
    // `college` has no column on Testimonial yet, so the card's eyebrow stays empty for
    // CRM-authored entries. Tracked in docs/phase-11-followups.md.
    program: t.programTitle ?? undefined,
  };
}

export function HomePageFallback({
  exploreCourses,
  colleges = [],
  testimonials = [],
}: {
  exploreCourses: PublicProgramSummary[];
  /** Live CRM college partners; falls back to a hardcoded showcase when empty. */
  colleges?: PublicPartner[];
  /** Live CRM testimonials. Empty ⇒ the testimonials section is omitted (no stand-in). */
  testimonials?: PublicTestimonial[];
}) {
  // CRM-managed only. Empty (clean DB, nothing published yet, or a failed fetch) means the
  // section below does not render at all — see the comment there.
  const testimonialItems = testimonials.map(toTestimonialItem);

  return (
    <main id="main-content" className="flex flex-col" data-testid="homepage">
      <HeroCentered />
      <BrainShowcase />
      {/* Placed directly under the hero pairing — the first section a visitor reaches
          after the headline. Its `.section-band` tint separates it from the plain-`bg`
          hero above and StatsBento below without repeating the brand tint WhyUs uses
          further down. Renders nothing when disabled (lib/workshop.ts). */}
      <UpcomingWorkshopBand />
      <StatsBento />
      {/* showScholarshipBadge={false}: homepage only. Scholarship availability is still
          surfaced on /programs, /programs/city/[citySlug] and the program detail page. */}
      <ExploreCourses programs={exploreCourses} showScholarshipBadge={false} />
      <WhyUsSection />

      <section aria-label="How it works" data-testid="how-it-works" className="py-16 lg:py-20">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-fg md:text-4xl">
              How It <span className="text-chart-3">Works</span>
            </h2>
            <p className="mt-3 text-lg text-fg-muted">From enrolment to certification in four clear steps.</p>
          </div>
          <HowItWorksSteps steps={HOW_IT_WORKS} />
        </div>
      </section>

      {/* The mentors teaser used to sit here. Removed from the homepage on request —
          mentors remain reachable via the "Mentors" nav link and /mentors. */}

      {/* Rendered ONLY when the CRM has published testimonials. There is deliberately no
          hardcoded stand-in: this section is student endorsements on a healthcare-training
          site, and inventing named students at named medical colleges to fill the space is
          not a layout decision, it is fabricated social proof. An absent section is honest;
          a populated fake one is not. /testimonials already behaved this way ("No
          testimonials yet"), so the two surfaces now agree.
          Add and PUBLISH entries at CRM → Marketing → Testimonials to bring it back. */}
      {testimonialItems.length > 0 ? (
        <section aria-label="Student testimonials" data-testid="testimonials" className="section-band py-16 lg:py-20">
          <div className="mx-auto max-w-screen-xl px-4 md:px-6">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold text-fg md:text-4xl">
                What Our <span className="text-chart-3">Students</span> Say
              </h2>
              <p className="mt-3 text-lg text-fg-muted">Real stories from medical students who started their careers with Stimuli IQ.</p>
            </div>
            <TestimonialSpotlight items={testimonialItems} />
          </div>
        </section>
      ) : null}

      <PartnerColleges colleges={colleges} />

      <section aria-label="Frequently asked questions" data-testid="homepage-faq" className="py-16">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold text-fg md:text-4xl">
              Frequently Asked <span className="text-chart-3">Questions</span>
            </h2>
          </div>
          <div className="mx-auto max-w-2xl">
            <FaqAccordion items={FAQ_ITEMS} />
          </div>
          <div className="mt-8 text-center">
            <a href="/faq" className="text-sm font-medium text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:underline">
              View all FAQs &rarr;
            </a>
          </div>
        </div>
      </section>

      <section aria-label="Talk to a counsellor" data-testid="cta-band" className="bg-brand-500 py-20 lg:py-24">
        <div className="mx-auto max-w-screen-xl px-4 text-center md:px-6">
          <h2 className="text-3xl font-bold text-white md:text-4xl">Not sure which internship is right for you?</h2>
          <p className="mt-4 text-lg text-brand-100">
            Book a free 30-minute counselling session with a program advisor who will help you choose, with no pressure to enrol.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={BOOK_SLOT_HREF}
              className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-white px-8 text-base font-semibold text-brand-600 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-500"
            >
              Book Free Slot
            </a>
            <a
              href="/programs"
              className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-white/30 px-8 text-base font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-500"
            >
              Browse Programs
            </a>
          </div>

          <div className="mx-auto mt-12 max-w-md text-left">
            <LeadFormConnected
              source="homepage-cta-band"
              heading="Or get a callback"
              subheading="Leave your details and a mentor will call you within 24 hours."
              fields={["name", "phone", "email"]}
              submitLabel="Request a Callback"
              data-testid="homepage-lead-form"
            />
          </div>
        </div>
      </section>
    </main>
  );
}
