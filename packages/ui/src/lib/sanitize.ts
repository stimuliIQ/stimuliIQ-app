// Shared DOMPurify sanitizer for @repo/ui render sinks (T19, Phase 9).
//
// This generalizes the pattern documented in docs/adr/0045 (forum render-sink-at-sink
// discipline: DOMPurify applied at every render sink is the real XSS control, not a
// write-path regex strip — see apps/lms/src/lib/sanitize.ts and apps/crm/src/lib/sanitize.ts
// for the app-level precedent this mirrors). `isomorphic-dompurify` is already an approved,
// installed dependency elsewhere in the monorepo (apps/lms, apps/crm); this adds it to
// @repo/ui so new shared surfaces (RenderSink, TicketThread) get the same sink-level
// sanitization without every app re-implementing it.
//
// Unlike `PostThread` (packages/ui/src/components/post-thread.tsx), which intentionally
// requires the CALLER to pre-sanitize `body` (documented XSS trust boundary), `RenderSink`
// sanitizes by default — safe-by-default for new CMS/KB/ticket surfaces — with an explicit
// opt-out (`trustedHtml`) for callers that have already sanitized upstream.
import DOMPurify from "isomorphic-dompurify";

/** Default allowlist — safe rich-text formatting for CMS/blog/KB content, a superset of
 * the CRM grading allowlist (adds headings/images/tables for long-form content pages). */
export const RICH_CONTENT_ALLOWED_TAGS: readonly string[] = [
  "p", "br", "b", "i", "em", "strong", "u", "s",
  "ul", "ol", "li",
  "a", "pre", "code", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "img", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "th", "td",
  "hr", "span",
];

export const RICH_CONTENT_ALLOWED_ATTR: readonly string[] = [
  "href", "target", "rel", "src", "alt", "title", "width", "height", "colspan", "rowspan",
];

export interface SanitizeRichContentOptions {
  /** Override the default allowlist entirely. */
  allowedTags?: readonly string[];
  allowedAttr?: readonly string[];
  /** Convenience flag: strips `img`/`figure`/`figcaption` from the default allowlist.
   * Ignored if `allowedTags` is explicitly provided. */
  allowImages?: boolean;
}

/**
 * Sanitize rich/HTML content for safe `dangerouslySetInnerHTML` rendering. This is the
 * render-sink control — call it at every point HTML from the backend (CMS pages, KB
 * articles, ticket messages, forum posts) is rendered, matching docs/adr/0045.
 */
export function sanitizeRichContent(
  dirty: string | null | undefined,
  options: SanitizeRichContentOptions = {},
): string {
  if (!dirty) return "";
  const allowedTags =
    options.allowedTags ??
    (options.allowImages === false
      ? RICH_CONTENT_ALLOWED_TAGS.filter((t) => !["img", "figure", "figcaption"].includes(t))
      : RICH_CONTENT_ALLOWED_TAGS);

  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: allowedTags as string[],
    ALLOWED_ATTR: (options.allowedAttr ?? RICH_CONTENT_ALLOWED_ATTR) as string[],
    // Reject javascript:/data: URIs in href/src; allow http(s)/mailto/relative paths only.
    ALLOWED_URI_REGEXP: /^(?:(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$)))/i,
    ADD_ATTR: ["target", "rel"],
    FORCE_BODY: true,
  });
}

/** Strip all HTML, returning plain text only (card previews, aria-labels, search excerpts). */
export function stripRichContent(dirty: string | null | undefined): string {
  if (!dirty) return "";
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
