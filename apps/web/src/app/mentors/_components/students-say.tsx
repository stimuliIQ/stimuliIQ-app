"use client";

/**
 * StudentsSay — "Happy Students Say About Our Courses" band for /mentors.
 *
 * Black & white take on the reference: two quote cards flanking a photo card
 * with a decorative play chip, and pagination dots below that page through
 * testimonial pairs. Static, verified student quotes (same set used on the
 * homepage) — no autoplay, the reader stays in control.
 *
 * a11y: dots are real buttons with labels + aria-pressed, quotes use
 * <blockquote>/<figcaption>, the photo is decorative. Page changes are
 * announced via the region's aria-live. Reduced motion: no fade transition.
 */
import { useState } from "react";
import Image from "next/image";

interface Quote {
  text: string;
  name: string;
  detail: string;
}

/** Pairs of quotes per dot page (left card, right card). */
const PAGES: Array<[Quote, Quote]> = [
  [
    {
      text: "The Full Stack program completely changed my career prospects. I went from zero to a frontend role at a Bangalore startup within 3 months of graduating.",
      name: "Aditya R.",
      detail: "Full Stack Web Development · NIT Warangal",
    },
    {
      text: "The live sessions with mentors from top companies made all the difference. I could ask real-world questions and get answers no textbook gives you.",
      name: "Priya S.",
      detail: "Python for Data Science · JNTU Hyderabad",
    },
  ],
  [
    {
      text: "The verifiable certificate was a major trust signal when I applied for jobs. Interviewers could actually check it on the platform.",
      name: "Rahul M.",
      detail: "Data Science & ML · Osmania University",
    },
    {
      text: "My mentor reviewed every project like a real code review at work. That feedback loop is what made me interview-ready.",
      name: "Sneha K.",
      detail: "DevOps & CI/CD · Anna University",
    },
  ],
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

function PlayChip() {
  return (
    <span
      aria-hidden="true"
      className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-fg shadow-md"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="ml-1 h-5 w-5"
      >
        <path d="M7 5.5v13l11-6.5-11-6.5Z" />
      </svg>
    </span>
  );
}

function QuoteCard({ quote }: { quote: Quote }) {
  return (
    <figure className="flex h-full flex-col justify-between rounded-2xl bg-card p-8 shadow-sm">
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
  const [page, setPage] = useState(0);
  const [left, right] = PAGES[page] ?? PAGES[0]!;

  return (
    <section
      aria-label="What students say about our courses"
      data-testid="students-say"
      className="border-t border-border bg-surface py-16 lg:py-24"
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <div className="mx-auto mb-12 max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            Happy students say about
            <br />
            <span className="text-chart-3">our courses</span>
          </h2>
        </div>

        <div aria-live="polite" className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
          <QuoteCard quote={left} />

          {/* Center photo card (decorative) */}
          <div
            aria-hidden="true"
            className="relative order-first min-h-[320px] overflow-hidden rounded-2xl shadow-sm lg:order-none lg:min-h-0"
          >
            <Image
              src="/images/hero/person.avif"
              alt=""
              fill
              sizes="(min-width: 1024px) 33vw, 100vw"
              className="object-cover grayscale"
            />
            <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-fg/70 via-transparent to-transparent p-6">
              <div>
                <p className="text-lg font-bold text-white">15,000+ students</p>
                <p className="text-sm text-white/80">have made the jump</p>
              </div>
              <PlayChip />
            </div>
          </div>

          <QuoteCard quote={right} />
        </div>

        {/* Dots */}
        <div className="mt-10 flex items-center justify-center gap-2.5" role="group" aria-label="Testimonial pages">
          {PAGES.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setPage(index)}
              aria-label={`Show testimonials ${index + 1} of ${PAGES.length}`}
              aria-pressed={page === index}
              className={[
                "h-2.5 rounded-full transition-all duration-base",
                page === index ? "w-7 bg-fg" : "w-2.5 bg-fg/20 hover:bg-fg/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              ].join(" ")}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
