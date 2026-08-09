/**
 * ScholarshipPageFallback — the pre-Phase-10 hardcoded Scholarship page body, preserved
 * verbatim as the resilience fallback for `app/scholarship/page.tsx`
 * (docs/specs/phase-10-page-builder.md item B).
 */
import Image from "next/image";
import { LeadFormConnected } from "../../leads/lead-form-connected";

const HERO_STATS = [
  { value: "Up to ₹1 Crore", label: "Total scholarship fund" },
  { value: "10,000+", label: "Students supported" },
  { value: "90%+", label: "Internship completion rate" },
];

const BENEFITS = [
  { title: "Completely merit and need based", description: "Awards are decided on academic merit and financial need, nothing else." },
  { title: "Up to 50% fee waiver", description: "No repayment, no service obligation. The waiver applies directly to your program fee." },
  { title: "Covers every Stimuli IQ program", description: "Psychology, Clinical & Counselling Psychology, Neurology, Healthcare Training, and Internship tracks are all eligible." },
  { title: "Open to students across India", description: "MBBS, BDS, BSc Nursing, Psychology, Life Sciences, Allied Health, and related degree students from any college or university can apply." },
  { title: "Extended mentor access", description: "Scholars get additional 1:1 sessions with clinician mentors and personalised career guidance throughout the program." },
];

const IMPACT_STATS = [
  { value: "₹50L+", label: "Already disbursed" },
  { value: "320+", label: "Scholars active" },
  { value: "85%", label: "Placement success" },
  { value: "40+", label: "Cities reached" },
];

const FUND_DISTRIBUTION = [
  { track: "Clinical Research", lakhs: 17.3 },
  { track: "Medical Coding & Billing", lakhs: 13.8 },
  { track: "Hospital Administration", lakhs: 11.4 },
  { track: "Public Health & Data", lakhs: 9.4 },
];

const PROCESS_STEPS = [
  { title: "Check your eligibility", description: "Fill the short application form below. It takes less than two minutes." },
  { title: "Submit your details", description: "Tell us your qualification, the program you want to join and your financial background." },
  { title: "Receive your scholarship award", description: "Applications are reviewed competitively and successful applicants are notified within days." },
  { title: "Enrol and prepare", description: "Join your program with the fee waiver applied, plus extended mentor sessions." },
  { title: "Complete your internship and get certified", description: "Finish the program and earn your verifiable certificate." },
];

export function ScholarshipPageFallback() {
  const maxLakhs = Math.max(...FUND_DISTRIBUTION.map((d) => d.lakhs));

  return (
    <main id="main-content" className="flex flex-col" data-testid="scholarship-page">
      <section aria-label="Stimuli IQ Scholarship Programme" data-testid="scholarship-hero" className="relative overflow-hidden section-band-top">
        <div aria-hidden="true" className="absolute inset-0 opacity-50">
          <Image src="/images/hero/hero-background.avif" alt="" fill priority sizes="100vw" className="object-cover" />
        </div>

        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/3 select-none whitespace-nowrap text-center font-display text-[10.5vw] font-bold uppercase leading-none tracking-tight text-fg opacity-[0.04]"
        >
          Scholarship
        </span>

        <div className="relative mx-auto max-w-screen-xl px-4 pt-8 md:px-6">
          <div className="mx-auto mt-8 flex max-w-4xl flex-col items-center text-center">
            <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight text-fg sm:text-6xl lg:text-7xl">
              Stimuli IQ <span className="text-chart-3">Scholarship</span>
              <br />
              Programme
            </h1>
          </div>

          {/* md step kept in sync with `hero-block.tsx`, which renders the CMS version. */}
          <div className="mt-10 grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:items-start lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:gap-4">
            <div className="order-2 flex flex-col items-start gap-6 lg:order-1">
              <div className="w-full rounded-xl border border-border bg-card p-6 shadow-sm">
                <p className="text-base leading-relaxed text-fg">
                  <span className="font-semibold text-brand-600">An initiative by Stimuli IQ</span> for meritorious and needy healthcare aspirants across the
                  world.
                </p>
              </div>
              <span aria-hidden="true" className="h-1 w-40 rounded-full bg-brand-500" />
              <div className="flex flex-wrap gap-3">
                <a
                  href="#apply"
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-brand-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Take an Eligibility Test <span aria-hidden="true">&rarr;</span>
                </a>
                <a
                  href="#how-it-works"
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-border bg-card px-6 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  See How It Works <span aria-hidden="true">&rarr;</span>
                </a>
              </div>
            </div>

            <div className="order-1 flex justify-center md:col-span-2 lg:order-2 lg:col-span-1 lg:-mb-16">
              <Image
                src="/images/scholarship/scholarship.png"
                alt=""
                width={740}
                height={1056}
                priority
                className="h-auto w-[280px] drop-shadow-xl sm:w-[340px] lg:w-[400px]"
              />
            </div>

            <div className="order-3 rounded-xl border border-border bg-card p-6 shadow-sm">
              <p className="text-base font-semibold leading-snug text-brand-600">Don&apos;t let financial setbacks hold you back from a successful healthcare career.</p>
              <div aria-hidden="true" className="mt-4 flex items-center">
                <span className="h-px flex-1 bg-border" />
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              </div>
              <p className="mt-4 text-sm leading-relaxed text-fg-muted">
                The Stimuli IQ Scholarship grants merit-and-need-based fee waivers of up to 50% on internship-training programs, with extended mentor access and job assistance
                included.
              </p>
            </div>
          </div>

          <dl
            data-testid="scholarship-stats"
            className="relative z-10 mb-16 mt-10 grid grid-cols-1 divide-y divide-border rounded-2xl border border-border bg-card shadow-lg sm:grid-cols-3 sm:divide-x sm:divide-y-0 lg:mx-16 lg:mt-0"
          >
            {HERO_STATS.map((stat) => (
              <div key={stat.label} className="flex flex-col gap-1 p-8 text-center">
                <dt className="order-2 text-sm text-fg-muted">{stat.label}</dt>
                <dd className="order-1 text-3xl font-bold text-brand-600 lg:text-4xl">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-label="Scholarship benefits" data-testid="scholarship-benefits" className="bg-bg py-16 lg:py-20">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-fg md:text-4xl">
              Built for every <span className="text-chart-3">healthcare career aspirant</span>
            </h2>
            <p className="mt-4 text-lg text-fg-muted">One scholarship, every program. Here is what it gives you.</p>
          </div>
          <ul role="list" className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li key={benefit.title}>
                <div className="flex h-full items-start gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-fg">{benefit.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-fg-muted">{benefit.description}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="apply" aria-label="Scholarship application form" data-testid="scholarship-apply" className="section-band py-16 scroll-mt-20">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-fg md:text-4xl">Application form</h2>
            <p className="mt-4 text-lg text-fg-muted">Leave your details and our scholarship team will call you within 24 hours to check your eligibility.</p>
          </div>
          <div className="mx-auto mt-10 max-w-md text-left">
            <LeadFormConnected
              source="scholarship-page"
              heading="Apply for the scholarship"
              subheading="Takes less than two minutes, and you do not need documents to start."
              fields={["name", "phone", "email"]}
              submitLabel="Apply for Scholarship"
              data-testid="scholarship-lead-form"
            />
          </div>
        </div>
      </section>

      <section aria-label="Scholarship impact" data-testid="scholarship-impact" className="bg-bg py-16 lg:py-20">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <h2 className="text-center text-3xl font-bold text-fg md:text-4xl">
            The <span className="text-chart-3">₹1 Crore</span> impact
          </h2>
          <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 items-center gap-10 md:grid-cols-2">
            <div>
              <h3 className="text-xl font-semibold leading-snug text-fg">
                Financial constraints should never stop a capable student from building a career in healthcare.
              </h3>
              <p className="mt-4 text-base leading-relaxed text-fg-muted">
                The fund is structured to democratise access to industry-grade internship training, and awards are spread across every track so students from any discipline can
                benefit.
              </p>
              <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
                {IMPACT_STATS.map((stat) => (
                  <div key={stat.label} className="flex flex-col gap-1 bg-card p-5">
                    <dt className="order-2 text-sm text-fg-muted">{stat.label}</dt>
                    <dd className="order-1 text-2xl font-bold text-brand-600">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <h3 className="text-base font-semibold text-fg">
                Fund distribution by track <span className="font-normal text-fg-muted">(in lakhs)</span>
              </h3>
              <ul role="list" className="mt-6 flex flex-col gap-5">
                {FUND_DISTRIBUTION.map((item) => (
                  <li key={item.track}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-fg">{item.track}</span>
                      <span className="text-sm font-semibold text-brand-600">₹{item.lakhs}L</span>
                    </div>
                    <div role="img" aria-label={`${item.track}: ${item.lakhs} lakhs`} className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${(item.lakhs / maxLakhs) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" aria-label="Scholarship application process" data-testid="scholarship-process" className="bg-bg py-16 lg:py-20 scroll-mt-20">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-fg md:text-4xl">
              Scholarship <span className="text-chart-3">Application Process</span>
            </h2>
            <p className="mt-4 text-lg text-fg-muted">Five steps from application to certified professional.</p>
          </div>
          <ol role="list" className="mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {PROCESS_STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-3">
                <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-brand-500 text-base font-bold text-brand-600">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="text-base font-semibold text-fg">{step.title}</h3>
                <p className="text-sm leading-relaxed text-fg-muted">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
