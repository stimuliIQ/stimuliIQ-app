// apps/crm/e2e/csrf-rotation.e2e.spec.ts
//
// Regression: "Couldn't update booking status — X-CSRF-Token header must match the
// csrf_token cookie on unsafe requests."
//
// CSRF is double-submit: the header must equal the CURRENT `csrf_token` cookie. The
// server ROTATES that cookie on every login/refresh/2FA-verify, but @repo/api-client
// preferred an IN-MEMORY snapshot of the token (primed at login) over the live cookie.
// The snapshot goes stale as soon as anything else rotates the cookie — another tab, or
// the lms/web app, which on localhost share one cookie jar across ports. The client then
// sent a stale header against a fresh cookie and the server (correctly) rejected it.
// The cookie is now the source of truth; the in-memory value is an SSR-only fallback.
//
// This spec reproduces the exact sequence: log in, stay on the SAME SPA instance (a page
// reload would rebuild the client and mask the bug), rotate the cookie from another tab,
// then mutate. Before the fix this failed 401 `auth.csrf_mismatch`.
//
// The mutation under test is a saved-view create + delete rather than the booking status
// change that surfaced the bug: the CSRF guard is generic to every unsafe CRM request,
// and a saved view is REPEATABLE and self-cleaning. (Moving a booking marches it toward a
// terminal status, so the spec would starve itself of a movable row after one run.)
//
// SERVER-DEPENDENT: needs a running API + CRM.
import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL ?? "admin@stimuliiq.test";
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#login-email").fill(ADMIN_EMAIL);
  await page.locator("#login-password").fill(ADMIN_PASSWORD!);
  await page.getByTestId("login-card").getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByTestId("login-card")).not.toBeVisible({ timeout: 15_000 });
}

/**
 * The CRM's CSRF cookie. Audience-scoped (`crm_csrf_token`) since the dual-login fix,
 * with the legacy unprefixed name accepted as a fallback exactly as the API's own
 * `csrfCookieCandidates` does.
 */
function readCsrfCookie(cookies: Array<{ name: string; value: string }>): string | undefined {
  return (
    cookies.find((c) => c.name === "crm_csrf_token")?.value ??
    cookies.find((c) => c.name === "csrf_token")?.value
  );
}

test.describe("CSRF — cookie rotated by another tab", () => {
  test.skip(!ADMIN_PASSWORD, "Requires QA_ADMIN_PASSWORD env var.");

  test("an unsafe mutation still succeeds after the csrf_token cookie is rotated elsewhere", async ({
    page,
    context,
  }) => {
    const mutations: Array<{ status: number; body: string }> = [];
    page.on("response", async (res) => {
      if (["PATCH", "POST", "PUT", "DELETE"].includes(res.request().method()) && res.url().includes("/crm/")) {
        mutations.push({ status: res.status(), body: await res.text().catch(() => "") });
      }
    });

    await login(page);

    // Navigate through the SPA — NOT page.goto(). A full reload would construct a fresh
    // ApiClient with no in-memory token, which is precisely the state that hides this bug.
    // "Students" is a nav GROUP now (Directory / Import), not a link — clicking the
    // group opens it, and the leaf is what navigates. This spec still looked for a
    // top-level "Students" link and waited 30s for one that no longer exists.
    await page.getByRole("button", { name: "Students" }).click();
    await page.getByRole("link", { name: "Directory" }).click();
    await expect(page.getByTestId("students-directory")).toBeVisible({ timeout: 15_000 });

    // `crm_csrf_token`, not `csrf_token`. Cookie slots became audience-scoped when the
    // dual-login fix landed (auth/lib/cookies.ts: crm_ / lms_ prefixes) so a CRM tab and
    // an LMS tab can share a browser without overwriting each other's session. This spec
    // still read the legacy unprefixed name and therefore found nothing at all.
    const before = readCsrfCookie(await context.cookies());
    expect(before).toBeTruthy();

    // Rotate the shared cookie behind this tab's back (what a refresh in any other tab
    // on the same origin/cookie jar does). Refresh is itself CSRF-guarded, so echo the
    // current cookie.
    const other = await context.newPage();
    await other.goto("/");
    const refreshStatus = await other.evaluate(async (apiUrl) => {
      // Same audience-scoped name as above; the legacy fallback mirrors the API's own
      // `csrfCookieCandidates`, which still accepts an unprefixed cookie.
      const cookies = document.cookie.split("; ");
      const csrf = (cookies.find((c) => c.startsWith("crm_csrf_token=")) ??
        cookies.find((c) => c.startsWith("csrf_token=")))?.split("=")[1];
      const res = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": csrf ?? "" },
      });
      return res.status;
    }, process.env.VITE_API_URL ?? "http://localhost:4000");
    await other.close();
    expect(refreshStatus).toBe(200);

    const after = readCsrfCookie(await context.cookies());
    expect(after).not.toBe(before); // the cookie really did rotate — the setup is valid

    // The original tab's in-memory token is now stale. Its next unsafe request must still
    // work — before the fix this POST came back 401 auth.csrf_mismatch.
    const viewName = `csrf-e2e-${Date.now()}`;
    await page.getByTestId("data-filter-bar-save-view").click();
    await page.getByTestId("data-filter-bar-view-name-input").fill(viewName);
    await page.getByTestId("data-filter-bar-save-view-confirm").click();

    // Scoped to the toast element — a bare getByText also matches Radix Toast's
    // visually-hidden role="status" announcer ("Notification View saved") while it
    // holds the same text, which strict-mode-violates intermittently.
    await expect(page.getByTestId("toast").filter({ hasText: /View saved/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect.poll(() => mutations.at(-1)?.status, { timeout: 10_000 }).toBe(201);
    expect(mutations.map((m) => m.body).join("")).not.toContain("auth.csrf_mismatch");

    // Clean up — itself another unsafe (DELETE) request on the same stale-token client.
    // By accessible name, so it targets THIS view's delete button (several saved views may
    // exist) regardless of chip markup. The button only becomes visible on hover, so
    // force the click rather than fighting the CSS transition.
    await page
      .getByRole("button", { name: `Delete saved view: ${viewName}` })
      .click({ force: true });

    await expect(page.getByRole("button", { name: viewName, exact: true })).toHaveCount(0, {
      timeout: 10_000,
    });
    expect(mutations.map((m) => m.body).join("")).not.toContain("auth.csrf_mismatch");
  });
});
