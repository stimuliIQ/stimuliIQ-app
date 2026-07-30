/**
 * HowItWorksSteps — staggered "zigzag" step timeline used by the homepage
 * "How it works" section (both the CMS `numbered_steps` block's `arrows`
 * variant and the hardcoded fallback render through this one component).
 *
 * Visual (reference-driven): alternating cards step down the page in a zigzag,
 * joined by dashed elbow connectors (desktop only). Each card carries a
 * vertical "STEP 0N" pill down its left edge, a small icon chip, a numbered
 * title, and a description. Card tints and pill colours alternate between the
 * brand green and near-black, drawn ONLY from existing design-system tokens —
 * no new palette.
 *
 * Icons are decorative and cycled by index (the step data models no icon), so
 * they're aria-hidden. Server component: all content is static, SEO-visible.
 *
 * a11y: an ordered <ol>/<li> conveys sequence; the "STEP 0N" pill and the
 * leading number in each title are aria-hidden (the list order already conveys
 * position); connectors are decorative and hidden from assistive tech.
 */

interface Step {
  title: string;
  description: string;
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function AwardIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <circle cx="12" cy="8" r="6" />
      <path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5" />
    </svg>
  );
}

const ICONS = [SearchIcon, PenIcon, CubeIcon, AwardIcon] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function HowItWorksSteps({ steps }: { steps: Step[] }) {
  return (
    <ol role="list" className="mx-auto flex max-w-4xl flex-col gap-8 lg:gap-16">
      {steps.map((step, index) => {
        const even = index % 2 === 0;
        const isLast = index === steps.length - 1;
        const Icon = ICONS[index % ICONS.length]!;
        // Alternate tints/pill colours between the green accent and near-black.
        //
        // `chart-3` (styles.css: "teal/green") is the accent the rest of the marketing
        // site already uses for highlighted words, so the zigzag reads as brand rather
        // than as a second, unrelated palette. It briefly used `chart-1` (blue) to keep
        // this band from merging with the brand-tinted Why-Us section above it; the
        // alternating near-black rows do that job on their own, and a blue stripe in a
        // green identity was the worse trade. Staying on a token keeps dark mode working.
        const cardTint = even ? "bg-chart-3/10" : "bg-surface";
        const pillColor = even ? "bg-chart-3" : "bg-fg";

        return (
          <li key={step.title} className="relative">
            <article
              className={[
                "group relative overflow-hidden rounded-3xl py-6 pl-16 pr-6 sm:pl-20 sm:pr-8 lg:w-[62%]",
                cardTint,
                even ? "lg:mr-auto" : "lg:ml-auto",
                // Hover treatment: the card lifts toward the reader and picks up a
                // brand ring, while its step pill and icon chip animate in sympathy
                // (see below). Transform + shadow only — the tint stays put so the
                // alternating green/neutral rhythm of the zigzag is preserved.
                "ring-1 ring-transparent transition-[transform,box-shadow] duration-300 ease-out",
                "hover:-translate-y-1.5 hover:shadow-xl hover:ring-chart-3/30",
                "focus-within:-translate-y-1.5 focus-within:shadow-xl focus-within:ring-chart-3/30",
              ].join(" ")}
            >
              {/* Sheen that sweeps across on hover — decorative, non-interactive. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/0 via-white/40 to-white/0 opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100"
              />
              {/* Vertical "STEP 0N" pill down the left edge */}
              <div
                className={`absolute inset-y-2.5 left-2.5 flex w-10 items-center justify-center rounded-full transition-transform duration-300 ease-out group-hover:scale-y-[1.03] ${pillColor}`}
              >
                <span
                  aria-hidden="true"
                  className="text-[10px] font-bold uppercase tracking-[0.2em] text-white [writing-mode:vertical-rl] rotate-180"
                >
                  Step {pad(index + 1)}
                </span>
              </div>

              <div className="relative flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-chart-3 shadow-sm transition-[transform,color] duration-300 ease-out group-hover:scale-110 group-hover:text-chart-3">
                  <Icon />
                </span>
                <h3 className="text-lg font-bold text-fg">
                  <span aria-hidden="true" className="text-fg-muted">{index + 1}</span> {step.title}
                </h3>
              </div>
              <p className="relative mt-3 text-sm leading-relaxed text-fg-muted">{step.description}</p>
            </article>

            {/* Dashed elbow connector into the next (opposite-side) card. Anchored
                to the full-width <li>, so its percentages land in the overlap zone
                between the two staggered cards: it drops out of this card's inner
                side, turns, and meets the next card's inner side. Desktop only. */}
            {!isLast ? (
              even ? (
                <span
                  aria-hidden="true"
                  className="absolute left-[45%] right-[45%] top-full hidden h-16 rounded-br-[2.5rem] border-b border-r border-dashed border-fg/25 lg:block"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="absolute left-[45%] right-[45%] top-full hidden h-16 rounded-bl-[2.5rem] border-b border-l border-dashed border-fg/25 lg:block"
                />
              )
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
