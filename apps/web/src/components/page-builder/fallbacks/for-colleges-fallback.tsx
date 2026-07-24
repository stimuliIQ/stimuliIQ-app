/**
 * ForCollegesPageFallback — the pre-Phase-10 hardcoded For Colleges page body, preserved
 * verbatim as the resilience fallback for `app/for-colleges/page.tsx`
 * (docs/specs/phase-10-page-builder.md item B).
 */
const ITEMS = [
  { title: "Campus Training Programs", desc: "Tailored 8–16 week programs delivered on-campus or hybrid. We handle curriculum, mentors, and assessments." },
  { title: "Placement Drives", desc: "Connect your students with our 150+ hiring partners. We run dedicated placement drives for partner colleges." },
  { title: "Internship Certification", desc: "Students earn verifiable StimuliiQ certificates recognised across India's tech industry." },
  { title: "Faculty Development", desc: "Upskill your faculty with our industry-grade curriculum workshops and teaching resources." },
];

export function ForCollegesPageFallback() {
  return (
    <>
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-fg sm:text-4xl">
          For <span className="text-chart-3">Colleges</span>
        </h1>
        <p className="mt-3 text-lg text-fg-muted">Partner with us to give your students industry-grade training and placement support.</p>
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
        <h2 className="mb-2 text-xl font-bold text-fg">Ready to partner with us?</h2>
        <p className="mb-6 text-sm text-fg-muted">Email our college partnerships team or schedule a call to discuss your institution's needs.</p>
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
