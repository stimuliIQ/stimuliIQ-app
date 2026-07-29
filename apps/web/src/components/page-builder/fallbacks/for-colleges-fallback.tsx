/**
 * ForCollegesPageFallback — the pre-Phase-10 hardcoded For Colleges page body, preserved
 * verbatim as the resilience fallback for `app/for-colleges/page.tsx`
 * (docs/specs/phase-10-page-builder.md item B).
 */
const ITEMS = [
  { title: "Campus Training Programs", desc: "Tailored 8 to 16 week internship programs delivered on campus or hybrid. We handle curriculum, mentors, and assessments." },
  { title: "Career Roadmaps & Guidance", desc: "Give your students access to structured career roadmaps for health sciences — built with mentor insights, real time opportunities, and guidance from our growing healthcare community." },
  { title: "Internship Certification", desc: "Students earn verifiable StimuliiQ certificates recognised by hospitals and healthcare employers across India." },
  { title: "Collaborate & Get Sponsored", desc: "Collaborate with us and get sponsorship support for your campus fests and events — helping your committee bring bigger, more impactful events." },
];

export function ForCollegesPageFallback() {
  return (
    <>
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-fg sm:text-4xl">
          For <span className="text-chart-3">Campus Communities</span>
        </h1>
        <p className="mt-3 text-lg text-fg-muted">Collaborate with us to bring hands-on healthcare training, workshops, mentorship, and career exposure to your fellow students.</p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        {ITEMS.map((item) => (
          <div key={item.title} className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold text-fg">{item.title}</h2>
            <p className="text-sm text-fg-muted leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-xl border border-brand-100 bg-brand-50 p-8 text-center">
        <h2 className="mb-2 text-xl font-bold text-fg">Ready to collaborate with us?</h2>
        <p className="mb-6 text-sm text-fg-muted">Reach out to our campus team or grab a quick call — let&apos;s figure out what works for your committee.</p>
        <a
          href="mailto:colleges@stimuliiq.com"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Contact College Partnerships Team
        </a>
      </div>
    </>
  );
}
