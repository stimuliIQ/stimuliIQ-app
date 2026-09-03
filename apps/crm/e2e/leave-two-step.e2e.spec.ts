// apps/crm/e2e/leave-two-step.e2e.spec.ts
//
// The FULL two-step leave journey against a real API, end to end (ADR-0070):
//   a member applies -> their TEAM LEAD approves -> their MANAGER confirms.
//
// org-teams.e2e.spec.ts stubs the API and proves the browser renders the org chart. This
// one proves the two halves actually meet — that the API really refuses the manager at step
// one, really moves the request to `lead_approved` when the lead approves, really refuses
// the lead a second signature on their own approval, and really deducts the days only on
// the final confirmation.
//
// ─── WHY THIS IS DOUBLE-GATED ────────────────────────────────────────────────
// It CREATES a real leave request and APPROVES it against a live database, which changes a
// real person's balance. Against a production-pointed API that is somebody's actual leave
// record. So, exactly like two-factor-login-live.e2e.spec.ts, it requires BOTH:
//
//   QA_LEAVE_PASSWORD      — the shared password for three disposable staff accounts
//   QA_ALLOW_DESTRUCTIVE=1 — an explicit "yes, this API is safe to mutate"
//
// The second is not redundant. Somebody who exports the password once tends to keep it
// exported; the opt-in has to be a separate, deliberate act each time the target API
// changes. Never set it while the API points at production.
//
// It also needs an org chart to exist: the three accounts must be a member, the lead and
// the manager of one team. The test SKIPS with a named reason rather than failing if the
// chain does not resolve, because a missing org chart is a setup gap, not a regression.
// `scripts/dev-provision-e2e-org.cjs` builds exactly that chain on a local database.
//
// Run:
//   pnpm dev:provision:e2e-org
//   QA_ALLOW_DESTRUCTIVE=1 QA_LEAVE_PASSWORD=LeaveQa@12345 npx playwright test e2e/leave-two-step

import { test, expect, type APIRequestContext } from "@playwright/test";

const PASSWORD = process.env.QA_LEAVE_PASSWORD;
const DESTRUCTIVE_OK = process.env.QA_ALLOW_DESTRUCTIVE === "1";
const API_BASE = process.env.QA_API_URL ?? "http://localhost:4000";

const MEMBER_EMAIL = process.env.QA_LEAVE_MEMBER ?? "matrix.content_editor@probe.test";
const LEAD_EMAIL = process.env.QA_LEAVE_LEAD ?? "matrix.branch_manager@probe.test";
const MANAGER_EMAIL = process.env.QA_LEAVE_MANAGER ?? "matrix.counsellor@probe.test";

test.skip(
  !PASSWORD || !DESTRUCTIVE_OK,
  "Set QA_LEAVE_PASSWORD and QA_ALLOW_DESTRUCTIVE=1 to run the live two-step leave journey.",
);

/** One signed-in API session: the cookie jar plus the CSRF token writes need. */
interface Session {
  ctx: APIRequestContext;
  csrf: string;
  userId: string;
}

/**
 * Signs in, or returns null if the account cannot.
 *
 * NULL RATHER THAN A FAILED ASSERTION, deliberately. These are disposable fixture
 * accounts that may simply not be provisioned on the database this is pointed at — which
 * is a SETUP GAP, not a regression in the chain under test. A suite that goes red because
 * a fixture is missing trains people to ignore it going red.
 */
async function signIn(
  playwright: typeof import("@playwright/test").request,
  email: string,
): Promise<Session | null> {
  const ctx = await playwright.newContext({ baseURL: API_BASE });
  const res = await ctx.post("/api/v1/auth/login", {
    data: { email, password: PASSWORD, audience: "crm" },
  });
  if (!res.ok()) return null;
  const body = await res.json();
  return { ctx, csrf: body.data.csrfToken, userId: body.data.user.id };
}

/** Skips the test, naming the account, when a fixture login is not available. */
function requireSession(session: Session | null, email: string): asserts session is Session {
  test.skip(session === null, `${email} cannot sign in — provision the fixture accounts first.`);
}

function headers(session: Session) {
  return { "x-csrf-token": session.csrf, "content-type": "application/json" };
}

/**
 * A two-day window late in the CURRENT year.
 *
 * Deliberately not next year: allowances are set per year and only the current one is
 * seeded, so a next-year request earns a perfectly correct 422 `leave.quota_not_set` that
 * has nothing to do with what is under test. `offsetDays` lets the two tests in this file
 * pick non-overlapping windows — the API refuses overlapping requests from one person, and
 * that refusal would look like a failure of the chain.
 */
function windowInCurrentYear(offsetDays: number): { start: string; end: string } {
  const base = Date.UTC(new Date().getUTCFullYear(), 11, 1 + offsetDays);
  const start = new Date(base);
  const end = new Date(base + 24 * 60 * 60 * 1000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

test.describe("Two-step leave approval, live", () => {
  test("travels member -> team lead -> manager, deducting only at the end", async ({ playwright }) => {
    const member = await signIn(playwright.request, MEMBER_EMAIL);
    const lead = await signIn(playwright.request, LEAD_EMAIL);
    const manager = await signIn(playwright.request, MANAGER_EMAIL);
    requireSession(member, MEMBER_EMAIL);
    requireSession(lead, LEAD_EMAIL);
    requireSession(manager, MANAGER_EMAIL);

    // ── The chain must actually resolve, or this proves nothing ──────────────
    const position = await (await member.ctx.get("/api/v1/crm/org/me/position")).json();
    test.skip(
      !position.data?.teamId,
      `${MEMBER_EMAIL} is not on a team — build one in CRM ▸ Organisation ▸ Teams first.`,
    );

    const context = await (await member.ctx.get("/api/v1/crm/leave/apply-context")).json();
    const paidType = (context.data.types as Array<{ id: string; paid: boolean }>).find((t) => t.paid);
    test.skip(!paidType, "No paid leave type configured — run pnpm db:seed:leave first.");

    const balanceFor = async (): Promise<{ used: number; pending: number }> => {
      const res = await (await member.ctx.get("/api/v1/crm/leave/balances")).json();
      const rows = res.data.balances as Array<{ leaveTypeId: string; usedDays: number; pendingDays: number }>;
      const row = rows.find((b) => b.leaveTypeId === paidType!.id)!;
      return { used: row.usedDays, pending: row.pendingDays };
    };

    const before = await balanceFor();
    const { start, end } = windowInCurrentYear(0);

    // ── 1. The member applies ────────────────────────────────────────────────
    const created = await member.ctx.post("/api/v1/crm/leave/requests", {
      headers: headers(member),
      data: {
        leaveTypeId: paidType!.id,
        startDate: start,
        endDate: end,
        startDayPart: "full",
        endDayPart: "full",
        reason: "Playwright two-step journey",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const request = (await created.json()).data;
    expect(request.status).toBe("pending");

    try {
      // The days are already held, before anybody has looked at it.
      const afterApply = await balanceFor();
      expect(afterApply.pending).toBeGreaterThan(before.pending);
      expect(afterApply.used).toBe(before.used);

      // ── 2. The MANAGER cannot skip the lead's step ─────────────────────────
      // 404, not 403 — a 403 would confirm the request exists to somebody who has no
      // standing over it at this stage.
      const tooEarly = await manager.ctx.post(`/api/v1/crm/leave/approvals/${request.id}/approve`, {
        headers: headers(manager),
        data: {},
      });
      expect(tooEarly.status()).toBe(404);

      // ── 3. The TEAM LEAD approves ──────────────────────────────────────────
      const leadStep = await lead.ctx.post(`/api/v1/crm/leave/approvals/${request.id}/approve`, {
        headers: headers(lead),
        data: { note: "Cover arranged" },
      });
      expect(leadStep.ok(), await leadStep.text()).toBeTruthy();
      expect((await leadStep.json()).data.status).toBe("lead_approved");

      // THE KEY ASSERTION. A request sitting with the manager is held, not committed: it
      // still counts as pending and nothing has been deducted. Getting this wrong is how
      // two requests get approved against one allowance, and it fails silently.
      const afterLead = await balanceFor();
      expect(afterLead.used).toBe(before.used);
      expect(afterLead.pending).toBe(afterApply.pending);

      // ── 4. The lead cannot ALSO confirm their own approval ─────────────────
      const secondSignature = await lead.ctx.post(`/api/v1/crm/leave/approvals/${request.id}/approve`, {
        headers: headers(lead),
        data: {},
      });
      expect(secondSignature.status()).toBe(404);

      // ── 5. The MANAGER confirms — and only now are the days spent ──────────
      const finalStep = await manager.ctx.post(`/api/v1/crm/leave/approvals/${request.id}/approve`, {
        headers: headers(manager),
        data: { note: "Approved" },
      });
      expect(finalStep.ok(), await finalStep.text()).toBeTruthy();
      expect((await finalStep.json()).data.status).toBe("approved");

      const afterFinal = await balanceFor();
      expect(afterFinal.used).toBeGreaterThan(before.used);
      expect(afterFinal.pending).toBe(before.pending);

      // ── 6. Both steps are on the record, separately ────────────────────────
      // A chain that only named the final decider would hide that somebody looked first,
      // which is exactly what an auditor and the applicant want to see.
      const detail = (await (await manager.ctx.get(`/api/v1/crm/leave/requests/${request.id}`)).json()).data;
      expect(detail.leadApprovedById).toBe(lead.userId);
      expect(detail.reviewedById).toBe(manager.userId);
      expect(detail.leadApprovedById).not.toBe(detail.reviewedById);
    } finally {
      // Leave the balance as it was found. An approved future-dated request can still be
      // withdrawn by its applicant, which is exactly the path this uses.
      await member.ctx.post(`/api/v1/crm/leave/requests/${request.id}/cancel`, {
        headers: headers(member),
        data: {},
      });
    }
  });

  test("nobody decides their own request, not even somebody who can decide everybody else's", async ({
    playwright,
  }) => {
    // Closes a hole that existed before the hierarchy: the super admin's scope=all covered
    // their own row. Enforced in the service, not by a permission, which cannot express it.
    const lead = await signIn(playwright.request, LEAD_EMAIL);
    requireSession(lead, LEAD_EMAIL);

    const context = await (await lead.ctx.get("/api/v1/crm/leave/apply-context")).json();
    const paidType = (context.data.types as Array<{ id: string; paid: boolean }>).find((t) => t.paid);
    test.skip(!paidType, "No paid leave type configured — run pnpm db:seed:leave first.");

    const { start, end } = windowInCurrentYear(10);

    const created = await lead.ctx.post("/api/v1/crm/leave/requests", {
      headers: headers(lead),
      data: {
        leaveTypeId: paidType!.id,
        startDate: start,
        endDate: end,
        startDayPart: "full",
        endDayPart: "full",
        reason: "Playwright self-review guard",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const request = (await created.json()).data;

    try {
      const selfApprove = await lead.ctx.post(`/api/v1/crm/leave/approvals/${request.id}/approve`, {
        headers: headers(lead),
        data: {},
      });
      expect(selfApprove.status()).toBe(403);
      expect((await selfApprove.json()).error.code).toBe("leave.self_review");
    } finally {
      await lead.ctx.post(`/api/v1/crm/leave/requests/${request.id}/cancel`, {
        headers: headers(lead),
        data: {},
      });
    }
  });
});
