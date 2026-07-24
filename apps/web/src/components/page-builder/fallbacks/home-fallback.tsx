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
import { MentorsTeaser } from "../../home/mentors-teaser";
import { StatsBento } from "../../home/stats-bento";
import { ExploreCourses } from "../../home/explore-courses";
import { TestimonialSpotlight } from "../../home/testimonial-spotlight";
import { BrainShowcase } from "../../home/brain-showcase";
import { HowItWorksSteps } from "../../home/how-it-works-steps";
import { PartnerColleges } from "../../home/partner-colleges";
import { BOOK_SLOT_HREF } from "../../shell/nav-config";
import { LeadFormConnected } from "../../leads/lead-form-connected";
import type { PublicProgramSummary, PublicMentorCard, PublicPartner, PublicTestimonial } from "@repo/types";
import type { TestimonialSpotlightItem } from "../../home/testimonial-spotlight";

const TESTIMONIALS: TestimonialSpotlightItem[] = [
  {
    id: "t1",
    quote:
      "The Full Stack program completely changed my career prospects. I went from zero to landing a frontend role at a Bangalore startup within 3 months of graduating.",
    studentName: "Aditya R.",
    college: "NIT Warangal",
    program: "Full Stack Web Development",
    ratingStars: 5 as const,
  },
  {
    id: "t2",
    quote:
      "The live sessions with mentors from top companies made all the difference. I could ask real-world questions and get answers that no textbook gives you.",
    studentName: "Priya S.",
    college: "JNTU Hyderabad",
    program: "Python for Data Science",
    ratingStars: 5 as const,
  },
  {
    id: "t3",
    quote:
      "The verifiable certificate was a major trust signal when I applied for jobs. Interviewers could actually check it on the platform — that's a huge differentiator.",
    studentName: "Rahul M.",
    college: "Osmania University",
    program: "Data Science & ML",
    ratingStars: 5 as const,
  },
];

const FAQ_ITEMS = [
  {
    id: "faq-1",
    question: "What qualifications do I need to enroll?",
    answer:
      "Our programs are designed for B.Tech, BCA, MCA, MBA, and Diploma students. No prior industry experience is required — just a willingness to learn and build real projects.",
    answerText:
      "Our programs are designed for B.Tech, BCA, MCA, MBA, and Diploma students. No prior industry experience is required — just a willingness to learn and build real projects.",
  },
  {
    id: "faq-2",
    question: "Are the classes live or recorded?",
    answer:
      "Most programs offer a hybrid format — scheduled live sessions with industry mentors plus recorded videos for flexible re-watching. Some programs are fully recorded (self-paced). Check the program detail page for the exact mode.",
    answerText:
      "Most programs offer a hybrid format — scheduled live sessions with industry mentors plus recorded videos for flexible re-watching. Some programs are fully recorded (self-paced). Check the program detail page for the exact mode.",
  },
  {
    id: "faq-3",
    question: "Is the certificate recognised by employers?",
    answer:
      "Yes. Every StimuliiQ certificate is digitally verifiable — employers can scan a QR code or enter the certificate ID on our verification page to confirm authenticity instantly. We have active hiring partnerships with 200+ companies.",
    answerText:
      "Yes. Every StimuliiQ certificate is digitally verifiable — employers can scan a QR code or enter the certificate ID on our verification page to confirm authenticity instantly. We have active hiring partnerships with 200+ companies.",
  },
  {
    id: "faq-4",
    question: "How do EMI options work?",
    answer:
      "We offer 0% EMI plans through partner payment providers. Choose your installment plan at checkout — the EMI amount and tenure are shown clearly before you pay. Your card or bank must support the selected tenure.",
    answerText:
      "We offer 0% EMI plans through partner payment providers. Choose your installment plan at checkout — the EMI amount and tenure are shown clearly before you pay. Your card or bank must support the selected tenure.",
  },
  {
    id: "faq-5",
    question: "What is the refund policy?",
    answer:
      "We offer a 7-day no-questions-asked refund if you're not satisfied after accessing the program. After 7 days, a pro-rated refund applies. See our full Refund Policy for details.",
    answerText:
      "We offer a 7-day no-questions-asked refund if you're not satisfied after accessing the program. After 7 days, a pro-rated refund applies. See our full Refund Policy for details.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Enroll",
    description:
      "Choose a program, complete payment, and get instant access to the LMS. The entire process takes under 5 minutes.",
  },
  {
    title: "Learn live + recorded",
    description:
      "Attend live mentor-led sessions, watch recorded videos at your pace, and access a growing library of resources.",
  },
  {
    title: "Build real projects",
    description:
      "Apply your skills on industry-grade projects evaluated by mentors. Your portfolio of completed projects is what employers see.",
  },
  {
    title: "Get certified & placed",
    description:
      "Earn a verifiable certificate after assessment. Access our placement network and get referred to 200+ hiring partners.",
  },
];

/** Map a live CRM testimonial into the spotlight card's shape. rating is a 0-50 (×10) scale. */
function toTestimonialItem(t: PublicTestimonial): TestimonialSpotlightItem {
  return {
    id: t.id,
    quote: t.quote,
    studentName: t.studentName,
    ratingStars: t.rating != null ? Math.round(t.rating / 10) : undefined,
    avatarSrc: t.studentPhotoUrl ?? undefined,
  };
}

export function HomePageFallback({
  exploreCourses,
  mentors,
  colleges = [],
  testimonials = [],
}: {
  exploreCourses: PublicProgramSummary[];
  mentors: PublicMentorCard[];
  /** Live CRM college partners; falls back to a hardcoded showcase when empty. */
  colleges?: PublicPartner[];
  /** Live CRM testimonials; falls back to the hardcoded set when empty. */
  testimonials?: PublicTestimonial[];
}) {
  // Prefer CRM-managed testimonials; keep the hardcoded set as the resilience fallback.
  const testimonialItems = testimonials.length > 0 ? testimonials.map(toTestimonialItem) : TESTIMONIALS;

  return (
    <main id="main-content" className="flex flex-col" data-testid="homepage">
      <HeroCentered />
      <BrainShowcase />
      <StatsBento />
      <ExploreCourses programs={exploreCourses} />
      <WhyUsSection />

      <section aria-label="How it works" data-testid="how-it-works" className="py-16 lg:py-20">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-fg md:text-4xl">
              How It <span className="text-chart-3">Works</span>
            </h2>
            <p className="mt-3 text-lg text-fg-muted">From enrollment to placement — a clear 4-step journey.</p>
          </div>
          <HowItWorksSteps steps={HOW_IT_WORKS} />
        </div>
      </section>

      <MentorsTeaser mentors={mentors} />

      <section aria-label="Student testimonials" data-testid="testimonials" className="bg-surface py-16 lg:py-20">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-fg md:text-4xl">
              What Our <span className="text-chart-3">Students</span> Say
            </h2>
            <p className="mt-3 text-lg text-fg-muted">Real stories from students who launched their careers with StimuliiQ.</p>
          </div>
          <TestimonialSpotlight items={testimonialItems} />
        </div>
      </section>

      <PartnerColleges colleges={colleges} />

      <section aria-label="Frequently asked questions" data-testid="homepage-faq" className="border-t border-border py-16">
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

      <section aria-label="Talk to a counsellor" data-testid="cta-band" className="border-t border-border bg-brand-500 py-20 lg:py-24">
        <div className="mx-auto max-w-screen-xl px-4 text-center md:px-6">
          <h2 className="text-3xl font-bold text-white md:text-4xl">Not sure which program is right for you?</h2>
          <p className="mt-4 text-lg text-brand-100">
            Book a free 30-minute counselling session with one of our program advisors. No pressure, just clarity.
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
