// Shared chrome for the four unauthenticated LMS routes (/login,
// /forgot-password, /reset-password, /change-password). Two-panel split:
// the form panel on the left, and on the right a brand-tinted showcase panel
// carrying the same floating 3D brain the marketing site leads with
// (apps/web/src/components/home/brain-showcase.tsx), so a student arriving
// from stimuliiq.com lands on visual continuity rather than a bare card.
//
// The showcase panel is purely decorative: aria-hidden, `lg:` only (below the
// lg breakpoint the form gets the full viewport — a login form must never be
// pushed below the fold by ornament), and the brain is `alt=""`. The depth is
// the pre-rendered PNG plus CSS (radial glow + concentric rings + float); we
// deliberately do NOT port apps/web's WebGL MagicRings canvas here — a shader
// is not worth the bundle or the battery on a page whose whole job is a
// 250ms handoff to the dashboard.
//
// Motion: `animate-auth-brain-float` is neutralised by the global
// prefers-reduced-motion rule in @repo/ui/styles.css.
import * as React from "react";
import Image from "next/image";
import Link from "next/link";

export interface AuthSplitLayoutProps {
  /** Card heading — the <h1> of the page. */
  title: string;
  /** Supporting line under the heading. */
  description: React.ReactNode;
  /** Form (or confirmation/terminal state) markup. */
  children: React.ReactNode;
  /** Optional trailing row, e.g. the "Back to sign in" link. */
  footer?: React.ReactNode;
  /** Marks the panel busy while a Suspense fallback is showing. */
  busy?: boolean;
  /** Forwarded to the form panel so existing e2e testids keep resolving. */
  "data-testid"?: string;
}

/** Copy for the showcase panel — the student-facing value prop, not marketing spiel. */
const SHOWCASE_POINTS = [
  "Recorded lessons and notes in one place",
  "Track progress across every module",
  "Earn a verifiable certificate on completion",
];

export function AuthSplitLayout({
  title,
  description,
  children,
  footer,
  busy,
  "data-testid": testId,
}: AuthSplitLayoutProps): React.JSX.Element {
  return (
    <div className="flex min-h-screen bg-surface p-0 lg:p-6">
      <main
        id="main-content"
        aria-busy={busy || undefined}
        data-testid={testId}
        className="flex w-full flex-col justify-center bg-bg px-6 py-12 sm:px-10 lg:w-1/2 lg:rounded-lg lg:px-16 lg:shadow-sm"
      >
        <div className="mx-auto w-full max-w-sm">
          {/*
           * Wordmark + "Learning Platform" qualifier. The marketing site and the
           * CRM share this same wordmark, so the qualifier is what tells a
           * student (and a screenshotting support agent) which surface they're
           * looking at. aria-label carries the full name; the mark itself is
           * alt="" and the qualifier is decorative to avoid a triple read.
           */}
          <Link
            href="/"
            aria-label="stimuliiq Learning Platform — home"
            className="inline-flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {/* Black wordmark on a transparent PNG — flatten to white in dark theme. */}
            <Image
              src="/stimuliiq-logo.png"
              alt=""
              width={1506}
              height={355}
              priority
              className="h-10 w-auto dark:brightness-0 dark:invert"
            />
            <span aria-hidden="true" className="h-6 w-px bg-border" />
            <span
              aria-hidden="true"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-500"
            >
              Learning
              <br />
              Platform
            </span>
          </Link>

          <div className="mt-10">
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg">{title}</h1>
            <p className="mt-2 text-sm text-fg-muted">{description}</p>
          </div>

          <div className="mt-8">{children}</div>

          {footer ? <div className="mt-6">{footer}</div> : null}
        </div>
      </main>

      <AuthShowcasePanel />
    </div>
  );
}

/** Decorative right-hand panel. Hidden below `lg` and inert to assistive tech. */
function AuthShowcasePanel(): React.JSX.Element {
  return (
    <aside
      aria-hidden="true"
      data-testid="auth-showcase"
      className="relative hidden w-1/2 select-none overflow-hidden rounded-lg bg-brand-50 lg:ml-6 lg:flex lg:flex-col lg:justify-between dark:bg-bg"
    >
      {/*
       * Base layer: the same tile-pattern plate the marketing homepage hero
       * uses (apps/web hero-centered.tsx), so the two surfaces share texture.
       * Held back with opacity + a fade-to-transparent mask at the bottom so it
       * reads as texture under the gradient, never as a competing image.
       */}
      <div className="pointer-events-none absolute inset-0 opacity-90 [mask-image:linear-gradient(to_bottom,#000_0%,#000_45%,transparent_88%)] dark:opacity-20">
        <Image
          src="/images/hero-background.avif"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 0px"
          className="object-cover"
        />
      </div>

      {/*
       * Layered green→white wash over the plate. Three stacked radial stops
       * rather than one linear gradient: the light reads as coming from behind
       * the brain (top-centre), which is what makes the flat PNG sit in the
       * space instead of on top of it. Order matters — deepest tint first,
       * white bloom last.
       */}

      {/* 1. Deep emerald pooling in the bottom corners. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_115%,rgb(var(--brand-500)/0.30)_0%,transparent_65%)]" />

      {/* 2. White bloom top-centre — the key light. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(75%_55%_at_50%_18%,rgb(255_255_255/0.78)_0%,rgb(255_255_255/0.30)_40%,transparent_74%)] dark:bg-[radial-gradient(75%_55%_at_50%_18%,rgb(var(--brand-500)/0.22)_0%,transparent_70%)]" />

      {/* 3. Tight halo hugging the brain so its silhouette separates cleanly. */}
      <div className="pointer-events-none absolute left-1/2 top-[38%] h-[52%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/25 blur-3xl dark:bg-brand-500/30" />

      <div className="relative flex flex-1 items-center justify-center p-10">
        <Image
          src="/images/brain.png"
          alt=""
          width={804}
          height={668}
          sizes="(min-width: 1024px) 50vw, 0px"
          priority
          className="animate-auth-brain-float h-auto w-[62%] max-w-[380px] drop-shadow-2xl"
        />
      </div>

      <div className="relative p-10 pt-0">
        <p className="font-display text-2xl font-bold leading-tight tracking-tight text-fg">
          Learn by building.
          <br />
          Graduate job-ready.
        </p>
        <ul className="mt-5 space-y-2.5">
          {SHOWCASE_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-2.5 text-sm text-fg-muted">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
              {point}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
