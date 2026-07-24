// The single-lifecycle journey, end-to-end through the CRM UI
// (lifecycle-redesign P2/P5):
//
//   Lead → Registration → Program Assignment → Payment → Active → Learning →
//   Completed → Certified
//
// One person is walked LIVE from lead to ACTIVE STUDENT (create lead → advance
// stage → convert with program+batch, which opens an order → record an offline
// payment from the Payments tab, which captures + marks the order paid + creates
// the enrollment atomically), asserting the derived LifecycleChip and the
// LifecycleStepper "you are here" path at every hop. The remaining tail of the
// spine (learning/completed/certified) is asserted on the SEEDED students whose
// underlying facts already encode those stages (Ananya: lesson progress → Learning
// In Progress; Sneha: issued certificate → Certified) — course completion +
// certificate issuance are covered by the certificates unit/integration suites.
//
// Requires: API on :4000, seeded DB, QA_ADMIN_PASSWORD. Creates a lead + student
// with a unique run stamp; cleans both up best-effort in finally.
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

/** Radix-style Select helper: open by testid, choose an option by accessible name. */
async function pickOption(page: Page, triggerTestId: string, option: RegExp | string): Promise<void> {
  await page.getByTestId(triggerTestId).click();
  await page.getByRole("option", { name: option }).click();
}

/** The stepper phase currently marked as "you are here". */
function currentStep(page: Page, phase: string) {
  return page.locator(`[data-testid="lifecycle-step-${phase}"][data-state="current"]`);
}

test.describe("Lifecycle journey — one person along the Lead → Certified spine", () => {
  test.skip(!ADMIN_PASSWORD, "Requires QA_ADMIN_PASSWORD env var.");

  test("lead → registration → program+payment via UI; learning/certified via seeded students", async ({
    page,
  }) => {
    // The longest journey in the suite (~25s solo, slower when the whole suite runs
    // in parallel against one local API) — slow() triples the 30s file default.
    test.slow();
    const stamp = Date.now();
    const leadName = `Journey E2E ${stamp}`;
    const email = `journey-e2e-${stamp}@stimuliiq.test`;
    const phone = `+9198${String(stamp).slice(-8)}`;

    await login(page);

    try {
      // ── 1. LEAD: lands in the pipeline as New Lead ─────────────────────────
      await page.goto("/leads");
      await page.getByTestId("pipeline-create-button").click();
      await expect(page.getByTestId("lead-create-drawer")).toBeVisible();
      await page.getByTestId("lead-form-name").fill(leadName);
      await page.getByTestId("lead-form-phone").fill(phone);
      await page.getByTestId("lead-form-email").fill(email);
      await page.getByTestId("lead-form-source").fill("e2e-journey");
      await page.getByTestId("lead-form-submit").click();
      await expect(page.getByTestId("lead-create-drawer")).not.toBeVisible({ timeout: 10_000 });

      // Open our lead (table view is deterministic to search).
      await page.getByTestId("pipeline-view-table").click();
      await page.getByPlaceholder(/name \/ phone \/ email/i).fill(leadName);
      await page.getByRole("row", { name: new RegExp(leadName) }).click();
      await expect(page.getByTestId("lead-detail-drawer")).toBeVisible();

      // The journey path renders, with the Lead phase current.
      await expect(page.getByTestId("lifecycle-stepper")).toBeVisible();
      await expect(currentStep(page, "lead")).toHaveCount(1);

      // ── 2. CONVERT directly — one click, no linear stepping (2026-07 redesign) ──
      // The 4-stage model (new → follow_up → won | lost) lets staff convert a lead from
      // ANY non-lost stage in one click. No ladder to walk: the lead is still "new" (Lead
      // phase) and we convert straight to a student. Converting with a program+batch opens
      // an order, so the new student's derived stage lands in the Payment phase.
      await page.getByTestId("lead-detail-convert-button").click();
      await expect(page.getByTestId("convert-lead-drawer")).toBeVisible();
      await expect(page.getByTestId("convert-lead-email")).toHaveValue(email);
      await pickOption(page, "convert-lead-course-type", /b\.?tech/i);
      await page.getByTestId("convert-lead-program").click();
      // First real program (skip the "No order" sentinel).
      await page.getByRole("option").filter({ hasNotText: /no order/i }).first().click();
      await page.getByTestId("convert-lead-batch").click();
      await page.getByRole("option").first().click();
      await page.getByTestId("convert-lead-submit").click();
      await expect(page.getByTestId("convert-lead-drawer")).not.toBeVisible({ timeout: 15_000 });

      // ── 4. The student record now answers "where are they?": Payment phase ─
      await page.goto("/students");
      await page.getByTestId("data-filter-bar-search").fill(email);
      const row = page.getByRole("row", { name: new RegExp(email) });
      await expect(row).toContainText("Payment Pending", { timeout: 10_000 });
      await row.click();
      await expect(page.getByTestId("student-detail-shell")).toBeVisible({ timeout: 15_000 });
      await expect(currentStep(page, "payment")).toHaveCount(1);
      // Everything the person already passed reads done; everything ahead upcoming.
      await expect(page.locator('[data-testid="lifecycle-step-lead"][data-state="done"]')).toHaveCount(1);
      await expect(
        page.locator('[data-testid="lifecycle-step-certified"][data-state="upcoming"]'),
      ).toHaveCount(1);

      // ── 4b. PAYMENT → ACTIVE: record the offline payment from the Payments tab.
      // The pending order shows the program package + amount; recording captures the
      // payment, marks the order paid, and creates the enrollment atomically.
      await page.getByRole("tab", { name: "Payments" }).click();
      const recordButton = page.locator('[data-testid^="record-payment-"]').first();
      await expect(recordButton).toBeVisible({ timeout: 10_000 });
      await recordButton.click();
      await expect(page.getByTestId("manual-payment-drawer")).toBeVisible();
      // Order id + amount are prefilled from the order row; only method/reference needed.
      await page.getByTestId("manual-payment-method").fill("cash");
      await page.getByTestId("manual-payment-reference").fill(`e2e-journey-${stamp}`);
      await page.getByTestId("manual-payment-submit").click();
      await expect(page.getByTestId("manual-payment-drawer")).not.toBeVisible({ timeout: 15_000 });

      // The journey path advances to Active and the enrollment now exists.
      await expect(currentStep(page, "active")).toHaveCount(1, { timeout: 10_000 });
      await expect(page.locator('[data-testid="lifecycle-step-payment"][data-state="done"]')).toHaveCount(1);
      await page.getByRole("tab", { name: "Enrollments" }).click();
      await expect(page.getByTestId("student-enrollments-table").getByRole("row").nth(1)).toBeVisible({
        timeout: 10_000,
      });
      await page.getByRole("button", { name: /close panel/i }).click();
      await expect(page.getByTestId("student-detail-drawer")).not.toBeVisible({ timeout: 10_000 });

      // ── 5. LEARNING: seeded Ananya has real lesson progress ────────────────
      await page.getByTestId("data-filter-bar-search").fill("student.ananya@stimuliiq.test");
      // 15s: under a full parallel suite run the directory search (which computes
      // lifecycle signals per row) can take well over the default 5s.
      await expect(page.getByRole("row", { name: /Ananya Gupta/ })).toContainText("Learning In Progress", {
        timeout: 15_000,
      });
      await page.getByRole("row", { name: /Ananya Gupta/ }).click();
      await expect(page.getByTestId("student-detail-shell")).toBeVisible({ timeout: 15_000 });
      await expect(currentStep(page, "learning")).toHaveCount(1);
      await page.getByRole("button", { name: /close panel/i }).click();
      await expect(page.getByTestId("student-detail-drawer")).not.toBeVisible({ timeout: 10_000 });

      // ── 6. CERTIFIED: seeded Sneha holds an issued certificate — top of ladder
      await page.getByTestId("data-filter-bar-search").fill("student.sneha@stimuliiq.test");
      await expect(page.getByRole("row", { name: /Sneha Iyer/ })).toContainText("Certified", { timeout: 15_000 });
      await page.getByRole("row", { name: /Sneha Iyer/ }).click();
      await expect(page.getByTestId("student-detail-shell")).toBeVisible({ timeout: 15_000 });
      await expect(currentStep(page, "certified")).toHaveCount(1);
      // Certified = every prior phase done.
      await expect(page.locator('[data-testid^="lifecycle-step-"][data-state="done"]')).toHaveCount(7);
      await page.getByRole("button", { name: /close panel/i }).click();
      await expect(page.getByTestId("student-detail-drawer")).not.toBeVisible({ timeout: 10_000 });
    } finally {
      // ── Cleanup (best-effort): delete the created student, then the lead ───
      await page
        .goto("/students")
        .then(async () => {
          await page.getByTestId("data-filter-bar-search").fill(email);
          await page.getByRole("row", { name: new RegExp(email) }).click();
          await page.getByTestId("student-detail-shell").waitFor({ timeout: 10_000 });
          await page.getByTestId("student-delete-button").click();
          await page.getByTestId("confirm-dialog-confirm").click();
          await page.getByTestId("student-delete-confirm").waitFor({ state: "hidden", timeout: 10_000 });
        })
        .catch(() => {
          /* never mask the journey assertions */
        });
      await page
        .goto("/leads")
        .then(async () => {
          await page.getByTestId("pipeline-view-table").click();
          await page.getByPlaceholder(/name \/ phone \/ email/i).fill(leadName);
          await page.getByRole("row", { name: new RegExp(leadName) }).click();
          await page.getByTestId("lead-detail-delete-button").click();
          await page.getByTestId("lead-delete-confirm").waitFor({ timeout: 5_000 });
          await page.getByTestId("confirm-dialog-confirm").click();
        })
        .catch(() => {
          /* best-effort */
        });
    }
  });
});
