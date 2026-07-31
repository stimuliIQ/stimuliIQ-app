/**
 * WhyUsSection — homepage "Why Stimuli IQ?" block (black & white redesign).
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
    // `group` drives the hover treatment on the icon chip and title below.
    // focus-within mirrors :hover so the same affordance appears for keyboard
    // users if a card ever gains a focusable child (WCAG 2.2 §2.4.11).
    //
    // The resting card carries a real `border` and sits on a brand-tinted band. It
    // used to be `bg-card` (#ffffff) on `bg-surface` (#f7f8fa) with a transparent
    // ring — an 8/255 difference, so the cards were invisible as cards.
    //
    // Hover reads as a POP-OUT rather than a nudge: it lifts and scales, takes a
    // deep shadow and a brand ring, and `z-10` raises it above its neighbours so
    // the growth overlaps them instead of being clipped between them.
    <div
      className={[
        "group relative z-0 flex flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-sm",
        "ring-1 ring-transparent transition-[transform,box-shadow,border-color] duration-300 ease-out",
        "hover:z-10 hover:-translate-y-2 hover:scale-[1.03] hover:border-brand-500/40 hover:shadow-2xl hover:ring-brand-500/25",
        "focus-within:z-10 focus-within:-translate-y-2 focus-within:scale-[1.03] focus-within:border-brand-500/40 focus-within:shadow-2xl focus-within:ring-brand-500/25",
      ].join(" ")}
    >
      {/* Brand wash that fades up behind the content on hover. Decorative and
          pointer-events-none so it never intercepts a click on the card. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-50 via-transparent to-transparent opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 group-focus-within:opacity-100"
      />

      <span
        aria-hidden="true"
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-surface text-fg transition-colors duration-300 ease-out group-hover:bg-brand-500 group-hover:text-white group-focus-within:bg-brand-500 group-focus-within:text-white"
      >
        {icon}
      </span>
      {/* mt-6 → mt-12 at lg: the tall gap is what gives the DESKTOP cards their airy
          proportion, but those cards are only ~200px tall when stacked on a phone, so
          the same 48px gap there just reads as a hole between the icon and the title. */}
      <h3 className="relative mt-6 text-2xl font-bold text-fg transition-colors duration-300 ease-out group-hover:text-brand-700 group-focus-within:text-brand-700 lg:mt-12">
        {title}
      </h3>
      <p className="relative mt-3 max-w-xs text-base leading-relaxed text-fg-muted">
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
      aria-label="Why choose Stimuli IQ"
      data-testid="why-us"
      // Brand-tinted band, not `--surface`: the cards are white, and #f7f8fa was too
      // close to #ffffff for them to read as separate surfaces (see WhyUsCard). The
      // tint fades in/out (`.section-band-brand`) so the band has no visible edge.
      className="section-band-brand py-16 lg:py-24"
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        {/* Heading */}
        <div className="mx-auto mb-12 max-w-xl text-center lg:mb-16">
          <h2 className="font-display text-4xl font-bold tracking-tight text-fg md:text-5xl">
            Why <span className="text-chart-3">Stimuli IQ</span>?
          </h2>
          <p className="mx-auto mt-5 max-w-md text-lg leading-relaxed text-fg-muted">
            We focus on what actually prepares you for a healthcare career — hands-on training, clinical exposure, and mentorship that goes beyond the classroom.
          </p>
        </div>

        {/* 2 cards | artwork | 2 cards. The centre column is the NARROW one
            (1fr vs 1.15fr sides): the portrait artwork's aspect ratio sets the
            row height, so a narrower centre keeps the whole band from growing
            too tall while the flanking cards stretch to match.

            The md step is load-bearing: this used to go straight from 1 column to
            the 3-column desktop layout, so every tablet (768–1023px) rendered four
            ~780px-wide cards in a single stack — one line of text across a slab of
            whitespace, and a 2000px-tall section. At md the artwork spans the full
            width on its own row and the two card stacks sit side by side. */}
        <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1.15fr]">
          <div className="flex flex-col gap-6">
            {LEFT_CARDS.map((card) => (
              <WhyUsCard key={card.title} {...card} />
            ))}
          </div>

          {/* Center visual (decorative) — the branded team composition (portrait,
              941×1672). The box is LOCKED to the image's own aspect at every
              breakpoint so the logo (top) and badge (bottom) are never cropped —
              on lg it sets the row height and the flanking cards stretch to it.
              (An animated `WhyUsVisual` panel briefly stood here instead; the
              artwork is the intended treatment.)

              WIDTH CAP below lg is load-bearing: once the grid collapses to one
              column this box spans the full viewport, and at a 0.56 portrait ratio
              a 768px-wide tablet rendered it ~1364px tall — one image taking more
              than a full screen. Capping the WIDTH (rather than cropping the
              height) keeps the artwork uncropped and brings it back to ~570px. */}
          <div
            aria-hidden="true"
            className="relative mx-auto aspect-[941/1672] w-full max-w-[280px] sm:max-w-[320px] md:order-first md:col-span-2 lg:order-none lg:col-span-1 lg:max-w-none"
          >
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
