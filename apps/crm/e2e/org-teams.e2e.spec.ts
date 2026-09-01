// apps/crm/e2e/org-teams.e2e.spec.ts
//
// Organisation ▸ Teams, in a real browser (docs/specs/org-teams.md, ADR-0069).
//
// Stubs the API outright, like nav-layout.e2e.spec.ts, so it runs against `vite` alone with
// no backend, no database and no login. What it proves is what a jsdom component test
// cannot: that the screen the org chart is built on actually renders and is usable in a
// browser — the nav entry appears, the drawer opens, the pickers populate, and the shared
// validator's refusal reaches the screen and disables the save button.
//
// The live half of this journey — a request actually travelling lead → manager — is
// leave-two-step.e2e.spec.ts, which needs a real API.

import { test, expect } from "@playwright/test";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const MANAGER = { id: "22222222-2222-4222-8222-222222222222", name: "Ravi Manager", email: "ravi@x.test" };
const LEAD = { id: "33333333-3333-4333-8333-333333333333", name: "Priya Lead", email: "priya@x.test" };
const MEMBER = { id: "44444444-4444-4444-8444-444444444444", name: "Anil Member", email: "anil@x.test" };

/** A super admin: holds both org keys. */
const FULL_PERMISSIONS = ["org.teams.view", "org.teams.manage", "leave.view", "leave.calendar.view"];
/** Somebody who may read the chart but not rewrite it. */
const READ_ONLY_PERMISSIONS = ["org.teams.view", "leave.view"];

function me(permissionKeys: string[]) {
  return {
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
    permissions: permissionKeys.map((key) => ({ key, scope: "all" })),
  };
}

const COMPLETE_TEAM = {
  id: TEAM_ID,
  name: "Counselling",
  manager: MANAGER,
  lead: LEAD,
  branchId: null,
  branchName: null,
  active: true,
  memberCount: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

/** A team created before its lead was hired — the state the screen has to make visible. */
const INCOMPLETE_TEAM = { ...COMPLETE_TEAM, id: "55555555-5555-4555-8555-555555555555", name: "Support", lead: null, manager: null };

interface StubOptions {
  permissions?: string[];
  teams?: unknown[];
}

async function stubApi(page: import("@playwright/test").Page, options: StubOptions = {}): Promise<void> {
  const teams = options.teams ?? [COMPLETE_TEAM];
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    const meta = { page: 1, pageSize: 20, total: teams.length, hasMore: false };

    if (url.includes("/me/notifications")) {
      return route.fulfill({ json: { data: [], meta, error: null } });
    }
    if (/\/api\/v1\/me(\?|$)/.test(url)) {
      return route.fulfill({ json: { data: me(options.permissions ?? FULL_PERMISSIONS), meta: null, error: null } });
    }
    if (url.includes("/crm/org/staff")) {
      return route.fulfill({
        json: {
          data: [
            { ...MANAGER, teamId: null },
            { ...LEAD, teamId: null },
            { ...MEMBER, teamId: TEAM_ID },
          ],
          meta: null,
          error: null,
        },
      });
    }
    if (/\/crm\/org\/teams\/[0-9a-f-]+$/.test(url)) {
      return route.fulfill({ json: { data: { ...COMPLETE_TEAM, members: [MEMBER] }, meta: null, error: null } });
    }
    if (url.includes("/crm/org/teams")) {
      return route.fulfill({ json: { data: teams, meta, error: null } });
    }
    return route.fulfill({ json: { data: [], meta, error: null } });
  });
}

test.describe("Organisation ▸ Teams", () => {
  test("lists the org chart with its manager and lead", async ({ page }) => {
    await stubApi(page);
    await page.goto("/org/teams");

    await expect(page.getByTestId("teams-workspace")).toBeVisible();
    await expect(page.getByText("Counselling")).toBeVisible();
    await expect(page.getByText("Ravi Manager")).toBeVisible();
    await expect(page.getByText("Priya Lead")).toBeVisible();
  });

  test("says what a team is FOR, because adding somebody changes who signs off their leave", async ({ page }) => {
    await stubApi(page);
    await page.goto("/org/teams");

    await expect(page.getByTestId("teams-purpose-note")).toContainText("team lead");
    await expect(page.getByTestId("teams-purpose-note")).toContainText("manager");
  });

  test("flags an incomplete team instead of leaving the cell blank", async ({ page }) => {
    // A missing lead silently reroutes that team's leave to HR, and the person looking at
    // this list is the only one who can fix it. A blank cell would hide that entirely.
    await stubApi(page, { teams: [INCOMPLETE_TEAM] });
    await page.goto("/org/teams");

    await expect(page.getByText("Not set").first()).toBeVisible();
  });

  test("hides every write affordance from somebody who may only read the chart", async ({ page }) => {
    // The API is the real gate, but a button that always 403s is its own bug.
    await stubApi(page, { permissions: READ_ONLY_PERMISSIONS });
    await page.goto("/org/teams");

    await expect(page.getByText("Counselling")).toBeVisible();
    await expect(page.getByTestId("team-create-button")).toHaveCount(0);
    await expect(page.getByTestId(`delete-team-${TEAM_ID}`)).toHaveCount(0);
  });

  test("refuses a manager who is also the team lead, before submit", async ({ page }) => {
    // The shared `validateTeamAssignment` runs in the browser so the problem is named
    // immediately; the API refuses it again. This proves the browser half reaches the screen.
    await stubApi(page);
    await page.goto("/org/teams");

    await page.getByTestId("team-create-button").click();
    await expect(page.getByTestId("team-form-drawer")).toBeVisible();

    await page.getByTestId("team-form-name").fill("Duplicate People");
    await page.getByTestId("team-form-manager").click();
    await page.getByRole("option", { name: LEAD.name }).click();
    await page.getByTestId("team-form-lead").click();
    await page.getByRole("option", { name: LEAD.name }).click();

    await expect(page.getByTestId("team-form-issues")).toBeVisible();
    await expect(page.getByTestId("team-form-issues")).toContainText("different people");
    // And the save is not merely warned about — it is unavailable.
    await expect(page.getByTestId("team-form-save")).toBeDisabled();
  });

  test("offers 'No team lead yet' as a real choice, not a blank", async ({ page }) => {
    // A team created before its lead is hired is an honest state. Making it a named option
    // means somebody chose it rather than skipped the field.
    await stubApi(page);
    await page.goto("/org/teams");

    await page.getByTestId("team-create-button").click();
    await page.getByTestId("team-form-lead").click();

    await expect(page.getByRole("option", { name: "No team lead yet" })).toBeVisible();
  });

  test("says where somebody already on another team currently sits", async ({ page }) => {
    // A name missing from a list with no explanation is what gets reported as "the dropdown
    // is broken". The member picker marks them instead of hiding them.
    await stubApi(page);
    await page.goto("/org/teams");

    await page.getByTestId("team-create-button").click();
    await expect(page.getByText(`${MEMBER.name} · on another team`)).toBeVisible();
  });
});
