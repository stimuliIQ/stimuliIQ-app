/**
 * WhyUsSection — homepage "Why StimuliiQ?" block (black & white redesign).
 *
 * Matches the reference layout: centered heading + two-line subtext over a
 * light-grey band, then a 3-column composition — two stacked white cards on
 * the left, a full-height photo in the middle, two stacked cards on the
 * right. Each card: circular icon chip, generous whitespace, bold title,
 * muted two-line description.
 *
 * Server Component — purely presentational, no client JS.
 *
 * Responsive: below lg the columns stack in DOM order (2 cards → photo →
 * 2 cards); the photo gets a fixed min-height since it can no longer size
 * from its neighbours.
 *
 * a11y: section landmark with aria-label, h2 + h3 hierarchy, decorative
 * icons/photo hidden from screen readers.
 */
import Image from "next/image";

// ---------------------------------------------------------------------------
// Icons (inline SVG, stroke = currentColor)
// ---------------------------------------------------------------------------

function MentorIcon() {
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
      className="h-6 w-6"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-3.3 3.1-5 7-5s7 1.7 7 5" />
    </svg>
  );
}

function PricingIcon() {
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
      className="h-6 w-6"
    >
      {/* Indian rupee sign */}
      <path d="M6 3h12" />
      <path d="M6 8h12" />
      <path d="m6 13 8.5 8" />
      <path d="M6 13h3c5 0 5-10 0-10" />
    </svg>
  );
}

function TrophyIcon() {
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
      className="h-6 w-6"
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

function StarIcon() {
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
      className="h-6 w-6"
    >
      <path d="M11.5 3.4a.53.53 0 0 1 1 0l2.1 4.9 5.3.5c.46.04.65.62.3.93l-4 3.5 1.2 5.2a.53.53 0 0 1-.8.57L12 16.3 7.4 19a.53.53 0 0 1-.8-.57l1.2-5.2-4-3.5a.53.53 0 0 1 .3-.93l5.3-.5 2.1-4.9Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const LEFT_CARDS = [
  {
    icon: <MentorIcon />,
    title: "Expert Mentors",
    description:
      "Our mentors are practicing healthcare professionals and psychologists, dedicated to your success.",
  },
  {
    icon: <PricingIcon />,
    title: "Affordable Pricing",
    description:
      "High-quality, mentor-led training priced for students — with scholarships.",
  },
];

const RIGHT_CARDS = [
  {
    icon: <TrophyIcon />,
    title: "Structured Career Pathway",
    description:
      "Backed by a growing network of healthcare mentors, alumni, and medical referrals.",
  },
  {
    icon: <StarIcon />,
    title: "Student Reviews",
    description:
      "Built on feedback from students who've completed our training and internship programs.",
  },
];

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function WhyUsCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 flex-col rounded-2xl bg-card p-7 shadow-sm">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-fg"
      >
        {icon}
      </span>
      <h3 className="mt-12 text-2xl font-bold text-fg">{title}</h3>
      <p className="mt-3 max-w-xs text-base leading-relaxed text-fg-muted">
        {description}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function WhyUsSection() {
  return (
    <section
      aria-label="Why choose StimuliiQ"
      data-testid="why-us"
      className="border-t border-border bg-surface py-16 lg:py-24"
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        {/* Heading */}
        <div className="mx-auto mb-12 max-w-xl text-center lg:mb-16">
          <h2 className="font-display text-4xl font-bold tracking-tight text-fg md:text-5xl">
            Why <span className="text-chart-3">Stimuli IQ</span>?
          </h2>
          <p className="mx-auto mt-5 max-w-md text-lg leading-relaxed text-fg-muted">
            We focus on what actually prepares you for a real healthcare
            career &mdash; real training, real clinical exposure, real
            mentorship.
          </p>
        </div>

        {/* 2 cards | artwork | 2 cards. The centre column is the NARROW one
            (1fr vs 1.15fr sides): the portrait artwork's aspect ratio sets the
            row height, so a narrower centre keeps the whole band from growing
            too tall while the flanking cards stretch to match. */}
        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[1.15fr_1fr_1.15fr]">
          <div className="flex flex-col gap-6">
            {LEFT_CARDS.map((card) => (
              <WhyUsCard key={card.title} {...card} />
            ))}
          </div>

          {/* Center visual (decorative) — the branded team composition (portrait,
              941×1672). The box is LOCKED to the image's own aspect at every
              breakpoint so the logo (top) and badge (bottom) are never cropped
              — it sets the row height and the flanking cards stretch to it. */}
          <div aria-hidden="true" className="relative aspect-[941/1672]">
            <Image
              src="/images/why-us-team-portrait.webp"
              alt=""
              fill
              sizes="(min-width: 1024px) 33vw, 100vw"
              className="rounded-2xl object-cover"
            />
          </div>

          <div className="flex flex-col gap-6">
            {RIGHT_CARDS.map((card) => (
              <WhyUsCard key={card.title} {...card} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
