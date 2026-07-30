/**
 * AboutPageFallback — the pre-Phase-10 hardcoded About page body, preserved verbatim as
 * the resilience fallback for `app/about/page.tsx` (docs/specs/phase-10-page-builder.md
 * item B). Breadcrumbs + JSON-LD are hoisted to the thin wrapper (rendered identically on
 * both the CMS and fallback paths) — everything else here is unchanged from the original.
 */
import Image from "next/image";
import { TestimonialCard } from "@repo/ui";
import { BOOK_SLOT_HREF } from "../../shell/nav-config";
import { BrandMarkBand } from "../hero-motif";

const JOURNEY = [
  {
    step: "01",
    title: "Discover the right program",
    description:
      "Browse programs across psychology, neurology, clinical research, and allied health sciences — or book a free counselling slot and let a mentor guide your choice. Transparent pricing, easy pre-registration, no hidden fees.",
  },
  {
    step: "02",
    title: "Learn live and on-demand",
    description:
      "Our learning portal combines scheduled live sessions with clinician mentors and recorded lessons you can rewatch anytime. Your progress and attendance stay visible in one place.",
  },
  {
    step: "03",
    title: "Build real case studies",
    description:
      "Every program is structured around real-world case studies and practice scenarios — reviewed by working healthcare professionals, not graders. Your portfolio becomes the proof that shows you're genuinely prepared.",
  },
  {
    step: "04",
    title: "Earn a verifiable certificate",
    description:
      "Finish your assessment and receive a certificate with a unique ID and QR code. Any employer can verify it on our public verification page in seconds.",
  },
  {
    step: "05",
    title: "Get career ready",
    description:
      "Portfolio reviews, counselling sessions, and direct referrals through our network.",
  },
];

const PILLARS = [
  { icon: "lms", title: "A structured learning portal", description: "One dashboard for lessons, live classes, assignments, progress, and attendance." },
  { icon: "mentor", title: "Mentors who do the job", description: "Active healthcare professionals and psychologists from real practice — people who work in the field, and guide yours." },
  { icon: "project", title: "Case studies & research, not just lectures", description: "Assignments and capstone case studies modelled on real healthcare practice, individually evaluated with feedback." },
  { icon: "certificate", title: "Certificates employers can check", description: "Every certificate carries a unique ID and QR code, instantly verifiable on our public portal." },
  { icon: "placement", title: "A growing career network", description: "Direct referrals through our network of healthcare mentors and alumni, with portfolio reviews and career guidance." },
  { icon: "pricing", title: "Student-first pricing", description: "Priced for students in India, with simple pre-registration and transparent, upfront costs." },
] as const;

const TESTIMONIALS = [
  {
    id: "t1",
    quote:
      "The Clinical Research internship changed my career prospects completely. Within 3 months of finishing, I joined a research team at a Bangalore hospital.",
    studentName: "Aditya R.",
    college: "Government Medical College, Warangal",
    program: "Clinical Research",
    ratingStars: 5 as const,
  },
  {
    id: "t2",
    quote:
      "The live sessions with practising clinicians made all the difference. I could ask questions about real cases and get answers that no textbook gives you.",
    studentName: "Priya S.",
    college: "Osmania Medical College, Hyderabad",
    program: "Hospital Administration",
    ratingStars: 5 as const,
  },
  {
    id: "t3",
    quote:
      "The verifiable certificate was a major trust signal when I applied for postings. Interviewers could actually check it on the platform, and that set my application apart.",
    studentName: "Rahul M.",
    college: "Osmania University",
    program: "Public Health & Data",
    ratingStars: 5 as const,
  },
];

const COMMITMENTS = [
  { title: "Mentor-led training", description: "Every program is guided by practicing healthcare professionals." },
  { title: "Transparent pricing", description: "The price you see is the price you pay — upfront, with no hidden fees." },
  { title: "Your data, protected", description: "DPDP-compliant privacy: consent-first analytics, no data resale." },
  { title: "Verified outcomes", description: "Ratings and reviews come from enrolled students only." },
];

function PillarIcon({ name }: { name: (typeof PILLARS)[number]["icon"] }) {
  const paths: Record<string, React.ReactNode> = {
    lms: (
      <>
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M3 9h18" />
        <path d="M12 22h.01" />
      </>
    ),
    mentor: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M5 20c0-3.3 3.1-5 7-5s7 1.7 7 5" />
      </>
    ),
    project: (
      <>
        <path d="m8 8-4 4 4 4" />
        <path d="m16 8 4 4-4 4" />
        <path d="m13 5-2 14" />
      </>
    ),
    certificate: (
      <>
        <circle cx="12" cy="9" r="5" />
        <path d="m9 13-1.5 8L12 18.5 16.5 21 15 13" />
      </>
    ),
    placement: (
      <>
        <rect x="3" y="8" width="18" height="12" rx="2" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        <path d="M3 13h18" />
      </>
    ),
    pricing: (
      <>
        <path d="M7 4h10" />
        <path d="M7 8h10" />
        <path d="m7 12 7 8" />
        <path d="M7 12h3.5c4.5 0 4.5-8 0-8" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      {paths[name]}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function AboutPageFallback() {
  return (
    <div data-testid="about-content">
      {/* Opening band: the logo alone, centred, with the halo rings animating around it.
          The page copy starts in the section below so nothing overlaps the mark — same
          order the CMS render path produces via `PageBlocks`. */}
      <BrandMarkBand />

      {/* No `border-t` — `BrandMarkBand` already draws the separator (see its comment). */}
      <section aria-label="About Stimuli IQ" className="px-4 py-14 md:px-6 lg:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fg-muted">About Stimuli IQ</p>
          <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight text-fg sm:text-5xl lg:text-6xl">
            We Bridge the Gap Between
            <br />
            Academics <span className="text-chart-3">and Real Practice</span>.
          </h1>
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-fg-muted">
            Stimuli IQ is a healthcare education and training platform for India&apos;s medical, psychology, and allied health science students. We teach the way healthcare
            actually works &mdash; live mentors, real clinical exposure, verifiable certificates &mdash; so your career readiness doesn&apos;t depend on your college tier.
          </p>
        </div>
      </section>

      <section aria-label="Our story" className="py-16 lg:py-24">
        <div className="mx-auto grid max-w-screen-xl grid-cols-1 items-center gap-12 px-4 md:px-6 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
              Why We <span className="text-chart-3">Exist</span>
            </h2>
            <div className="mt-6 flex flex-col gap-5 text-base leading-relaxed text-fg-muted">
              <p>
                Every year, thousands of Indian medical and psychology graduates step into their careers without the practical exposure the field actually demands &mdash;
                not because they lack knowledge, but because academic curriculums don&apos;t match what real clinical and healthcare practice requires.
              </p>
              <p>
                Our mentors lived that gap themselves. We built Stimuli IQ to close it: a system where students learn through real practice, are mentored by people who
                work in healthcare, and graduate with proof employers and institutions can trust.
              </p>
              <p className="font-medium text-fg">
                Our mission: give every Indian student &mdash; regardless of college tier &mdash; access to the training and mentorship they need to build a real career in
                healthcare.
              </p>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            {/* Kept in sync with the `why_we_exist` block of prisma/fixtures/builder-pages/about.json. */}
            <Image
              src="/images/about/why-we-exist.webp"
              alt='Stimuli IQ "Why We Exist" poster. Healthcare needs more skilled, confident, compassionate professionals who are ready for real-world challenges. Bridging the Gap: we bridge the gap between education and real-world healthcare. Empowering Futures: we empower learners with the skills, exposure, and mentorship they deserve. Building Better Healthcare: we exist to build a stronger, more compassionate, and future-ready healthcare community. Better training today. Better healthcare tomorrow.'
              width={1024}
              height={1536}
              className="h-auto w-full rounded-2xl shadow-md"
            />
          </div>
        </div>
      </section>

      <section aria-label="How Stimuli IQ helps students" className="py-16 lg:py-24">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mx-auto mb-12 max-w-xl text-center lg:mb-16">
            <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
              How the <span className="text-chart-3">Journey Works</span> for You
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-fg-muted">One guided journey from first step to career-ready.</p>
          </div>
          <ol role="list" className="mx-auto flex max-w-3xl flex-col">
            {JOURNEY.map((item, index) => (
              <li key={item.step} className="relative flex gap-6 pb-12 last:pb-0">
                {index < JOURNEY.length - 1 ? <span aria-hidden="true" className="absolute left-6 top-14 h-[calc(100%-3.5rem)] w-px bg-border" /> : null}
                <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-500 font-display text-sm font-bold text-white">
                  {item.step}
                </span>
                <div className="pt-2.5">
                  <h3 className="text-xl font-bold text-fg">{item.title}</h3>
                  <p className="mt-2 max-w-xl text-base leading-relaxed text-fg-muted">{item.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-label="What is inside the platform" className="section-band py-16 lg:py-24">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mx-auto mb-12 max-w-xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
              What&apos;s Inside the <span className="text-chart-3">Platform</span>
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-fg-muted">Everything a student needs to go from classroom to clinic.</p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((pillar) => (
              <div key={pillar.title} className="flex flex-col rounded-2xl bg-card p-7 shadow-sm">
                <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-fg">
                  <PillarIcon name={pillar.icon} />
                </span>
                <h3 className="mt-6 text-lg font-bold text-fg">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{pillar.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-label="Verify a certificate" className="bg-brand-500 py-16 lg:py-20">
        <div className="mx-auto max-w-screen-xl px-4 text-center md:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight text-white md:text-4xl">Don&apos;t take our word for it.</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-white/70">
            Every Stimuli IQ certificate is publicly verifiable. Employers can paste a certificate ID or scan its QR code and see the result instantly.
          </p>
          <a
            href="/verify"
            className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-white px-8 text-sm font-semibold uppercase tracking-[0.14em] text-fg transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-500"
          >
            Verify a certificate
          </a>
        </div>
      </section>

      <section aria-label="Student stories" className="py-16 lg:py-24">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mx-auto mb-12 max-w-xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
              Students Who Made the <span className="text-chart-3">Jump</span>
            </h2>
          </div>
          <ul role="list" className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <li key={t.id}>
                <TestimonialCard quote={t.quote} studentName={t.studentName} college={t.college} program={t.program} ratingStars={t.ratingStars} />
              </li>
            ))}
          </ul>
          <div className="mt-8 text-center">
            <a href="/testimonials" className="text-sm font-medium text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:underline">
              Read more stories &rarr;
            </a>
          </div>
        </div>
      </section>

      <section aria-label="Our commitments" className="py-14">
        <div className="mx-auto grid max-w-screen-xl grid-cols-1 gap-8 px-4 sm:grid-cols-2 md:px-6 lg:grid-cols-4">
          {COMMITMENTS.map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-fg">
                <CheckIcon />
              </span>
              <div>
                <h3 className="text-sm font-bold text-fg">{item.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Start your journey" className="section-band py-16 text-center lg:py-20">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            Your <span className="text-chart-3">First Posting</span> is Closer Than You Think.
          </h2>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="/programs"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-brand-500 px-8 text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Explore our programs
            </a>
            <a
              href={BOOK_SLOT_HREF}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-border bg-card px-8 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Book a free slot
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
