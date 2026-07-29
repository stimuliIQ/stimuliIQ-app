/**
 * AnnouncementBar — the site-wide message strip rendered ABOVE the marketing header.
 *
 * Entirely CRM-driven via the `announcement.bar` SiteSetting (@repo/types
 * `AnnouncementBarValueSchema`): super_admins toggle it on/off, edit the message, and
 * pick the display mode (CRM → Marketing → Site settings → Announcement). Changes
 * surface within the site-settings 5-minute cache window. When the setting is off,
 * missing, or the CMS is unreachable, the SHELL renders nothing at all (resilience
 * default = hidden — an announcement is never load-bearing).
 *
 * Modes:
 *   "static" — fixed, centered text.
 *   "scroll" — classic ticker: the message starts fully off the RIGHT edge
 *              (padding-left: 100% on the track), travels left across the strip,
 *              exits, and re-enters from the right (`announcement-marquee`
 *              keyframes, globals.css). Under `prefers-reduced-motion` the CSS
 *              collapses it to the static centered treatment — no JS media queries.
 *
 * a11y: complementary landmark labelled "Announcement"; text meets contrast on the
 * brand background; the optional link keeps a visible focus ring.
 */
import * as React from "react";
import type { AnnouncementBarValue } from "@repo/types";

function MessageText({ message, href }: { message: string; href?: string }): React.JSX.Element {
  if (!href) return <>{message}</>;
  return (
    <a
      href={href}
      className="underline decoration-white/50 underline-offset-4 hover:decoration-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-600"
    >
      {message}
    </a>
  );
}

export function AnnouncementBar({ announcement }: { announcement?: AnnouncementBarValue }): React.JSX.Element | null {
  if (!announcement?.enabled || announcement.message.trim().length === 0) return null;
  const { message, mode, href } = announcement;

  return (
    <div
      role="complementary"
      aria-label="Announcement"
      data-testid="announcement-bar"
      className="overflow-hidden bg-brand-600 text-sm font-medium text-white"
    >
      {mode === "scroll" ? (
        <div
          className="announcement-marquee whitespace-nowrap py-2"
          // Slower for longer messages so reading speed stays roughly constant
          // (the travel distance is one viewport width + the text's own width).
          style={{ animationDuration: `${Math.min(60, Math.max(20, Math.round(message.length / 3) + 10))}s` }}
        >
          <MessageText message={message} href={href} />
        </div>
      ) : (
        <p className="mx-auto max-w-screen-2xl truncate px-4 py-2 text-center md:px-6">
          <MessageText message={message} href={href} />
        </p>
      )}
    </div>
  );
}
