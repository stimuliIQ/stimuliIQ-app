// Tests for the org hierarchy's two shared rules.
//
// `resolveLeaveApprovalChain` is the rule the whole phase rests on: it decides who may sign
// off somebody's absence. It is run by the API to authorise and by the CRM to tell the
// applicant where their request is going, so a disagreement between the two would show a
// person one approver and route to another. The cases below are the ones that decide real
// behaviour — who is skipped, when the chain shortens, and what happens to somebody who is
// not on the org chart at all.

import { describe, expect, it } from "vitest";
import {
  resolveLeaveApprovalChain,
  validateTeamAssignment,
  describeLeaveApprovalChain,
  type LeaveApprovalPosition,
} from "./org.schemas.js";

const ME = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const MANAGER = "33333333-3333-4333-8333-333333333333";
const TEAM = "44444444-4444-4444-8444-444444444444";

function position(over: Partial<LeaveApprovalPosition> = {}): LeaveApprovalPosition {
  return {
    applicantId: ME,
    isHr: false,
    managesAnyTeam: false,
    team: { id: TEAM, leadUserId: LEAD, managerUserId: MANAGER },
    ...over,
  };
}

describe("resolveLeaveApprovalChain", () => {
  it("sends an ordinary member to their lead, then their manager", () => {
    const chain = resolveLeaveApprovalChain(position());

    expect(chain.steps).toEqual(["lead", "manager"]);
    expect(chain.firstApproverId).toBe(LEAD);
    expect(chain.finalApproverId).toBe(MANAGER);
    expect(chain.fallbackToOwner).toBe(false);
  });

  it("skips the lead step for the team's own lead — nobody recommends their own leave", () => {
    const chain = resolveLeaveApprovalChain(position({ applicantId: LEAD }));

    expect(chain.steps).toEqual(["manager"]);
    expect(chain.finalApproverId).toBe(MANAGER);
  });

  it("sends a manager straight to the owner, not to a lead they manage", () => {
    const chain = resolveLeaveApprovalChain(position({ applicantId: MANAGER, managesAnyTeam: true }));

    expect(chain.steps).toEqual(["owner"]);
    expect(chain.fallbackToOwner).toBe(true);
  });

  it("sends HR to the owner even when HR sits on a team", () => {
    // HR's authority is company-wide, so their own leave cannot be signed by somebody they
    // hold authority over. Membership of a team does not change that.
    const chain = resolveLeaveApprovalChain(position({ isHr: true }));

    expect(chain.steps).toEqual(["owner"]);
    expect(chain.fallbackToOwner).toBe(true);
  });

  it("falls back to the owner for somebody not on the org chart yet", () => {
    // This is every existing member of staff on the day teams ship. It must fail OPEN to
    // today's behaviour, not refuse the application.
    const chain = resolveLeaveApprovalChain(position({ team: null }));

    expect(chain.steps).toEqual(["owner"]);
    expect(chain.fallbackToOwner).toBe(true);
    expect(chain.firstApproverId).toBeNull();
    expect(chain.finalApproverId).toBeNull();
  });

  it("shortens to one step when the team has no manager yet", () => {
    const chain = resolveLeaveApprovalChain(
      position({ team: { id: TEAM, leadUserId: LEAD, managerUserId: null } }),
    );

    expect(chain.steps).toEqual(["lead"]);
    expect(chain.finalApproverId).toBe(LEAD);
    expect(chain.fallbackToOwner).toBe(false);
  });

  it("shortens to one step when the team has no lead yet", () => {
    const chain = resolveLeaveApprovalChain(
      position({ team: { id: TEAM, leadUserId: null, managerUserId: MANAGER } }),
    );

    expect(chain.steps).toEqual(["manager"]);
    expect(chain.finalApproverId).toBe(MANAGER);
  });

  it("falls back to the owner when the applicant is the only named person on their team", () => {
    const chain = resolveLeaveApprovalChain(
      position({ team: { id: TEAM, leadUserId: ME, managerUserId: null } }),
    );

    expect(chain.steps).toEqual(["owner"]);
    expect(chain.fallbackToOwner).toBe(true);
  });

  it("never returns an empty chain — a request must never land in a queue nobody watches", () => {
    const cases: LeaveApprovalPosition[] = [
      position(),
      position({ team: null }),
      position({ isHr: true }),
      position({ managesAnyTeam: true }),
      position({ team: { id: TEAM, leadUserId: null, managerUserId: null } }),
      position({ team: { id: TEAM, leadUserId: ME, managerUserId: ME } }),
    ];

    for (const input of cases) {
      expect(resolveLeaveApprovalChain(input).steps.length).toBeGreaterThan(0);
    }
  });

  it("never names the applicant as their own approver, whatever the org chart says", () => {
    const cases: LeaveApprovalPosition[] = [
      position({ team: { id: TEAM, leadUserId: ME, managerUserId: MANAGER } }),
      position({ team: { id: TEAM, leadUserId: LEAD, managerUserId: ME } }),
      position({ team: { id: TEAM, leadUserId: ME, managerUserId: ME } }),
    ];

    for (const input of cases) {
      const chain = resolveLeaveApprovalChain(input);
      expect(chain.firstApproverId).not.toBe(ME);
      expect(chain.finalApproverId).not.toBe(ME);
    }
  });
});

describe("describeLeaveApprovalChain", () => {
  it("names both approvers on a two-step chain", () => {
    const chain = resolveLeaveApprovalChain(position());

    expect(describeLeaveApprovalChain(chain, { firstApproverName: "Priya", finalApproverName: "Ravi" }))
      .toBe("Priya, then Ravi");
  });

  it("says HR when there is nobody named", () => {
    const chain = resolveLeaveApprovalChain(position({ team: null }));

    expect(describeLeaveApprovalChain(chain, {})).toBe("HR / the super admin");
  });
});

describe("validateTeamAssignment", () => {
  it("accepts a well-formed team", () => {
    expect(
      validateTeamAssignment({ managerUserId: MANAGER, leadUserId: LEAD, memberUserIds: [ME] }),
    ).toEqual([]);
  });

  it("refuses one person being both manager and lead", () => {
    // Otherwise a member's two approval steps are the same signature twice — a one-step
    // approval wearing a disguise.
    expect(
      validateTeamAssignment({ managerUserId: LEAD, leadUserId: LEAD, memberUserIds: [ME] }),
    ).toEqual(["manager_is_lead"]);
  });

  it("refuses the manager or the lead also being a rank-and-file member", () => {
    expect(
      validateTeamAssignment({ managerUserId: MANAGER, leadUserId: LEAD, memberUserIds: [MANAGER, LEAD] }),
    ).toEqual(["manager_is_member", "lead_is_member"]);
  });

  it("accepts an incomplete team — created before its lead is hired", () => {
    expect(
      validateTeamAssignment({ managerUserId: null, leadUserId: null, memberUserIds: [ME] }),
    ).toEqual([]);
  });
});
