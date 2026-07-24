// apps/crm/e2e/student-360-tabs.e2e.spec.ts
//
// Student-360 drawer regression suite. Locks in three defects found by driving the
// real UI for the seeded COMPLETED student (Sneha Iyer):
//
//   1. A completed student's ISSUED CERTIFICATE was invisible — the CRM eligibility
//      query filtered enrollments to `status: "active"`, so finishing a program made
//      the student (and their certificate) vanish from the list that the Certificates
//      tab renders. Now `active` OR `completed`.
//   2. The drawer rendered the name + email TWICE (DrawerContent's header AND
//      DetailShell's own header).
//   3. The 7-tab row wraps to a second line, but TabsList had a FIXED height, so the
//      wrapped tab ("Timeline") spilled out of the list and overlapped the panel below.
//
// Read-only against seeded data — creates and mutates nothing.
//
// SERVER-DEPENDENT: needs a running API + dev server + seeded DB (`pnpm db:seed`) and
// QA_ADMIN_PASSWORD.
import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL ?? "admin@stimuliiq.test";
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD;

/** The seeded student who has COMPLETED their program (status alumni, shown as "Completed"). */
const COMPLETED_STUDENT = "Sneha Iyer";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#login-email").fill(ADMIN_EMAIL);
  await page.locator("#login-password").fill(ADMIN_PASSWORD!);
  await page.getByTestId("login-card").getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByTestId("login-card")).not.toBeVisible({ timeout: 15_000 });
}

test.describe("Student 360 drawer — completed student", () => {
  test.skip(!ADMIN_PASSWORD, "Requires QA_ADMIN_PASSWORD env var.");

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/students");
    // Search first — concurrently-running specs create students that can push
    // the seeded completed student off page 1, so relying on her row simply
    // being present flakes under a parallel suite run.
    await page.getByTestId("data-filter-bar-search").fill(COMPLETED_STUDENT);
    await page.getByRole("cell", { name: COMPLETED_STUDENT }).click();
    await expect(page.getByTestId("student-detail-drawer")).toBeVisible();
  });

  test("shows the issued certificate for a COMPLETED enrollment (was hidden by an active-only filter)", async ({
    page,
  }) => {
    await page.getByTestId("detail-shell-tab-certificates").click();

    const panel = page.getByTestId("detail-shell-panel-certificates");
    await expect(panel).toContainText("Data Science & Machine Learning Internship", { timeout: 10_000 });
    await expect(panel).toContainText("Issued");
    await expect(panel).toContainText("Eligible");
    // The verify handle (cert_uid) is what makes the certificate checkable publicly.
    // It is an HMAC-signed token — `<base64url payload>.<base64url signature>` — not a
    // readable slug; /verify recomputes the signature and rejects anything unsigned.
    await expect(panel).toContainText(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/);
    await expect(panel).not.toContainText("No certificate activity");
  });

  test("Enrollments names the program, batch and completion", async ({ page }) => {
    await page.getByTestId("detail-shell-tab-enrollments").click();

    const panel = page.getByTestId("detail-shell-panel-enrollments");
    await expect(panel).toContainText("Data Science & Machine Learning Internship", { timeout: 10_000 });
    await expect(panel).toContainText("Data Science & ML — Batch BLR-01");
    await expect(panel).toContainText("completed");
  });

  test("the header is not duplicated and the wrapped tab row does not overlap the panel", async ({ page }) => {
    // 1. Name renders once in the drawer, not twice (DrawerContent header only).
    await expect(page.getByTestId("student-detail-drawer").getByText(COMPLETED_STUDENT, { exact: true })).toHaveCount(1);

    // 2. The tab list wraps to a second row, so its box must actually CONTAIN the last
    //    tab — with the old fixed height the wrapped trigger spilled below the list and
    //    landed on top of the panel content.
    const list = page.getByRole("tablist");
    const lastTab = page.getByTestId("detail-shell-tab-timeline");
    const listBox = (await list.boundingBox())!;
    const tabBox = (await lastTab.boundingBox())!;
    expect(tabBox.y + tabBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1);

    // 3. …and the panel starts BELOW the tab list rather than underneath it.
    const panelBox = (await page.getByTestId("detail-shell-panel-overview").boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height - 1);
  });

  test("every tab opens and renders a panel (no crashes, no dead tabs)", async ({ page }) => {
    for (const tab of ["overview", "enrollments", "payments", "attendance", "certificates", "tickets", "timeline"]) {
      await page.getByTestId(`detail-shell-tab-${tab}`).click();
      await expect(page.getByTestId(`detail-shell-panel-${tab}`)).toBeVisible({ timeout: 10_000 });
    }
  });
});
