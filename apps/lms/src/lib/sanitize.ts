// DOMPurify sanitization utility — Phase 4 Task #10.
//
// Resolves P3 follow-up L-2: student-submitted content (assignment text,
// feedback, descriptive answer text) must be sanitized before rendering
// to prevent XSS (AC-J8, docs/plans/phase-4.md §gaps "L-2").
//
// isomorphic-dompurify is used so this utility works in both server
// (SSR) and client contexts. The package is already installed in the
// lms app (package.json).
//
// Usage:
//   import { sanitizeHtml } from "@/lib/sanitize";
//   <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(feedback) }} />
//
// Rules enforced by DOMPurify defaults:
//   - Strips all <script> tags and event handlers (onclick, onerror, etc.)
//   - Strips data: URLs in href/src that could execute JS
//   - Allows safe formatting HTML (p, ul, li, strong, em, a with safe href, etc.)
//
// NEVER render student-submitted content without calling sanitizeHtml() first.

import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize arbitrary HTML (student-submitted text, assignment feedback,
 * descriptive answer renders) before inserting into the DOM.
 *
 * Returns a safe HTML string with XSS vectors removed.
 *
 * @param dirty - Raw string from the backend (may contain student-authored HTML)
 * @returns Sanitized HTML string safe for dangerouslySetInnerHTML
 */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  // DOMPurify.sanitize is the main entry point; with isomorphic-dompurify it
  // uses JSDOM on the server and the native DOM on the client.
  return DOMPurify.sanitize(dirty, {
    // ALLOWED_TAGS: DOMPurify default allowlist (safe formatting only).
    // We do NOT extend the default because student content should not embed
    // arbitrary HTML beyond rich text.
    USE_PROFILES: { html: true },
    // Reject data: URIs that could execute code
    FORBID_ATTR: ["data-", "style"],
    FORCE_BODY: true,
  });
}

/**
 * Strip all HTML from student-submitted text and return plain text.
 * Use this when you need a plain-text excerpt (e.g. card previews, aria labels).
 *
 * @param dirty - Raw string from the backend
 * @returns Plain text with all HTML removed
 */
export function stripHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
