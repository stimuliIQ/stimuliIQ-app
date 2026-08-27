"use client";

/**
 * VerifyReveal — the scan-then-reveal sequence on /verify/<id>.
 *
 * The visitor presses "Verify certificate" on /verify, lands here, and instead of the
 * answer simply being there, they watch it being read: an ID card is swept by two beams,
 * the serial along its foot is read off, a seal lands, and the seal then walks into the
 * left column while the details fill in beside it. The beats and their CSS live next to
 * each other in app/globals.css under "Certificate-verification reveal".
 *
 * Three rules this component is built around:
 *
 *  1. The RESULT is never the animation's to own. `children` is the real, server-rendered
 *     result; it is in the DOM and in the accessibility tree from first paint and is only
 *     ever hidden visually. The overlay is decorative and wholly aria-hidden, so a screen
 *     reader gets the verdict immediately and never waits on a timer.
 *  2. No-JS must still see the answer. The server renders `data-verify-stage="scan"`, so
 *     there is no hydration mismatch and no flash of the answer before the scan; a
 *     <noscript> style then unhides the result for anyone whose JS never arrives.
 *  3. prefers-reduced-motion skips the whole thing. The timers are what hold the sequence,
 *     so the global neutraliser in @repo/ui/styles.css cannot do it alone — the effect
 *     below jumps straight to "settled", and a CSS media query drops the overlay outright
 *     so it cannot appear even for one frame.
 *
 * No animation library: this is a handful of timeouts and some keyframes. Adding a
 * dependency for one page's intro is not a trade this project makes.
 */

import * as React from "react";
import { cn } from "@repo/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Stages
// ─────────────────────────────────────────────────────────────────────────────

export type VerifyStage = "scan" | "id" | "verified" | "settled";

/** How long each beat holds before the next one starts. Roughly 2.7s end to end. */
const BEAT_MS: Record<Exclude<VerifyStage, "settled">, number> = {
  scan: 1150,
  id: 820,
  verified: 760,
};

const NEXT_STAGE: Record<Exclude<VerifyStage, "settled">, VerifyStage> = {
  scan: "id",
  id: "verified",
  verified: "settled",
};

/** Result tone to the design-system colour token the beams and frame take. */
const TONE_VAR = {
  success: "--success",
  danger: "--danger",
  warning: "--warning",
} as const;

export type VerifyRevealTone = keyof typeof TONE_VAR;

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface VerifyRevealProps {
  /** Drives the beam/frame colour so the scan reads as the result it is heading for. */
  tone: VerifyRevealTone;
  /** The ID read off the foot of the card in beat 2. */
  idText: string;
  /** The final seal, rendered again inside the overlay so beat 3 hands over cleanly to 4. */
  seal: React.ReactNode;
  /**
   * "split" — the settled result is a two-column grid, so the scan card is one column wide
   * and the seal walks left out of centre. "solo" — a single centred panel (the not-found
   * state has no details to reveal), so the seal simply takes the card's place.
   */
  layout: "split" | "solo";
  children: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan-card face (beats 1 and 2)
// ─────────────────────────────────────────────────────────────────────────────

function PortraitGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-7"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/**
 * The card being scanned. Deliberately anonymous — a portrait silhouette and redacted
 * bars — because at this point in the sequence the certificate has not been verified yet.
 * Showing the real holder here would give away the answer the scan is supposed to find.
 */
function ScanCardFace({ stage, idText }: { stage: VerifyStage; idText: string }) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col justify-between overflow-hidden rounded-2xl",
        "border border-border bg-card px-6 py-6",
        stage === "verified" && "verify-card-dim",
      )}
    >
      {/* Graph paper — reads as a surface being machine-read */}
      <div className="verify-scan-grid pointer-events-none absolute inset-0 opacity-70" />

      {/* Redacted identity block */}
      <div className="relative flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface text-fg-subtle">
          <PortraitGlyph />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="block h-2.5 w-3/4 rounded-full bg-fg/10" />
          <span className="block h-2 w-1/2 rounded-full bg-fg/[0.07]" />
        </div>
      </div>

      <div className="relative flex flex-col gap-2">
        <span className="block h-2 w-full rounded-full bg-fg/[0.07]" />
        <span className="block h-2 w-5/6 rounded-full bg-fg/[0.07]" />
      </div>

      {/* Beat 2 — the ID strip along the foot of the card */}
      <div className="relative">
        <div
          className="mb-3 h-px w-full"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to right, rgb(var(--border)) 0 6px, transparent 6px 12px)",
          }}
        />
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
          Certificate ID
        </p>
        <div className="relative mt-1 overflow-hidden">
          <p
            className={cn(
              "truncate font-mono text-sm tracking-[0.12em] text-fg",
              stage === "scan" && "opacity-40 blur-[4px]",
              stage === "id" && "verify-id-resolve",
            )}
          >
            {idText}
          </p>
          {/* The reading pass itself */}
          {stage === "id" ? <span className="verify-id-pass absolute inset-0" /> : null}
        </div>
      </div>

      {/* Beat 1 — the two sweeps, one per axis */}
      {stage === "scan" ? (
        <>
          <span className="verify-beam-y" />
          <span className="verify-beam-x" />
        </>
      ) : null}
    </div>
  );
}

/**
 * Viewfinder corners around the card. They tick in one after another during the scan and
 * then hold through the verified beat, where they frame the seal that lands inside them.
 */
const SCAN_CORNERS = [
  "left-0 top-0 border-l-2 border-t-2 rounded-tl-2xl",
  "right-0 top-0 border-r-2 border-t-2 rounded-tr-2xl",
  "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl",
  "bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl",
];

function ScanBrackets() {
  return (
    <>
      {SCAN_CORNERS.map((corner, index) => (
        <span
          key={corner}
          className={cn("verify-bracket pointer-events-none absolute size-8", corner)}
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VerifyReveal
// ─────────────────────────────────────────────────────────────────────────────

export function VerifyReveal({ tone, idText, seal, layout, children }: VerifyRevealProps) {
  // Server and first client render agree on "scan" — no hydration mismatch, and the result
  // is hidden by CSS before the browser ever paints it.
  const [stage, setStage] = React.useState<VerifyStage>("scan");

  React.useEffect(() => {
    // Anyone who has asked for less motion gets the answer, not the show.
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setStage("settled");
      return;
    }

    if (stage === "settled") return;
    const timer = window.setTimeout(() => setStage(NEXT_STAGE[stage]), BEAT_MS[stage]);
    return () => window.clearTimeout(timer);
  }, [stage]);

  // Custom property, so one set of keyframes serves all three result tones.
  const toneStyle = { "--verify-tone": `var(${TONE_VAR[tone]})` } as React.CSSProperties;

  return (
    <div className="verify-reveal relative w-full" data-verify-stage={stage}>
      {/* If the sequence's JS never arrives there is nothing to advance the beats, so the
          overlay would sit on a hidden result forever. Show the one, drop the other. */}
      <noscript>
        <style>
          {".verify-reveal__result{opacity:1;animation:none}.verify-reveal__overlay{display:none}"}
        </style>
      </noscript>

      <div className="verify-reveal__result">{children}</div>

      {stage !== "settled" ? (
        <div
          className="verify-reveal__overlay absolute inset-0 flex items-start justify-center"
          aria-hidden="true"
        >
          <div
            className={cn(
              "verify-scan-frame relative",
              layout === "split" ? "verify-scan-column" : "h-full w-full max-w-sm",
            )}
            style={toneStyle}
          >
            <ScanCardFace stage={stage} idText={idText} />
            <ScanBrackets />

            {stage === "verified" ? (
              <>
                <span className="verify-shockwave absolute left-1/2 top-1/2 size-40 rounded-full" />
                {/* bg-bg: the seal's own panel is a wash, so without an opaque ground under
                    it the card being scanned shows through and the two read as one smear. */}
                <div className="verify-seal-in absolute inset-0 rounded-2xl bg-bg">{seal}</div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

VerifyReveal.displayName = "VerifyReveal";
