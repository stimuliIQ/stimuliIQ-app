/**
 * AboutPageFallback — the pre-Phase-10 hardcoded About page body, preserved verbatim as
 * the resilience fallback for `app/about/page.tsx` (docs/specs/phase-10-page-builder.md
 * item B). Breadcrumbs + JSON-LD are hoisted to the thin wrapper (rendered identically on
 * both the CMS and fallback paths) — everything else here is unchanged from the original.
 */
import Image from "next/image";
import { StatBand, TestimonialCard } from "@repo/ui";
import type { StatItem } from "@repo/ui";
import { BOOK_SLOT_HREF } from "../../shell/nav-config";

const STATS: StatItem[] = [
  { value: 15000, label: "Students trained", suffix: "+" },
  { value: 30, label: "Programs", suffix: "+" },
  { value: 89, label: "Placement rate", suffix: "%" },
  { value: 200, label: "Hiring partners", suffix: "+" },
];

const JOURNEY = [
  {
    step: "01",
    title: "Discover the right program",
    description:
      "Browse 30+ project-based programs across software, data, cloud, and design — or book a free counselling slot and let a mentor guide your choice. Transparent pricing, 0% EMI, no hidden fees.",
  },
  {
    step: "02",
    title: "Learn live and on-demand",
    description:
      "Our learning portal combines scheduled live sessions with industry mentors and recorded video lessons you can rewatch anytime. Track your own progress and attendance in one place.",
  },
  {
    step: "03",
    title: "Build real projects",
    description:
      "Every program is structured around industry-grade projects — reviewed by working engineers, not graders. Your portfolio becomes the proof employers actually look at.",
  },
  {
    step: "04",
    title: "Earn a verifiable certificate",
    description:
      "Finish your assessment and receive a certificate with a unique ID and QR code. Any employer can verify it on our public verification page in seconds — no fake credentials, ever.",
  },
  {
    step: "05",
    title: "Get placed",
    description:
      "Resume reviews, mock interviews, and direct referrals into our network of 200+ hiring partners. We stay with you until you sign your offer — that's how we get to 89%.",
  },
];

const PILLARS = [
  { icon: "lms", title: "A structured learning portal", description: "One dashboard for lessons, live classes, assignments, progress, and attendance — built for focus, not distraction." },
  { icon: "mentor", title: "Mentors who do the job", description: "Active engineers and data scientists from top companies — people who ship code, review yours." },
  { icon: "project", title: "Projects, not just lectures", description: "Assignments and capstone projects modelled on real industry work, individually evaluated with feedback." },
  { icon: "certificate", title: "Certificates employers can check", description: "Every certificate carries a unique ID and QR code, instantly verifiable on our public portal." },
  { icon: "placement", title: "A real placement engine", description: "Referrals to 200+ hiring partners, interview prep, and placement tracking — not a PDF of job links." },
  { icon: "pricing", title: "Student-first pricing", description: "Priced for students in India, with 0% EMI plans and a 7-day no-questions-asked refund policy." },
] as const;

const TESTIMONIALS = [
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

const COMMITMENTS = [
  { title: "7-day refund", description: "Not satisfied? Full refund within 7 days, no questions asked." },
  { title: "Transparent pricing", description: "The price you see is the price you pay — 0% EMI available." },
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
      <section aria-label="About StimuliiQ" className="mx-auto max-w-screen-xl px-4 pt-10 md:px-6">
        <div className="mx-auto max-w-3xl pb-16 text-center lg:pb-24">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fg-muted">About StimuliiQ</p>
          <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight text-fg sm:text-5xl lg:text-6xl">
            We bridge the gap between
            <br />
            <span className="text-chart-3">college and career</span>.
          </h1>
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-fg-muted">
            StimuliiQ is an internship-training platform for India&apos;s B.Tech, Degree, Diploma, MCA, and MBA students. We teach the way industry works — live mentors, real
            projects, verifiable certificates — so your first job doesn&apos;t depend on your college tier.
          </p>
        </div>
      </section>

      <section aria-label="Our story" className="border-t border-border py-16 lg:py-24">
        <div className="mx-auto grid max-w-screen-xl grid-cols-1 items-center gap-12 px-4 md:px-6 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
              Why we <span className="text-chart-3">exist</span>
            </h2>
            <div className="mt-6 flex flex-col gap-5 text-base leading-relaxed text-fg-muted">
              <p>
                Every year, hundreds of thousands of Indian engineering graduates struggle to land their first job — not because they lack intelligence, but because college
                curriculums don&apos;t match what companies actually need.
              </p>
              <p>
                Our founders — engineers from Hyderabad, Bangalore, and Pune — lived that gap themselves. In 2021 they built StimuliiQ to close it: a system where students learn
                by building, are mentored by people who do the job, and graduate with proof employers can check.
              </p>
              <p className="font-medium text-fg">
                Our mission: give every Indian student — regardless of college tier — access to the training they need to build a real tech career.
              </p>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            <Image src="/images/hero/person.avif" alt="" aria-hidden="true" width={448} height={520} className="h-[420px] w-full rounded-2xl object-cover shadow-md lg:h-[520px]" />
            <div className="absolute -left-4 bottom-8 flex items-center gap-3 rounded-xl border border-border bg-card p-3 pr-5 shadow-md">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-fg">
                <CheckIcon />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-base font-bold text-fg">Since 2021</span>
                <span className="text-sm text-fg-muted">Built by engineers</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <StatBand stats={STATS} data-testid="about-stats" />

      <section aria-label="How StimuliiQ helps students" className="py-16 lg:py-24">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mx-auto mb-12 max-w-xl text-center lg:mb-16">
            <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
              How the <span className="text-chart-3">system works</span> for you
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-fg-muted">One guided journey from first click to first offer.</p>
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

      <section aria-label="What is inside the platform" className="border-t border-border bg-surface py-16 lg:py-24">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mx-auto mb-12 max-w-xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
              What&apos;s inside the <span className="text-chart-3">platform</span>
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-fg-muted">Everything a student needs — nothing they don&apos;t.</p>
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
            Every StimuliiQ certificate is publicly verifiable. Employers — paste a certificate ID or scan its QR code and see the result instantly.
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
              Students who made the <span className="text-chart-3">jump</span>
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

      <section aria-label="Our commitments" className="border-t border-border py-14">
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

      <section aria-label="Start your journey" className="border-t border-border bg-surface py-16 text-center lg:py-20">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            Your <span className="text-chart-3">career</span> won&apos;t wait. Neither should you.
          </h2>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="/programs"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-brand-500 px-8 text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Explore our courses
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
