// Unit tests for the derived lifecycle-stage resolver (lifecycle-redesign P1).
// Runs under @repo/types' own vitest (the package is ESM; apps/api's CJS Jest
// cannot require the built dist as a runtime value).

import { describe, it, expect } from "vitest";
import { resolveLifecycleStage, type LifecycleSignals } from "./lifecycle.schemas.js";

describe("resolveLifecycleStage", () => {
  describe("empty / defaults", () => {
    it("returns new_lead for an empty signal bundle", () => {
      expect(resolveLifecycleStage({})).toBe("new_lead");
    });
  });

  describe("pre-conversion lead ladder", () => {
    it("new lead with no owner → new_lead", () => {
      const s: LifecycleSignals = { lead: { stage: "new", hasOwner: false, converted: false } };
      expect(resolveLifecycleStage(s)).toBe("new_lead");
    });

    it("new lead WITH owner → assigned", () => {
      const s: LifecycleSignals = { lead: { stage: "new", hasOwner: true, converted: false } };
      expect(resolveLifecycleStage(s)).toBe("assigned");
    });

    it("follow_up lead → contacted (the single mid-funnel stage)", () => {
      expect(resolveLifecycleStage({ lead: { stage: "follow_up", hasOwner: true, converted: false } })).toBe(
        "contacted",
      );
    });
  });

  describe("terminal: lost lead", () => {
    it("lost lead with no other progress → lost", () => {
      expect(resolveLifecycleStage({ lead: { stage: "lost", hasOwner: true, converted: false } })).toBe("lost");
    });

    it("a lead marked lost but later converted reads by student progress, not lost", () => {
      const s: LifecycleSignals = {
        lead: { stage: "lost", hasOwner: true, converted: true },
        student: { status: "active" },
      };
      expect(resolveLifecycleStage(s)).toBe("registered");
    });
  });

  describe("post-conversion student ladder", () => {
    it("student with no enrollment → registered", () => {
      expect(resolveLifecycleStage({ student: { status: "active" } })).toBe("registered");
    });

    it("student + unpaid order → payment_pending", () => {
      const s: LifecycleSignals = { student: { status: "active" }, order: { paid: false } };
      expect(resolveLifecycleStage(s)).toBe("payment_pending");
    });

    it("student + paid order but no enrollment → payment_completed", () => {
      const s: LifecycleSignals = { student: { status: "active" }, order: { paid: true } };
      expect(resolveLifecycleStage(s)).toBe("payment_completed");
    });

    it("manual enrollment, no order, no progress → active_student", () => {
      const s: LifecycleSignals = {
        student: { status: "active" },
        enrollment: { status: "active", progressPct: 0 },
      };
      expect(resolveLifecycleStage(s)).toBe("active_student");
    });

    it("paid + active enrollment, no progress → active_student (furthest wins)", () => {
      const s: LifecycleSignals = {
        student: { status: "active" },
        order: { paid: true },
        enrollment: { status: "active", progressPct: 0 },
      };
      expect(resolveLifecycleStage(s)).toBe("active_student");
    });

    it("enrollment with mid progress → learning_in_progress", () => {
      const s: LifecycleSignals = {
        student: { status: "active" },
        order: { paid: true },
        enrollment: { status: "active", progressPct: 42 },
      };
      expect(resolveLifecycleStage(s)).toBe("learning_in_progress");
    });

    it("100% progress → course_completed", () => {
      const s: LifecycleSignals = {
        student: { status: "active" },
        enrollment: { status: "active", progressPct: 100 },
      };
      expect(resolveLifecycleStage(s)).toBe("course_completed");
    });

    it("completed enrollment status → course_completed", () => {
      const s: LifecycleSignals = {
        student: { status: "active" },
        enrollment: { status: "completed", progressPct: 90 },
      };
      expect(resolveLifecycleStage(s)).toBe("course_completed");
    });

    it("certificate issued → certified (tops everything)", () => {
      const s: LifecycleSignals = {
        student: { status: "alumni" },
        enrollment: { status: "completed", progressPct: 100 },
        order: { paid: true },
        hasCertificate: true,
      };
      expect(resolveLifecycleStage(s)).toBe("certified");
    });
  });

  describe("terminal: dropped student", () => {
    it("dropped enrollment → dropped", () => {
      const s: LifecycleSignals = {
        student: { status: "active" },
        enrollment: { status: "dropped", progressPct: 30 },
      };
      expect(resolveLifecycleStage(s)).toBe("dropped");
    });

    it("dropped does NOT override an issued certificate", () => {
      const s: LifecycleSignals = {
        student: { status: "alumni" },
        enrollment: { status: "dropped", progressPct: 100 },
        hasCertificate: true,
      };
      expect(resolveLifecycleStage(s)).toBe("certified");
    });
  });

  describe("furthest-along invariant", () => {
    it("a converted lead + active learning student ignores the stale lead stage", () => {
      const s: LifecycleSignals = {
        lead: { stage: "new", hasOwner: false, converted: true },
        student: { status: "active" },
        order: { paid: true },
        enrollment: { status: "active", progressPct: 55 },
      };
      expect(resolveLifecycleStage(s)).toBe("learning_in_progress");
    });
  });
});
