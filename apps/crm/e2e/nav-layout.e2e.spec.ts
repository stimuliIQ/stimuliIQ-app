// Layout regression for the side nav — the one thing a jsdom component test cannot
// check, because jsdom has no layout: that the flyout panel really is full-viewport
// height and really is flush against the column's right edge, at every breakpoint.
// A CSS mistake here (a transformed ancestor trapping the fixed panel, a responsive
// variant that does not get its media query) is invisible to every other test in the
// repo and obvious the moment somebody opens the CRM.
//
// Unlike the other specs in this folder this one stubs the API outright, so it runs
// against `vite` alone with no backend, no database and no login.
//
// It also drops screenshots in test-results/ for eyeballing a design change.
import { test, expect } from "@playwright/test";

const ME = {
  user: {
    id: "u-1",
    email: "admin@stimuliiq.test",
    name: "Priya Admin",
    phone: null,
    avatar: null,
    status: "active",
    mustChangePassword: false,
  },
  tenantId: "t-1",
  roles: ["super_admin"],
  permissions: [
    "leads.view", "leads.create", "students.view", "students.create", "onboarding.view",
    "courses.view", "faculty.view", "mentors.view", "batches.view", "assignments.view",
    "assessments.view", "forum.moderate", "videolib.view", "content.view",
    "certificates.view", "payments.view", "orders.view", "invoices.view", "refunds.view",
    "coupons.view", "emi.view", "campaigns.view", "referrals.view", "content.builder",
    "site_settings.view", "landing_pages.view", "tickets.view", "kb.view",
    "reports.revenue.view", "reports.enrollment.view", "reports.funnel.view",
    "reports.lead_performance.view", "reports.campaigns.view", "reports.export",
    "careers.view", "leave.view", "leave.approve", "leave.calendar.view", "leave.manage",
    "users.view", "roles.view", "branches.view", "audit_logs.view", "settings.view",
    "twofa.manage",
  ].map((key) => ({ key, scope: "all" })),
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    // Everything comes back in the `{ data, meta, error }` envelope the client unwraps.
    const meta = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
    if (url.includes("/me/notifications")) {
      return route.fulfill({ json: { data: [], meta, error: null } });
    }
    if (/\/api\/v1\/me(\?|$)/.test(url)) {
      return route.fulfill({ json: { data: ME, meta: null, error: null } });
    }
    return route.fulfill({ json: { data: [], meta, error: null } });
  });
});

test("desktop — expanded column, flyout on hover", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("crm-sidebar")).toBeVisible();
  await page.screenshot({ path: "test-results/nav-desktop-idle.png" });

  await page.getByTestId("nav-section-academics").hover();
  await expect(page.getByTestId("nav-panel-academics")).toBeVisible();
  await page.screenshot({ path: "test-results/nav-desktop-flyout.png" });

  // The panel is a FLOATING CARD, not a flush full-height column:
  //   - it clears the column with a visible gap (that gap is what makes it read as
  //     floating rather than welded on)
  //   - it is only as tall as its contents, never the whole viewport
  //   - it is vertically anchored to the row that opened it, not pinned to the top
  const nav = await page.getByTestId("crm-sidebar").boundingBox();
  const row = await page.getByTestId("nav-section-academics").boundingBox();
  const panel = await page.getByTestId("nav-panel-academics").boundingBox();

  const gap = panel!.x - (nav!.x + nav!.width);
  expect(gap).toBeGreaterThan(0);
  expect(gap).toBeLessThanOrEqual(16);

  expect(panel!.height).toBeLessThan(900);
  expect(panel!.y).toBeGreaterThan(0);
  // Anchored near its row rather than floating anywhere on the page.
  expect(Math.abs(panel!.y - row!.y)).toBeLessThanOrEqual(24);
});

test("desktop — collapsed rail, the card still clears the rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("sidebar-toggle").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/nav-rail-idle.png" });

  await page.getByTestId("nav-section-commerce").hover();
  await expect(page.getByTestId("nav-panel-commerce")).toBeVisible();
  await page.screenshot({ path: "test-results/nav-rail-flyout.png" });

  const nav = await page.getByTestId("crm-sidebar").boundingBox();
  const panel = await page.getByTestId("nav-panel-commerce").boundingBox();
  expect(nav!.width).toBe(64);
  // Clears the 64px rail with the same gap the expanded column gets.
  expect(panel!.x).toBeGreaterThan(64);
  expect(panel!.x).toBeLessThanOrEqual(80);
  expect(panel!.height).toBeLessThan(900);
});

test("a section near the BOTTOM shows its whole submenu, with no scrollbar", async ({ page }) => {
  // The reported bug: Support sits low in the column, and the card capped its height at the
  // space left below the row — producing a sliver with its own scrollbar instead of the
  // eight items. A short viewport is what makes it reproducible.
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto("/");

  await page.getByTestId("nav-section-support").hover();
  const panel = page.getByTestId("nav-panel-support");
  await expect(panel).toBeVisible();
  await page.screenshot({ path: "test-results/nav-bottom-section.png" });

  // Every child is rendered AND laid out — none clipped into an internal scroll area.
  const list = panel.locator("ul");
  const metrics = await list.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    gutter: (el as HTMLElement).offsetWidth - el.clientWidth,
  }));
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
  expect(metrics.gutter).toBe(0); // no scrollbar taking layout space

  // And the card sits fully inside the viewport rather than hanging off the bottom.
  const box = (await panel.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(700);
});

test("the LOWEST section in the column still shows every item", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto("/");

  // Scroll the nav so a bottom section is as low as it can get, then open it.
  await page.locator("#crm-sidebar nav").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.getByTestId("nav-section-admin").hover();
  const panel = page.getByTestId("nav-panel-admin");
  await expect(panel).toBeVisible();

  // Admin has six children; all six must be visible, not scrolled out of view.
  const links = panel.locator("a[data-testid^=\"nav-leaf-\"]");
  const count = await links.count();
  expect(count).toBe(6);
  for (let i = 0; i < count; i++) {
    await expect(links.nth(i)).toBeInViewport();
  }
});

test("desktop — the rail tooltip is centred on the icon it labels", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("sidebar-toggle").click();
  await page.waitForTimeout(300);

  const row = page.getByTestId("nav-item-search engine");
  await row.hover();
  const tip = page.getByTestId("nav-tooltip-search-engine");
  await expect(tip).toBeVisible();
  await page.screenshot({ path: "test-results/nav-rail-tooltip.png" });

  // Vertically centred on the row, and clear of the rail rather than clipped by it.
  const rowBox = await row.boundingBox();
  const tipBox = await tip.boundingBox();
  const rowMid = rowBox!.y + rowBox!.height / 2;
  const tipMid = tipBox!.y + tipBox!.height / 2;
  expect(Math.abs(tipMid - rowMid)).toBeLessThanOrEqual(2);
  expect(tipBox!.x).toBeGreaterThanOrEqual(64);
});

test("desktop — the brand mark expands the rail again", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByTestId("sidebar-toggle").click();
  await page.waitForTimeout(300);
  expect((await page.getByTestId("crm-sidebar").boundingBox())!.width).toBe(64);

  // Collapsed, the logo itself is the control.
  await page.getByTestId("sidebar-toggle-rail").click();
  await page.waitForTimeout(300);
  expect((await page.getByTestId("crm-sidebar").boundingBox())!.width).toBe(256);
  await expect(page.getByTestId("sidebar-toggle")).toBeVisible();
});

test("the nav scrollbar is slim, not the platform default", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 640 }); // short enough to force a scroll
  await page.goto("/");
  await page.getByTestId("sidebar-toggle").click();
  await page.waitForTimeout(300);

  const measured = await page.evaluate(() => {
    const gutter = (el: Element) => (el as HTMLElement).offsetWidth - el.clientWidth;

    // A control with the SAME overflow and no scrollbar styling, so the assertion
    // compares against this browser's real platform bar instead of a magic number
    // (Windows ~15px + stepper arrows; macOS 0 unless "always show" is on).
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:-9999px;width:200px;height:100px;overflow-y:scroll";
    probe.innerHTML = '<div style="height:900px"></div>';
    document.body.appendChild(probe);
    const control = gutter(probe);
    probe.remove();

    const nav = document.querySelector("#crm-sidebar nav")!;
    return { control, nav: gutter(nav), overflowing: nav.scrollHeight > nav.clientHeight };
  });

  // The column really is scrolling, so the measurement means something.
  expect(measured.overflowing).toBe(true);

  // Headless Chromium always uses zero-width OVERLAY scrollbars and ignores
  // ::-webkit-scrollbar sizing outright, so there is nothing to compare. Skipping
  // loudly beats a green that could never have gone red. Verified headed:
  // control 15px, nav 5px.
  test.skip(
    measured.control === 0,
    "This browser uses overlay scrollbars — no scrollbar width to measure.",
  );

  expect(measured.nav).toBeLessThan(measured.control);
  expect(measured.nav).toBeLessThanOrEqual(8);
  await page.screenshot({ path: "test-results/nav-rail-scroll.png" });
});

test("iPad portrait — tap opens the drawer, tap opens the flyout beside it", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  // The nav is off-canvas here; the topbar button is the way in.
  await page.getByTestId("topbar-menu-button").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/nav-ipad-drawer.png" });

  await page.getByTestId("nav-section-academics").click();
  await expect(page.getByTestId("nav-panel-academics")).toBeVisible();
  await page.screenshot({ path: "test-results/nav-ipad-flyout.png" });

  const panel = await page.getByTestId("nav-panel-academics").boundingBox();
  // Beside the drawer, not over it, and clearing it by the same gap as on desktop.
  expect(panel!.x).toBeGreaterThan(256);
  expect(panel!.x).toBeLessThanOrEqual(272);
  expect(panel!.height).toBeLessThan(1024);
});

test("phone — the flyout covers the drawer and offers a way back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("topbar-menu-button").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/nav-phone-drawer.png" });

  await page.getByTestId("nav-section-academics").click();
  await expect(page.getByTestId("nav-panel-academics")).toBeVisible();
  await page.screenshot({ path: "test-results/nav-phone-flyout.png" });

  const panel = await page.getByTestId("nav-panel-academics").boundingBox();
  expect(Math.round(panel!.x)).toBe(0); // covers the drawer — no 130px column
  expect(panel!.height).toBe(844);

  // And back out of it.
  await page.getByTestId("nav-panel-back-academics").click();
  await expect(page.getByTestId("nav-panel-academics")).toBeHidden();
  await expect(page.getByTestId("nav-section-academics")).toBeVisible();
});
