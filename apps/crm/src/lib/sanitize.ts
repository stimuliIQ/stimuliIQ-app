// DOMPurify sanitization utility — Phase 4 security boundary.
//
// Rationale (docs/plans/phase-4.md §2, AC-J8):
//   Student-submitted text/links/descriptive answers are now rendered in the
//   CRM grading views. This closes the P3 L-2 XSS trust boundary: any student
//   content must be sanitized before being rendered as HTML.
//
// Usage:
//   import { sanitizeHtml } from "../lib/sanitize";
//   <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(submission.text) }} />
//
// IMPORTANT:
//   - Only use sanitizeHtml for content that will be rendered as innerHTML.
//   - Plain text values passed to React children are safe without sanitization.
//   - Never pass raw student-submitted content directly to dangerouslySetInnerHTML.
//
// isomorphic-dompurify is already installed (apps/crm/package.json).
// It works in both browser (window.DOMPurify) and Node (jsdom-backed).
import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize student-submitted HTML/text to prevent XSS (AC-J8).
 *
 * Config: blocks `<script>`, `<iframe>`, JS event handlers, `javascript:`
 * hrefs. Allows basic formatting tags (p, br, b, i, ul, li, a href with
 * safe protocols) so that faculty-intended rich text renders correctly.
 *
 * @param dirty - Raw student-submitted text (may contain HTML/script injection).
 * @returns Sanitized HTML string safe for innerHTML rendering.
 */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ["p", "br", "b", "i", "em", "strong", "ul", "ol", "li", "a", "pre", "code", "blockquote"],
    ALLOWED_ATTR: ["href", "target", "rel"],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$)))/i,
    ADD_ATTR: ["rel"],
    FORCE_BODY: true,
  });
}

/**
 * Strip all HTML from student-submitted text, returning plain text only.
 * Use this when you need to display submission content in a non-HTML context
 * (e.g., in a table cell or as an aria-label).
 */
export function stripHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
