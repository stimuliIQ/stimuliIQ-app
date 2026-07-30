"use client";

/**
 * MentorsGrid — CRM-bound mentor directory grid for /mentors.
 *
 * Data flow: the server page fetches page 1 (SEO — mentors are in the server
 * HTML) and hands it here; "View More Mentors" fetches subsequent cursor pages
 * client-side via client.public.mentors.list() and appends.
 *
 * Card design (black & white take on the reference): each card shows the
 * mentor's CRM-uploaded photo (or a monogram avatar on a rotating grey-tint
 * panel when none is set), professional title, institute + years of experience,
 * a short bio, and social links (LinkedIn / X / GitHub / website). Hovering (or
 * keyboard-focusing) a card slides up an expertise-tag overlay. All values are
 * real CRM data, always in the DOM (screen readers read them regardless of the
 * visual reveal).
 *
 * a11y: list semantics, focus-within triggers the reveal, load-more button has
 * a busy state, reduced motion collapses the slide to an instant show.
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { PublicMentorCard } from "@repo/types";
import { apiClient } from "../../../lib/api-client";

const PAGE_SIZE = 8;

/** Rotating grey tints for the avatar panels (b&w take on the reference pastels). */
const PANEL_TINTS = [
  "bg-surface",
  "bg-fg/[0.07]",
  "bg-brand-50",
  "bg-fg/[0.12]",
] as const;

function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter((part) => /^[a-z]/i.test(part))
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** Inline social icons — lucide-react is not a web dependency, so no new package. */
const SOCIAL_ICONS: Record<"linkedin" | "twitter" | "github" | "website", { label: string; path: ReactNode }> = {
  linkedin: {
    label: "LinkedIn",
    path: <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm6 0h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.4c0-1.29-.02-2.95-1.8-2.95-1.8 0-2.08 1.4-2.08 2.85V21H9V9Z" />,
  },
  twitter: {
    label: "X",
    path: <path d="M18.244 2H21.5l-7.5 8.57L22.5 22h-6.9l-4.6-6.02L5.7 22H2.44l8.02-9.17L1.5 2h7.06l4.16 5.5L18.244 2Zm-1.21 18h1.8L7.04 3.9H5.1L17.03 20Z" />,
  },
  github: {
    label: "GitHub",
    path: <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />,
  },
  website: {
    label: "Website",
    path: (
      <>
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M2 12h20M12 2c2.5 2.5 3.8 6 3.8 10S14.5 19.5 12 22c-2.5-2.5-3.8-6-3.8-10S9.5 4.5 12 2Z" fill="none" stroke="currentColor" strokeWidth="2" />
      </>
    ),
  },
};

function SocialLinks({ links, name }: { links: PublicMentorCard["socialLinks"]; name: string }) {
  if (!links) return null;
  const entries = (Object.keys(SOCIAL_ICONS) as Array<keyof typeof SOCIAL_ICONS>).filter((k) => links[k]);
  if (entries.length === 0) return null;

  return (
    // relative z-20 keeps these links clickable above the card's stretched-link overlay.
    <div className="relative z-20 mt-3 flex justify-center gap-2">
      {entries.map((key) => (
        <a
          key={key}
          href={links[key]}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${name} on ${SOCIAL_ICONS[key].label}`}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-fg-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            {SOCIAL_ICONS[key].path}
          </svg>
        </a>
      ))}
    </div>
  );
}

function MentorCard({ mentor, index }: { mentor: PublicMentorCard; index: number }) {
  const tint = PANEL_TINTS[index % PANEL_TINTS.length];
  const role = mentor.title ?? mentor.expertise[0] ?? "Industry Mentor";

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm transition-shadow motion-safe:hover:shadow-md">
      {/* Stretched link: the whole card navigates to the mentor's detail page. Inner
          links (social icons) sit above it via z-20 and remain independently clickable. */}
      <Link
        href={`/mentors/${mentor.id}`}
        aria-label={`View ${mentor.fullName}'s profile`}
        className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid="mentor-card-link"
      />
      {/* Photo (or monogram) panel + expertise reveal — inset from the card edge,
          with its own rounding, so the media reads as framed rather than full-bleed. */}
      <div className={`relative flex h-52 items-center justify-center overflow-hidden rounded-xl ${tint}`}>
        {mentor.photoUrl ? (
          // Real photo when the CRM has one; falls back to the monogram otherwise.
          // plain <img>: remote CDN host, avoids next/image remotePatterns config.
          <img
            src={mentor.photoUrl}
            alt={mentor.fullName}
            className="h-full w-full object-cover transition-transform duration-base ease-out motion-safe:group-hover:scale-105"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-500 font-display text-3xl font-bold text-white transition-transform duration-base ease-out motion-safe:group-hover:scale-95"
          >
            {initialsOf(mentor.fullName)}
          </span>
        )}
        <div
          className={[
            "absolute inset-x-0 bottom-0 flex flex-wrap justify-center gap-1.5 p-4",
            "bg-gradient-to-t from-fg/80 via-fg/40 to-transparent pt-10",
            "motion-safe:translate-y-full motion-safe:transition-transform motion-safe:duration-base motion-safe:ease-out",
            "motion-safe:group-hover:translate-y-0 motion-safe:group-focus-within:translate-y-0",
          ].join(" ")}
        >
          {mentor.expertise.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/40 px-2.5 py-0.5 text-xs font-medium text-white"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Identity */}
      <div className="flex flex-1 flex-col px-2 pb-2 pt-5 text-center">
        <h3 className="text-lg font-bold text-fg">{mentor.fullName}</h3>
        <p className="mt-0.5 text-sm text-fg-muted">{role}</p>
        <p className="mt-1 text-xs uppercase tracking-wider text-fg-subtle">
          {mentor.externalInstitute}
          {typeof mentor.yearsExperience === "number" ? ` · ${mentor.yearsExperience}+ yrs` : ""}
        </p>
        {mentor.bio ? (
          <p className="mt-3 line-clamp-3 text-sm text-fg-muted">{mentor.bio}</p>
        ) : null}
        <SocialLinks links={mentor.socialLinks} name={mentor.fullName} />
      </div>
    </article>
  );
}

export interface MentorsGridProps {
  initialItems: PublicMentorCard[];
  initialCursor: string | null;
}

export function MentorsGrid({ initialItems, initialCursor }: MentorsGridProps) {
  const [mentors, setMentors] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(false);
    try {
      const result = await apiClient.public.mentors.list({ cursor, limit: PAGE_SIZE });
      setMentors((prev) => [...prev, ...result.items]);
      setCursor(result.meta.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  if (mentors.length === 0) {
    return (
      <p className="py-12 text-center text-fg-muted" role="status" data-testid="mentors-empty">
        Our mentor directory is being updated — check back soon.
      </p>
    );
  }

  return (
    <div data-testid="mentors-grid">
      <ul role="list" className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {mentors.map((mentor, index) => (
          <li key={mentor.id}>
            <MentorCard mentor={mentor} index={index} />
          </li>
        ))}
      </ul>

      <div className="mt-12 text-center">
        {cursor ? (
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            aria-busy={loading}
            className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-fg px-8 text-sm font-semibold text-fg transition-colors hover:bg-brand-500 hover:text-white disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {loading ? "Loading…" : "View More Mentors"}
          </button>
        ) : (
          <p className="text-sm text-fg-subtle">
            That&apos;s the whole team — and it keeps growing.
          </p>
        )}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            Couldn&apos;t load more mentors. Please try again.
          </p>
        ) : null}
      </div>
    </div>
  );
}
