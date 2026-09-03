// apps/crm/e2e/team-scoped-reports.e2e.spec.ts
//
// The three team-scoped surfaces, against a real API (docs/specs/org-teams.md §5b):
//   marketing targets · the lead-performance report · the leave calendar's "My team".
//
// All three follow one rule — THE PERMISSION IS UNIFORM, THE ORG CHART DECIDES — and this
// spec exists to prove that rule holds where it matters: that a manager sees strictly LESS
// than the owner, and that the difference is exactly their own people.
//
// A narrowing is the kind of thing that passes a unit test with a mocked repository and
// still leaks in production, because the mock returns whatever the test asked for. Here the
// two views are fetched from the same live database in the same run and compared to each
// other, so "the manager saw everybody" cannot pass.
//
// ─── GATING ──────────────────────────────────────────────────────────────────
// READ-ONLY: this spec creates nothing and approves nothing, so it needs credentials but
// NOT `QA_ALLOW_DESTRUCTIVE` — unlike leave-two-step.e2e.spec.ts, which writes real leave
// records. Keeping the two gates different is deliberate: an opt-in that is demanded when
// it is not needed stops being read.
//
// Run (the first line provisions the fixture accounts and the team below; without it
// every test here skips itself, which is the quietest way for a suite to stop testing):
//   pnpm dev:provision:e2e-org
//   QA_LEAVE_PASSWORD=LeaveQa@12345 npx playwright test e2e/team-scoped-reports

import { test, expect, type APIRequestContext } from "@playwright/test";

const PASSWORD = process.env.QA_LEAVE_PASSWORD;
const API_BASE = process.env.QA_API_URL ?? "http://localhost:4000";

/** Company-wide authority — sees everyone. */
const OWNER_EMAIL = process.env.QA_OWNER_EMAIL ?? "support.stimuliiq@gmail.com";
const OWNER_PASSWORD = process.env.QA_OWNER_PASSWORD ?? "Admin@123456";
/** A team manager on a staff role, so their grants resolve at scope=own. */
const MANAGER_EMAIL = process.env.QA_LEAVE_MANAGER ?? "matrix.counsellor@probe.test";

test.skip(!PASSWORD, "Set QA_LEAVE_PASSWORD to run the live team-scoped reporting checks.");

/**
 * Signs in, or returns null if the account cannot — a missing fixture account is a SETUP
 * GAP, not a regression in the narrowing under test, and a suite that reddens for setup
 * trains people to ignore it reddening.
 */
async function signIn(
  playwright: typeof import("@playwright/test").request,
  email: string,
  password: string,
): Promise<APIRequestContext | null> {
  const ctx = await playwright.newContext({ baseURL: API_BASE });
  const res = await ctx.post("/api/v1/auth/login", { data: { email, password, audience: "crm" } });
  return res.ok() ? ctx : null;
}

function requireCtx(ctx: APIRequestContext | null, email: string): asserts ctx is APIRequestContext {
  test.skip(ctx === null, `${email} cannot sign in — provision the fixture accounts first.`);
}

/** The current month, which is the only one a fresh database has figures for. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

test.describe("Team-scoped reporting, live", () => {
  test("marketing targets: a manager sees their own people, the owner sees everyone", async ({ playwright }) => {
    const owner = await signIn(playwright.request, OWNER_EMAIL, OWNER_PASSWORD);
    const manager = await signIn(playwright.request, MANAGER_EMAIL, PASSWORD!);
    requireCtx(owner, OWNER_EMAIL);
    requireCtx(manager, MANAGER_EMAIL);
    const month = thisMonth();

    const names = async (ctx: APIRequestContext): Promise<string[]> => {
      const res = await ctx.get(`/api/v1/crm/marketing-targets?month=${month}`);
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await res.json();
      return (body.data.rows as Array<{ userName: string }>).map((r) => r.userName).sort();
    };

    const ownerRows = await names(owner);
    const managerRows = await names(manager);

    test.skip(ownerRows.length === 0, "No targetable staff in this database — nothing to narrow.");

    // The manager must see a STRICT SUBSET. Equality would mean the narrowing did nothing,
    // which is precisely the failure a mocked unit test cannot catch.
    expect(managerRows.length).toBeLessThan(ownerRows.length);
    for (const name of managerRows) expect(ownerRows).toContain(name);
  });

  test("marketing targets: a manager is not offered their OWN number to set", async ({ playwright }) => {
    // Deliberately different from lead performance below, which DOES include the actor. A
    // manager must not set the number they are judged against — the same reasoning as
    // "nobody approves their own leave".
    const manager = await signIn(playwright.request, MANAGER_EMAIL, PASSWORD!);
    requireCtx(manager, MANAGER_EMAIL);

    const meRes = await manager.get("/api/v1/me");
    const myId = (await meRes.json()).data.user.id;

    const res = await manager.get(`/api/v1/crm/marketing-targets?month=${thisMonth()}`);
    const rows = (await res.json()).data.rows as Array<{ userId: string }>;

    expect(rows.map((r) => r.userId)).not.toContain(myId);
  });

  test("lead performance: a manager sees their team AND themselves", async ({ playwright }) => {
    const owner = await signIn(playwright.request, OWNER_EMAIL, OWNER_PASSWORD);
    const manager = await signIn(playwright.request, MANAGER_EMAIL, PASSWORD!);
    requireCtx(owner, OWNER_EMAIL);
    requireCtx(manager, MANAGER_EMAIL);

    const year = new Date().getUTCFullYear();
    const range = `from=${year}-01-01&to=${year}-12-31`;

    const rowsFor = async (ctx: APIRequestContext): Promise<string[]> => {
      const res = await ctx.get(`/api/v1/crm/reports/lead-performance?${range}`);
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await res.json();
      return (body.data.rows as Array<{ userId: string }>).map((r) => r.userId).sort();
    };

    const ownerRows = await rowsFor(owner);
    const managerRows = await rowsFor(manager);
    const myId = (await (await manager.get("/api/v1/me")).json()).data.user.id;

    test.skip(ownerRows.length === 0, "No lead-owning staff in this database — nothing to narrow.");

    expect(managerRows.length).toBeLessThan(ownerRows.length);
    for (const id of managerRows) expect(ownerRows).toContain(id);
    // The actor IS included here: they own leads too, and omitting them would make the team
    // total disagree with the company one.
    expect(managerRows).toContain(myId);
  });

  test("leave calendar: 'My team' narrows, and NEITHER view carries a reason", async ({ playwright }) => {
    const manager = await signIn(playwright.request, MANAGER_EMAIL, PASSWORD!);
    requireCtx(manager, MANAGER_EMAIL);
    const year = new Date().getUTCFullYear();
    const range = `from=${year}-01-01&to=${year}-12-31`;

    const entriesFor = async (scope: "company" | "team") => {
      const res = await manager.get(`/api/v1/crm/leave/calendar?${range}&scope=${scope}`);
      expect(res.ok(), await res.text()).toBeTruthy();
      return (await res.json()).data.entries as Array<Record<string, unknown>>;
    };

    const company = await entriesFor("company");
    const team = await entriesFor("team");

    // THE PRIVACY ASSERTION, and it applies to BOTH views. The filter is a convenience; the
    // projection is what protects the reason. If `reason` ever appears here, the narrowing
    // has been mistaken for a privacy control — which is the failure this checks for.
    for (const entry of [...company, ...team]) {
      expect(Object.keys(entry)).not.toContain("reason");
      expect(Object.keys(entry)).not.toContain("reviewNote");
    }

    test.skip(company.length === 0, "No approved leave in this database — nothing to narrow.");
    expect(team.length).toBeLessThanOrEqual(company.length);
  });
});
