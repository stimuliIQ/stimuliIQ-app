// apps/crm/e2e/student-duplicate-email.e2e.spec.ts
//
// Critical-journey e2e for the "Email already in use" defect:
//
//   1. DUPLICATE EMAIL → the conflict is pinned to the EMAIL FIELD (not just a
//      toast that vanishes), and the message names WHAT holds the address
//      instead of the opaque "A user with this email already exists in this
//      tenant." The drawer stays open so the fix is made where the mistake is.
//
//   2. DELETE → RE-ADD → soft-deleting a student deletes only `student_profiles`;
//      the backing `users` row (and its tenant-unique email) survives. Before the
//      fix, re-adding that person was IMPOSSIBLE — the create path saw the live
//      user row and rejected forever. Now the create path restores the deleted
//      profile and applies the submitted details.
//
// SERVER-DEPENDENT: needs a real running API + this app's dev server + a real
// staff account (QA_ADMIN_PASSWORD). Every record it creates uses a unique
// `e2e-dupe-<timestamp>@…` email and is soft-deleted in a `finally`, so repeated
// runs against a shared dev DB stay clean.
import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL ?? "admin@stimuliiq.test";
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  // Target the inputs by id — getByLabel("Password") is ambiguous (the show/hide
  // toggle button carries an aria-label containing "password" too).
  await page.locator("#login-email").fill(ADMIN_EMAIL);
  await page.locator("#login-password").fill(ADMIN_PASSWORD!);
  await page.getByTestId("login-card").getByRole("button", { name: /sign in/i }).click();
  // SPA pushState navigation — assert on DOM state, not a `load` event.
  await expect(page.getByTestId("login-card")).not.toBeVisible({ timeout: 15_000 });
}

/**
 * Fills the Add-student (contact) drawer and submits. Leaves the drawer state to
 * the caller. City moved to the REGISTRATION step (lifecycle-redesign) — the
 * create form is contact-only (name/email/phone/course type/source), and a
 * successful create auto-opens the Register dialog, which we dismiss here since
 * these tests exercise the create/duplicate/restore contract, not registration.
 */
async function submitNewStudent(page: Page, fields: { name: string; email: string }): Promise<void> {
  await page.getByTestId("students-create-button").click();
  await expect(page.getByTestId("student-create-drawer")).toBeVisible();
  await page.getByTestId("student-form-name").fill(fields.name);
  await page.getByTestId("student-form-email").fill(fields.email);
  await page.getByTestId("student-form-course-type").click();
  await page.getByRole("option", { name: "B.Tech" }).click();
  await page.getByTestId("student-form-submit").click();
}

/** Dismisses the auto-opened Register dialog after a successful contact create. */
async function dismissRegisterDialog(page: Page): Promise<void> {
  await expect(page.getByTestId("register-student-drawer")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("register-form-later").click();
  await expect(page.getByTestId("register-student-drawer")).not.toBeVisible({ timeout: 10_000 });
}

/** Opens a student row by searching for its email, then soft-deletes it. */
async function deleteStudentByEmail(page: Page, email: string): Promise<void> {
  await page.goto("/students");
  await page.getByTestId("data-filter-bar-search").fill(email);
  await page.getByRole("cell", { name: email }).click();
  await expect(page.getByTestId("student-detail-drawer")).toBeVisible();
  await page.getByTestId("student-delete-button").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("student-delete-confirm")).not.toBeVisible({ timeout: 10_000 });
}

test.describe("Students — duplicate email conflict + delete/re-add round trip", () => {
  test.skip(!ADMIN_PASSWORD, "Requires QA_ADMIN_PASSWORD env var.");

  test("a taken email errors ON the Email field naming what holds it; a deleted student can be re-added", async ({
    page,
  }) => {
    // Five UI phases (create → conflict → delete → re-add → verify) plus two
    // register-dialog dismissals — routinely ~26s solo, over 30s under a
    // parallel suite run. slow() triples the file default.
    test.slow();
    const stamp = Date.now();
    const email = `e2e-dupe-${stamp}@stimuliiq.test`;

    await login(page);
    await page.goto("/students");

    try {
      // ── 1. Create the original record ────────────────────────────────────
      await submitNewStudent(page, { name: "Dupe Original", email });
      await expect(page.getByTestId("student-create-drawer")).not.toBeVisible({ timeout: 10_000 });
      await dismissRegisterDialog(page);

      // ── 2. Same email again → field-level conflict, drawer stays open ─────
      await submitNewStudent(page, { name: "Dupe Attempt", email });

      const emailField = page.getByTestId("student-form-email");
      const conflict = page.getByText(/already belongs to/i);
      await expect(conflict).toBeVisible({ timeout: 10_000 });
      // Names the holder — the whole point of the message change.
      await expect(conflict).toContainText(/existing student/i);
      // The error is attached to the field, and the drawer did NOT close.
      await expect(emailField).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByTestId("student-create-drawer")).toBeVisible();

      await page.getByTestId("student-form-cancel").click();

      // ── 3. Delete, then re-add the SAME email → restores, does not reject ──
      await deleteStudentByEmail(page, email);

      await page.goto("/students");
      await submitNewStudent(page, { name: "Dupe Readded", email });
      await expect(page.getByTestId("student-create-drawer")).not.toBeVisible({ timeout: 10_000 });
      await dismissRegisterDialog(page);

      // The re-added record is live and carries the NEW details (restore applied the patch).
      // Assert on the ROW keyed by this run's unique email — asserting on the name alone
      // would strict-mode-violate against rows any earlier run left behind.
      await page.getByTestId("data-filter-bar-search").fill(email);
      await expect(page.getByRole("row", { name: new RegExp(email) })).toContainText("Dupe Readded", {
        timeout: 10_000,
      });
    } finally {
      await deleteStudentByEmail(page, email).catch(() => {
        /* best-effort cleanup — never mask the real assertion failure */
      });
    }
  });
});
