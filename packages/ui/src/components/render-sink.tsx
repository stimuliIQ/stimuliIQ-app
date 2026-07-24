import * as React from "react";

import { cn } from "../lib/cn";
import { sanitizeRichContent, type SanitizeRichContentOptions } from "../lib/sanitize";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

/**
 * RenderSink — the shared safe-HTML render sink for CMS content pages, KB articles, and
 * any other MDX/rich-content surface (T19, docs/plans/phase-9-completion.md), per the
 * render-sink discipline in docs/adr/0045: DOMPurify applied at the point content is
 * rendered is the real XSS control, not a write-path strip. See `../lib/sanitize.ts`.
 *
 * Difference from `PostThread`/`ThreadList` (which require the caller to pre-sanitize):
 * RenderSink sanitizes **by default** — safe-by-default for new surfaces. Pass
 * `trustedHtml` only when the caller has already sanitized upstream (e.g. server-rendered
 * MDX compiled through a trusted pipeline) and wants to skip the redundant client pass.
 *
 * a11y:
 * - Renders as a labelled `<div>` (article-like content region); caller supplies heading
 *   structure in `html` itself (h1-h6 are allowlisted) or wraps RenderSink in a landmark.
 * - Loading renders skeleton paragraph lines; empty renders `EmptyState`; both convey
 *   state via visible text, not layout alone.
 * - Images allowed by default; set `sanitizeOptions={{ allowImages: false }}` to strip
 *   them for surfaces that don't support alt-text review yet.
 *
 * Usage (CMS blog post body):
 *   <RenderSink html={post.bodyHtml} data-testid="blog-post-body" />
 *
 * Usage (KB article, pre-sanitized server-side):
 *   <RenderSink html={article.sanitizedHtml} trustedHtml />
 */
export interface RenderSinkProps {
  /** Raw or pre-sanitized HTML string. */
  html: string | null | undefined;
  /** Skip client-side sanitization because `html` was already sanitized upstream. */
  trustedHtml?: boolean;
  sanitizeOptions?: SanitizeRichContentOptions;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  /** Test hook; defaults to "render-sink" when omitted. */
  "data-testid"?: string;
}

export const RenderSink = React.forwardRef<HTMLDivElement, RenderSinkProps>(
  (
    {
      html,
      trustedHtml = false,
      sanitizeOptions,
      loading = false,
      emptyTitle = "Nothing to show yet",
      emptyDescription,
      className,
      "data-testid": testId,
    },
    ref,
  ) => {
    if (loading) {
      return (
        <div
          ref={ref}
          data-testid={testId ?? "render-sink"}
          aria-busy="true"
          aria-label="Loading content"
          className={cn("flex flex-col gap-2", className)}
        >
          <Skeleton shape="line" />
          <Skeleton shape="line" />
          <Skeleton shape="line" className="w-2/3" />
        </div>
      );
    }

    const isEmpty = !html || html.trim().length === 0;
    if (isEmpty) {
      return (
        <div ref={ref} data-testid={testId ?? "render-sink"} className={className}>
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      );
    }

    const safeHtml = trustedHtml ? html : sanitizeRichContent(html, sanitizeOptions);

    return (
      <div
        ref={ref}
        data-testid={testId ?? "render-sink"}
        className={cn("prose prose-sm max-w-none text-fg dark:prose-invert", className)}
        // Safe: `safeHtml` is either DOMPurify-sanitized above or explicitly marked
        // `trustedHtml` by a caller that sanitized it upstream (documented XSS boundary).
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  },
);
RenderSink.displayName = "RenderSink";
