// apps/lms/src/components/engagement-a11y.static.test.ts
//
// P6 engagement a11y regression guard — docs/plans/phase-7.md Wave 1 "qa" row
// ("axe on NotificationBell/CampaignBuilder/BadgeGrid/PostThread" + LMS engagement
// screens: notification center, notification prefs, forum thread list + detail,
// gamification-on-progress).
//
// ─── WHY THIS FILE IS A "STATIC" TEST, NOT AN AXE PASS ──────────────────────────
//
// This repo has NO automated a11y harness (jest-axe / @axe-core/playwright / @axe-
// core/react) installed anywhere — confirmed by `grep -rn axe` across every
// package.json in apps/{web,lms,crm} and packages/ui. Playwright itself is listed as
// a dependency in all three apps' package.json but has no playwright.config.* file
// anywhere in the repo (a carried gap since P1 per docs/plans/phase-6.md Part 5 "Out
// of P6" table — "Playwright e2e (browser) — Carried stub since P1").
//
// `apps/lms` ALSO has no component-RENDER test harness: `@testing-library/react` is
// NOT a dependency here (only `vitest` + `jsdom` for hook-logic tests — see
// src/hooks/use-notifications.test.ts and siblings, which test pure functions/query
// keys, never render JSX). Installing `@testing-library/react` for apps/lms would be
// a new-dependency decision (CLAUDE.md §1 "do not deviate without an ADR" / standing
// ask-before-install rule) even though it is ALREADY a devDependency of `@repo/ui`
// (packages/ui/package.json) — extending it to a second app's test config is a
// separate call this QA pass does not make unilaterally.
//
// NOTE: the shared, REUSABLE primitives these LMS pages compose (NotificationBell,
// PostThread, CampaignBuilder, BadgeGrid, ThreadList, LeaderboardTable,
// NotificationPrefsMatrix — see packages/ui/src/components/*.test.tsx) ALREADY have
// real @testing-library/react render tests with getByRole/getByLabelText assertions
// from an earlier wave (design-system agent). That is real, if partial (RTL role/name
// queries, not full axe/WCAG contrast+relationship checks), a11y coverage at the
// component-primitive layer. The gap this file pays down is one level up: the LMS
// PAGE-CONTENT components (notification-center-content.tsx, notification-prefs-
// content.tsx, forum-thread-list-content.tsx, forum-thread-detail-content.tsx,
// gamification-section.tsx) that COMPOSE those primitives with data-fetching hooks
// have ZERO test coverage today, and apps/lms has no way to render them.
//
// Per the QA task instructions ("if no a11y harness exists ... add role/label
// assertions instead"): this file asserts, at the SOURCE level (no rendering, no new
// dependency), that the specific ARIA/label/live-region patterns already present in
// these five components (loading `role="status"` + `aria-busy` + `aria-label`, icon-
// only buttons carrying `aria-label`, form `<label htmlFor>` pairing + `aria-required`,
// error regions using `role="alert"`, success/status regions using `role="status"`,
// section landmarks using `aria-labelledby` matched to a real heading `id`, character-
// count live regions using `aria-live="polite"`) are present and cannot silently
// regress. This is a deterministic regression guard, not a substitute for a real axe
// pass — recorded as a followup (see final QA report) to wire `@testing-library/react`
// + `jest-axe` (or a Playwright + `@axe-core/playwright` e2e pass, given Playwright is
// already a listed dependency) for apps/lms in a future wave.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(relPath: string): string {
  return readFileSync(join(__dirname, relPath), "utf8");
}

describe("Notification Center (notification-center-content.tsx) — a11y patterns", () => {
  const src = readSource("./notifications/notification-center-content.tsx");

  it("loading skeleton announces itself to assistive tech", () => {
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-busy="true"');
    expect(src).toContain('aria-label="Loading notifications"');
  });

  it("'mark all read' has an explicit accessible name (not icon-only)", () => {
    expect(src).toContain('aria-label="Mark all notifications as read"');
  });

  it("the icon-only preferences link has both aria-label and a visible sr-only label", () => {
    expect(src).toContain('aria-label="Notification preferences"');
    expect(src).toContain("sr-only");
  });

  it("the unread-count pill carries an accessible label (not color/number-only)", () => {
    expect(src).toContain("aria-label={`${unreadCount} unread`}");
  });
});

describe("Notification Preferences (notification-prefs-content.tsx) — a11y patterns", () => {
  const src = readSource("./notifications/notification-prefs-content.tsx");

  it("loading skeleton announces itself to assistive tech", () => {
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-busy="true"');
    expect(src).toContain('aria-label="Loading notification preferences"');
  });

  it("the icon-only back link has an accessible name", () => {
    expect(src).toContain('aria-label="Back to notifications"');
  });

  it("the save button has an explicit accessible name", () => {
    expect(src).toContain('aria-label="Save notification preferences"');
  });

  it("save success is announced via role=status; save error via role=alert (not color-only)", () => {
    expect(src).toContain('role="status"');
    expect(src).toContain('role="alert"');
  });
});

describe("Forum Thread List (forum-thread-list-content.tsx) — a11y patterns", () => {
  const src = readSource("./forum/forum-thread-list-content.tsx");

  it("the icon-only 'new thread' button has an accessible name", () => {
    expect(src).toContain('aria-label="Create a new forum thread"');
  });

  it("the create-thread form fields are properly labelled (label+htmlFor, not placeholder-only)", () => {
    expect(src).toContain('htmlFor="thread-title"');
    expect(src).toContain('id="thread-title"');
    expect(src).toContain('htmlFor="thread-body"');
    expect(src).toContain('id="thread-body"');
    expect(src).toContain('aria-required="true"');
  });

  it("the icon-only cancel button has an accessible name", () => {
    expect(src).toContain('aria-label="Cancel creating thread"');
  });

  it("form errors use role=alert; the character counter is a polite live region", () => {
    expect(src).toContain('role="alert"');
    expect(src).toContain('aria-live="polite"');
  });
});

describe("Forum Thread Detail (forum-thread-detail-content.tsx) — a11y patterns", () => {
  const src = readSource("./forum/forum-thread-detail-content.tsx");

  it("loading skeleton announces itself to assistive tech", () => {
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-busy="true"');
    expect(src).toContain('aria-label="Loading thread"');
  });

  it("the reply textarea is labelled (sr-only label + htmlFor, not placeholder-only)", () => {
    expect(src).toContain('htmlFor="reply-body"');
    expect(src).toContain('id="reply-body"');
    expect(src).toContain("sr-only");
    expect(src).toContain('aria-required="true"');
  });

  it("the icon-only reply-cancel button has an accessible name", () => {
    expect(src).toContain('aria-label="Cancel reply"');
  });

  it("reply errors use role=alert; the character counter is a polite live region", () => {
    expect(src).toContain('role="alert"');
    expect(src).toContain('aria-live="polite"');
  });

  it("post bodies are DOMPurify-sanitized before reaching the dangerouslySetInnerHTML sink (AC-70)", () => {
    expect(src).toContain("sanitizeHtml(post.body)");
  });
});

describe("Gamification section (gamification-section.tsx) — a11y patterns", () => {
  const src = readSource("./progress/gamification-section.tsx");

  it("loading skeleton announces itself to assistive tech", () => {
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-busy="true"');
    expect(src).toContain('aria-label="Loading gamification"');
  });

  it("the Stats and Leaderboard sections are landmarked via aria-labelledby matched to a real heading id", () => {
    expect(src).toContain('aria-labelledby="stats-heading"');
    expect(src).toContain('id="stats-heading"');
    expect(src).toContain('aria-labelledby="leaderboard-heading"');
    expect(src).toContain('id="leaderboard-heading"');
  });

  it("the leaderboard opt-in checkbox has an explicit accessible name (LOCK-D5 opt-in control)", () => {
    expect(src).toContain('aria-label="Appear on batch leaderboard"');
  });
});
