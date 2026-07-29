/**
 * HeroCentered — homepage hero (black & white redesign).
 *
 * Matches the reference layout: subtle tile-pattern background, centered
 * trust badge (laurels + 5 stars), oversized two-line headline, muted
 * subheading, and a black pill CTA with a white circular arrow chip.
 * Floating photo cards with stat badges flank the content on lg+ screens
 * (hidden on mobile — the center column stays the focus).
 *
 * Server Component — purely presentational, no client JS.
 *
 * a11y: single h1, star rating has an sr-only text equivalent, decorative
 * images use empty alt, CTA is ≥44px with a visible focus ring.
 *
 * Assets live in public/images/hero/ (copied from /asserts).
 */
import Image from "next/image";

const LEFT_PHOTO_SRC = "/images/hero/image-1.jpg";
const RIGHT_PHOTO_SRC = "/images/hero/image-2.jpg";

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-3.3 3.1-5 7-5s7 1.7 7 5" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="m16 10 6-3v10l-6-3" />
    </svg>
  );
}

/** Floating stat badge (white card overlapping a photo). */
function StatBadge({
  icon,
  value,
  label,
  className = "",
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-border bg-card p-3 pr-5 shadow-md ${className}`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-fg">
        {icon}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-base font-bold text-fg">{value}</span>
        <span className="max-w-[11rem] text-sm text-fg-muted">{label}</span>
      </span>
    </div>
  );
}

export function HeroCentered() {
  return (
    <section
      aria-label="Hero"
      data-testid="homepage-hero"
      className="relative overflow-hidden bg-bg"
    >
      {/* Tile-pattern background (decorative) */}
      <div aria-hidden="true" className="absolute inset-0">
        <Image
          src="/images/hero/hero-background.avif"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      </div>

      <div className="relative mx-auto max-w-screen-2xl px-4 pb-20 pt-8 md:px-6 lg:pb-32 lg:pt-12">
        {/* Left floating photo card (lg+) */}
        <div className="absolute left-[6%] top-1/2 hidden -translate-y-1/2 lg:block xl:left-[9%]">
          <div className="relative">
            <Image
              src={LEFT_PHOTO_SRC}
              alt=""
              width={200}
              height={250}
              className="h-[250px] w-[200px] rounded-2xl object-cover shadow-md"
            />
            <StatBadge
              icon={<UserIcon />}
              value="Mentors"
              label="From real clinical & healthcare backgrounds"
              className="absolute -bottom-8 left-1/2 w-max -translate-x-1/2"
            />
          </div>
        </div>

        {/* Right floating photo card (lg+) */}
        <div className="absolute right-[4%] top-1/2 hidden -translate-y-1/2 lg:block xl:right-[7%]">
          <div className="relative">
            <Image
              src={RIGHT_PHOTO_SRC}
              alt=""
              width={220}
              height={240}
              className="h-[240px] w-[220px] rounded-2xl object-cover object-top shadow-md"
            />
            <StatBadge
              icon={<VideoIcon />}
              value="Structured Training"
              label="+ Internship Tracks"
              className="absolute -bottom-8 left-1/2 w-max -translate-x-1/2"
            />
          </div>
        </div>

        {/* Center content */}
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          {/* Trust badge: laurels + stars + caption */}
          <div className="flex items-center gap-3">
            <img
              src="/images/hero/left-leaf.png"
              alt=""
              aria-hidden="true"
              className="h-16 w-auto opacity-30"
            />
            <div className="flex flex-col items-center gap-1">
              <span aria-hidden="true" className="text-xl tracking-[0.35em] text-fg">
                &#9733;&#9733;&#9733;&#9733;&#9733;
              </span>
              <span className="sr-only">Rated 5 out of 5.</span>
              <p className="text-base font-medium text-fg">
                Trusted by aspiring healthcare professionals across India
              </p>
            </div>
            <img
              src="/images/hero/right-leaf.png"
              alt=""
              aria-hidden="true"
              className="h-16 w-auto opacity-30"
            />
          </div>

          {/* Headline */}
          <h1 className="mt-8 font-display text-5xl font-bold leading-[1.05] tracking-tight text-fg sm:text-6xl lg:text-7xl">
            Build the skills real
            <br />
            <span className="text-chart-3">healthcare careers</span> demand.
          </h1>

          {/* Subheading */}
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-fg-muted">
            Stimuli IQ helps health science students bridge the gap between
            classroom learning and clinical practice &mdash; through structured
            training, real internships, and mentorship from healthcare
            industry experts.
          </p>

          {/* CTA */}
          <a
            href="/programs"
            className="group mt-10 inline-flex min-h-[44px] items-center gap-4 rounded-full bg-brand-500 py-2 pl-8 pr-2 text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Explore our programs
            <span
              aria-hidden="true"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-fg transition-transform duration-fast group-hover:translate-x-0.5"
            >
              <ArrowRightIcon />
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
