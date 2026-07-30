/**
 * BrainShowcase — the compact visual band placed directly after the hero.
 *
 * Purely decorative: the animated MagicRings shader (WebGL) sits behind the 3D
 * brain render, which bobs and turns on its Y axis. There is no copy here, so
 * the whole section is hidden from assistive tech — the surrounding sections
 * carry all the meaning.
 *
 * Background note: the band is white to match the sections above and below it
 * (an earlier dark treatment made the page jump to dark mid-scroll). The
 * MagicRings fragment shader is emissive — it derives alpha from the brightest
 * colour channel — so on white it reads as translucent green line-work rather
 * than a glow. That's why the ring colours here are the darker brand greens
 * (a bright mint would wash out to nothing against white).
 *
 * This stays a server component: it renders <MagicRings /> (the "use client"
 * boundary) and the motion is pure CSS, so nothing else ships JS.
 */

import Image from "next/image";

import { MagicRings } from "./magic-rings";

/**
 * Ring colours — the brand green and one step lighter, for contrast against the
 * white band. (On the previous dark treatment these had to be bright mints;
 * the relationship inverts on a light surface.)
 */
const RING_COLOR = "#047857";
const RING_COLOR_TWO = "#10B981";

/**
 * Marquee wordmark. Each half of the track repeats this enough times to overrun
 * the widest viewport, so the strip never runs out of text mid-scroll.
 */
const WORDMARK = "Stimuli IQ — Where Minds Meet Science";
const MARQUEE_REPEAT = 3;

export function BrainShowcase(): React.JSX.Element {
  return (
    <section
      aria-hidden="true"
      data-testid="brain-showcase"
      className="relative overflow-hidden bg-bg py-4 lg:py-6"
    >
      {/* Decorative dot-grid texture. Fills the empty corners around the stage
          while a radial mask keeps the centre (where the brain sits) clean, so
          the band reads as intentional rather than blank white space. */}
      <div
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(#E4E8EE_1px,transparent_1.6px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,transparent_38%,#000_82%)] [-webkit-mask-image:radial-gradient(ellipse_at_center,transparent_38%,#000_82%)]"
      />

      {/* Full-bleed wordmark marquee, running low behind the stage. Two identical
          halves + a -50% translate = seamless loop. */}
      <div className="pointer-events-none absolute inset-x-0 top-[90%] -translate-y-1/2 select-none overflow-hidden">
        <div className="animate-marquee-x flex w-max">
          {[0, 1].map((half) => (
            <div key={half} className="flex shrink-0">
              {Array.from({ length: MARQUEE_REPEAT }).map((_, i) => (
                <span
                  key={i}
                  /* leading must exceed 1: `leading-none` makes the line box
                     exactly the font size, so descenders (p, g, y) hang outside
                     it and get clipped by the track's overflow-hidden. */
                  /* Halftone letters: the fill is a repeating radial-gradient
                     dot pattern clipped to the glyphs (bg-clip-text + transparent
                     text), so each letter is built from dots instead of a solid
                     wash. */
                  /* Sizing: phones get a much larger relative size (12vw) so the
                     strip stays legible; ≥md steps back to the original 8vw.
                     Ink: slate-ish #8896A8 dots on a denser 7px grid — dark
                     enough to read against white without competing with the
                     hero copy above. */
                  className="whitespace-nowrap bg-clip-text font-display text-[12vw] font-black uppercase leading-[1.3] tracking-tight text-transparent [background-image:radial-gradient(#8896A8_1.5px,transparent_1.7px)] [background-size:7px_7px] md:text-[8vw]"
                >
                  {WORDMARK}
                  {/* Separator keeps consecutive repeats from reading as one
                      run-on string ("...program everStimuli IQ — the best..."). */}
                  <span className="px-[0.45em]">•</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="relative mx-auto max-w-screen-xl px-4 md:px-6">
        {/* Stage: rings behind, brain floating on top */}
        <div className="relative mx-auto aspect-square w-full max-w-[500px]">
          {/* Animated rings (WebGL). The radial mask feathers the canvas edge so
              the circular rings don't hard-clip against the square stage. */}
          <div className="absolute inset-0 [mask-image:radial-gradient(circle_closest-side,#000_90%,transparent_100%)] [-webkit-mask-image:radial-gradient(circle_closest-side,#000_90%,transparent_100%)]">
            <MagicRings
              color={RING_COLOR}
              colorTwo={RING_COLOR_TWO}
              ringCount={6}
              speed={1}
              /* Tighter falloff than upstream's 10 so the ring glow stays crisp
                 and doesn't bleed a haze across the brain. */
              attenuation={13}
              lineThickness={2}
              /* Shader space puts the canvas half-width at 0.5. The brain below
                 is 56% of the stage, i.e. a half-width of 0.28, so the rings
                 start at 0.33 to clear its silhouette instead of cutting
                 through it, and end at 0.47 just inside the mask's fade. */
              baseRadius={0.33}
              radiusStep={0.028}
              scaleRate={0.1}
              opacity={1}
              blur={0}
              /* Upstream default is 0.1, but the noise covers the whole quad and
                 renders as a visible square patch around the rings. */
              noiseAmount={0}
              rotation={0}
              ringGap={1.5}
              fadeIn={0.7}
              fadeOut={0.5}
              followMouse={false}
              mouseInfluence={0.2}
              hoverScale={1.2}
              parallax={0.05}
              clickBurst={false}
            />
          </div>

          {/* Brain — decorative, and inert so the rings keep their hover. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Image
              src="/images/brain.png"
              alt=""
              width={804}
              height={668}
              sizes="(min-width: 640px) 500px, 90vw"
              className="animate-brain-float h-auto w-[56%]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

BrainShowcase.displayName = "BrainShowcase";
