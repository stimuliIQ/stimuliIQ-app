/**
 * StudentsSay — "Happy Students Say About Our Courses" band for /mentors.
 *
 * Single view, no pagination: the branded portrait artwork sits in the middle
 * with TWO stacked quote cards on each side (all four verified student quotes
 * visible at once). The old dot-paging read as "there are two images" and is
 * gone — with it, the component needs no client JS at all (server component).
 *
 * a11y: quotes use <blockquote>/<figcaption>, the artwork is decorative.
 */
import Image from "next/image";

interface Quote {
  text: string;
  name: string;
  detail: string;
}

const LEFT_QUOTES: Quote[] = [
  {
    text: "The Clinical Research internship changed my career prospects completely. Within 3 months of finishing, I joined a research team at a Bangalore hospital.",
    name: "Aditya R.",
    detail: "Clinical Research · Government Medical College, Warangal",
  },
  {
    text: "The verifiable certificate was a major trust signal when I applied for postings. Interviewers could actually check it on the platform.",
    name: "Rahul M.",
    detail: "Public Health & Data · Osmania University",
  },
];

const RIGHT_QUOTES: Quote[] = [
  {
    text: "The live sessions with practising clinicians made all the difference. I could ask questions about real cases and get answers that no textbook gives you.",
    name: "Priya S.",
    detail: "Hospital Administration · Osmania Medical College, Hyderabad",
  },
  {
    text: "My mentor reviewed every case study like a real ward round. That feedback loop is what made me feel genuinely prepared for practice.",
    name: "Sneha K.",
    detail: "Clinical Psychology · Andhra University",
  },
];

function QuoteMark() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-9 w-9 text-fg"
    >
      <path d="M10 7H6a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h2a2 2 0 0 0 2-2v-5a13 13 0 0 0 0-3Zm11 0h-4a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h2a2 2 0 0 0 2-2v-5a13 13 0 0 0 0-3Z" />
    </svg>
  );
}

function QuoteCard({ quote }: { quote: Quote }) {
  return (
    <figure className="flex flex-1 flex-col justify-between rounded-2xl bg-card p-8 shadow-sm">
      <div>
        <QuoteMark />
        <blockquote className="mt-5 text-base leading-relaxed text-fg-muted">
          {quote.text}
        </blockquote>
      </div>
      <figcaption className="mt-8">
        <p className="text-lg font-bold text-fg">{quote.name}</p>
        <p className="mt-0.5 text-sm text-fg-muted">{quote.detail}</p>
      </figcaption>
    </figure>
  );
}

export function StudentsSay() {
  return (
    <section
      aria-label="What students say about our courses"
      data-testid="students-say"
      className="section-band py-16 lg:py-24"
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <div className="mx-auto mb-12 max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            Happy students say about
            <br />
            <span className="text-chart-3">our courses</span>
          </h2>
        </div>

        {/* md: artwork spans the row, the two quote stacks sit side by side. Without
            that step the grid went 1 → 3 columns at lg, so every tablet stacked four
            ~780px-wide quote cards and the section ran nearly 1900px tall. */}
        <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-6">
            {LEFT_QUOTES.map((quote) => (
              <QuoteCard key={quote.name} quote={quote} />
            ))}
          </div>

          {/* Center visual card (decorative) — the branded "Happy Students"
              composition (portrait, 1024×1536). The artwork carries its own
              headline/badge, so the old dark gradient + "15,000+ students"
              overlay and play chip are gone (the count was an unverifiable
              stat anyway). The box is LOCKED to the image's own 2:3 aspect at
              every breakpoint so the logo (top) and badge (bottom) are never
              cropped — it sets the row height, and the stacked quote cards on
              either side stretch to fill it. */}
          <div
            aria-hidden="true"
            // Width cap below lg for the same reason as the Why-Us portrait: once the
            // 3-column grid collapses, a full-width 2:3 box runs ~1150px tall on a
            // tablet. Capping width keeps the artwork uncropped and proportionate.
            className="relative order-first mx-auto aspect-[2/3] w-full max-w-[300px] overflow-hidden rounded-2xl shadow-sm sm:max-w-[340px] md:col-span-2 lg:order-none lg:col-span-1 lg:max-w-none"
          >
            <Image
              src="/images/happy-students.webp"
              alt=""
              fill
              sizes="(min-width: 1024px) 33vw, 100vw"
              className="object-cover"
            />
          </div>

          <div className="flex flex-col gap-6">
            {RIGHT_QUOTES.map((quote) => (
              <QuoteCard key={quote.name} quote={quote} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
