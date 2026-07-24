/**
 * GalleryPageFallback — the pre-Phase-10 hardcoded Gallery page body, preserved verbatim
 * as the resilience fallback for `app/gallery/page.tsx`
 * (docs/specs/phase-10-page-builder.md item B).
 */
const GALLERY_ITEMS = [
  { id: "g1", alt: "Students attending a live Python training session", caption: "Python Live Session — Cohort 14" },
  { id: "g2", alt: "Certificate distribution ceremony for Full Stack alumni", caption: "Certificate Ceremony — Full Stack Cohort 8" },
  { id: "g3", alt: "Mentor-led code review session for data science students", caption: "Data Science Code Review" },
  { id: "g4", alt: "Industry expert guest lecture on system design", caption: "System Design Masterclass" },
  { id: "g5", alt: "Students presenting their final capstone projects", caption: "Capstone Project Demo Day" },
  { id: "g6", alt: "Panel discussion with hiring partners at StimuliiQ campus event", caption: "Hiring Partner Connect 2026" },
];

export function GalleryPageFallback() {
  return (
    <>
      <header className="mb-12">
        <h1 className="text-3xl font-bold text-fg sm:text-4xl">Gallery</h1>
        <p className="mt-3 text-lg text-fg-muted">A glimpse into StimuliiQ learning sessions, events, and achievements.</p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list" data-testid="gallery-list">
        {GALLERY_ITEMS.map((item) => (
          <li key={item.id}>
            <figure className="overflow-hidden rounded-xl border border-border bg-card">
              <div aria-hidden="true" className="flex h-48 items-center justify-center bg-surface text-fg-subtle text-sm">
                [Image: {item.alt}]
              </div>
              <figcaption className="px-4 py-3 text-sm text-fg-muted">{item.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </>
  );
}
