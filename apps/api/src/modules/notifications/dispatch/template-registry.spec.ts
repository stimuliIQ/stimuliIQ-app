// apps/api/src/modules/notifications/dispatch/template-registry.spec.ts
//
// Unit tests for the TemplateRegistry.
// (docs/plans/phase-6.md task #4; AC-6, LOCK-D4, Rule C-3)
//
// Covers:
//   - render() for each NotificationType × each channel (in_app, email, sms, whatsapp)
//   - Variable interpolation ({{variableName}} → value from payload)
//   - DLT template ID passthrough:
//       sms/whatsapp with DLT_PENDING → missingDlt=true (Rule C-3, AC-78)
//   - renderAll() produces entries for all four channels
//   - renderRaw() for campaign template bodies
//   - Unknown NotificationType → fallback (no crash)
//   - WhatsApp variables extraction matches placeholder order

import { TemplateRegistry, NOTIFICATION_TEMPLATES } from "./template-registry";
import type { NotificationType } from "@repo/types";

// ─────────────────────────────────────────────────────────────────────────────
// Test setup
// ─────────────────────────────────────────────────────────────────────────────

const ALL_NOTIFICATION_TYPES: NotificationType[] = [
  "grade_ready",
  "certificate_ready",
  "live_reminder",
  "forum_reply",
  "announcement",
  "lead_confirmation",
  "booking_confirmation",
  "payment_receipt",
  "welcome",
];

// Rich payload covering all placeholders across all templates.
const FULL_PAYLOAD: Record<string, unknown> = {
  // grade_ready
  assignmentTitle: "Data Structures Quiz",
  score: "92/100",
  submissionId: "sub-abc123",
  studentName: "Rahul Sharma",
  lmsUrl: "https://lms.stimuliiq.com",
  unsubscribeUrl: "https://api.stimuliiq.com/unsubscribe/token123",
  // certificate_ready
  certificateId: "cert-xyz789",
  programTitle: "Full Stack Development",
  // live_reminder
  eventTitle: "Advanced JavaScript Live Session",
  startsAt: "2026-01-15 10:00 IST",
  joinUrl: "https://meet.google.com/abc-def-ghi",
  // forum_reply
  authorName: "Priya Singh",
  threadTitle: "How to implement binary search?",
  threadId: "thread-001",
  postId: "post-002",
  // announcement
  title: "Holiday Schedule Update",
  body: "Classes will resume on January 20.",
  // lead_confirmation
  name: "Arun Kumar",
  // booking_confirmation
  bookingId: "book-456",
  slotDate: "2026-01-20",
  // payment_receipt
  orderId: "order-789",
  amountPaise: 49900,
  amountRupees: "499",
  currency: "INR",
  // welcome
  userName: "Arun Kumar",
  brandName: "stimuliIQ",
};

// ─────────────────────────────────────────────────────────────────────────────
// Template coverage checks
// ─────────────────────────────────────────────────────────────────────────────

describe("NOTIFICATION_TEMPLATES catalog", () => {
  it("has an entry for every NotificationType", () => {
    for (const type of ALL_NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TEMPLATES[type]).toBeDefined();
    }
  });

  it("every template has inAppBody, emailSubject, emailBody, smsBody, whatsappBody", () => {
    for (const type of ALL_NOTIFICATION_TYPES) {
      const tpl = NOTIFICATION_TEMPLATES[type];
      expect(typeof tpl.inAppBody).toBe("string");
      expect(typeof tpl.emailSubject).toBe("string");
      expect(typeof tpl.emailBody).toBe("string");
      expect(typeof tpl.smsBody).toBe("string");
      expect(typeof tpl.whatsappBody).toBe("string");
    }
  });

  it("every SMS template has smsDltTemplateId set (DLT_PENDING or real)", () => {
    for (const type of ALL_NOTIFICATION_TYPES) {
      const tpl = NOTIFICATION_TEMPLATES[type];
      // Must be defined (even if "DLT_PENDING" — the sentinel, not undefined)
      expect(tpl.smsDltTemplateId).toBeDefined();
    }
  });

  it("every WhatsApp template has whatsappDltTemplateId and whatsappTemplateName set", () => {
    for (const type of ALL_NOTIFICATION_TYPES) {
      const tpl = NOTIFICATION_TEMPLATES[type];
      expect(tpl.whatsappDltTemplateId).toBeDefined();
      expect(tpl.whatsappTemplateName).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TemplateRegistry.render() — per channel per type
// ─────────────────────────────────────────────────────────────────────────────

describe("TemplateRegistry", () => {
  let registry: TemplateRegistry;

  beforeEach(() => {
    registry = new TemplateRegistry();
  });

  // ─── in_app channel ────────────────────────────────────────────────────────

  describe("render() — in_app channel", () => {
    for (const type of ALL_NOTIFICATION_TYPES) {
      it(`${type}: returns a non-empty body`, () => {
        const result = registry.render(type, "in_app", FULL_PAYLOAD);
        expect(result.body).toBeTruthy();
        expect(typeof result.body).toBe("string");
      });
    }

    it("grade_ready: body contains interpolated assignmentTitle and score", () => {
      const result = registry.render("grade_ready", "in_app", FULL_PAYLOAD);
      expect(result.body).toContain("Data Structures Quiz");
      expect(result.body).toContain("92/100");
    });

    it("certificate_ready: body contains programTitle", () => {
      const result = registry.render("certificate_ready", "in_app", FULL_PAYLOAD);
      expect(result.body).toContain("Full Stack Development");
    });

    it("in_app never has dltTemplateId", () => {
      for (const type of ALL_NOTIFICATION_TYPES) {
        const result = registry.render(type, "in_app", FULL_PAYLOAD);
        expect(result.dltTemplateId).toBeUndefined();
        expect(result.missingDlt).toBeUndefined();
      }
    });
  });

  // ─── email channel ────────────────────────────────────────────────────────

  describe("render() — email channel", () => {
    for (const type of ALL_NOTIFICATION_TYPES) {
      it(`${type}: returns subject and body`, () => {
        const result = registry.render(type, "email", FULL_PAYLOAD);
        expect(result.subject).toBeTruthy();
        expect(result.body).toBeTruthy();
      });
    }

    it("grade_ready: subject contains assignmentTitle", () => {
      const result = registry.render("grade_ready", "email", FULL_PAYLOAD);
      expect(result.subject).toContain("Data Structures Quiz");
    });

    it("payment_receipt: body contains amountRupees", () => {
      const result = registry.render("payment_receipt", "email", FULL_PAYLOAD);
      expect(result.body).toContain("499");
      expect(result.body).toContain("order-789");
    });

    it("email never has dltTemplateId (email is not DLT-gated)", () => {
      for (const type of ALL_NOTIFICATION_TYPES) {
        const result = registry.render(type, "email", FULL_PAYLOAD);
        expect(result.dltTemplateId).toBeUndefined();
        expect(result.missingDlt).toBeUndefined();
      }
    });

    it("body contains unsubscribeUrl (all emails must have unsubscribe link)", () => {
      for (const type of ALL_NOTIFICATION_TYPES) {
        const result = registry.render(type, "email", FULL_PAYLOAD);
        // Templates include {{unsubscribeUrl}} which renders to the value in payload
        // (or stays as placeholder if not provided — but we provide it in FULL_PAYLOAD)
        expect(result.body).toContain("unsubscribe");
      }
    });
  });

  // ─── sms channel — DLT passthrough ───────────────────────────────────────

  describe("render() — sms channel (DLT passthrough, Rule C-3)", () => {
    for (const type of ALL_NOTIFICATION_TYPES) {
      it(`${type}: returns body + missingDlt=true (DLT_PENDING sentinel) or dltTemplateId`, () => {
        const result = registry.render(type, "sms", FULL_PAYLOAD);
        expect(result.body).toBeTruthy();
        // ALL templates in dev/test have "DLT_PENDING" — so missingDlt should be true
        // This validates Rule C-3 enforcement: the registry surfaces missing DLT IDs.
        const tpl = NOTIFICATION_TEMPLATES[type];
        if (tpl.smsDltTemplateId === "DLT_PENDING" || !tpl.smsDltTemplateId) {
          expect(result.missingDlt).toBe(true);
          expect(result.dltTemplateId).toBeUndefined();
        } else {
          expect(result.dltTemplateId).toBe(tpl.smsDltTemplateId);
          expect(result.missingDlt).toBeUndefined();
        }
      });
    }

    it("grade_ready SMS: body contains assignmentTitle and score", () => {
      const result = registry.render("grade_ready", "sms", FULL_PAYLOAD);
      expect(result.body).toContain("Data Structures Quiz");
      expect(result.body).toContain("92/100");
    });

    it("Rule C-3: missingDlt=true when DLT_PENDING — caller must reject send", () => {
      // All current templates have DLT_PENDING, so all SMS renders should return missingDlt.
      const result = registry.render("grade_ready", "sms", {});
      expect(result.missingDlt).toBe(true);
    });
  });

  // ─── whatsapp channel — DLT passthrough ──────────────────────────────────

  describe("render() — whatsapp channel (DLT passthrough, Rule C-3)", () => {
    for (const type of ALL_NOTIFICATION_TYPES) {
      it(`${type}: returns body + whatsappTemplateName`, () => {
        const result = registry.render(type, "whatsapp", FULL_PAYLOAD);
        expect(result.body).toBeTruthy();
        expect(result.whatsappTemplateName).toBeTruthy();
      });
    }

    it("all current templates have DLT_PENDING → missingDlt=true for whatsapp", () => {
      for (const type of ALL_NOTIFICATION_TYPES) {
        const tpl = NOTIFICATION_TEMPLATES[type];
        const result = registry.render(type, "whatsapp", FULL_PAYLOAD);
        if (tpl.whatsappDltTemplateId === "DLT_PENDING" || !tpl.whatsappDltTemplateId) {
          expect(result.missingDlt).toBe(true);
        } else {
          expect(result.dltTemplateId).toBe(tpl.whatsappDltTemplateId);
        }
      }
    });

    it("whatsappVariables are extracted in placeholder order", () => {
      const result = registry.render("grade_ready", "whatsapp", FULL_PAYLOAD);
      // grade_ready whatsappBody: "Your assignment *{{assignmentTitle}}* has been graded. Score: *{{score}}*..."
      expect(result.whatsappVariables).toBeDefined();
      expect(Array.isArray(result.whatsappVariables)).toBe(true);
      expect(result.whatsappVariables!.length).toBeGreaterThan(0);
      // First variable should be assignmentTitle
      expect(result.whatsappVariables![0]).toBe("Data Structures Quiz");
    });

    it("whatsapp body is rendered with interpolated variables", () => {
      const result = registry.render("certificate_ready", "whatsapp", FULL_PAYLOAD);
      expect(result.body).toContain("Full Stack Development");
      expect(result.body).toContain("cert-xyz789");
    });
  });

  // ─── renderAll() ─────────────────────────────────────────────────────────

  describe("renderAll()", () => {
    it("returns entries for all four channels", () => {
      for (const type of ALL_NOTIFICATION_TYPES) {
        const map = registry.renderAll(type, FULL_PAYLOAD);
        expect(map.in_app).toBeDefined();
        expect(map.email).toBeDefined();
        expect(map.sms).toBeDefined();
        expect(map.whatsapp).toBeDefined();
      }
    });

    it("grade_ready all-channel render: bodies are non-empty", () => {
      const map = registry.renderAll("grade_ready", FULL_PAYLOAD);
      expect(map.in_app.body).toBeTruthy();
      expect(map.email.body).toBeTruthy();
      expect(map.sms.body).toBeTruthy();
      expect(map.whatsapp.body).toBeTruthy();
    });
  });

  // ─── renderRaw() — for campaign DB templates ──────────────────────────────

  describe("renderRaw()", () => {
    it("interpolates {{variable}} placeholders from variables map", () => {
      const template = "Hi {{name}}, your code is {{code}}!";
      const result = registry.renderRaw(template, { name: "Arun", code: "ABC123" });
      expect(result).toBe("Hi Arun, your code is ABC123!");
    });

    it("leaves unknown placeholders as-is (safe fallback)", () => {
      const template = "Hello {{name}}, click {{unknownVar}}!";
      const result = registry.renderRaw(template, { name: "Priya" });
      expect(result).toContain("Priya");
      expect(result).toContain("{{unknownVar}}"); // left unchanged
    });

    it("handles empty variables map without error", () => {
      const template = "Static text with no placeholders.";
      expect(() => registry.renderRaw(template, {})).not.toThrow();
      expect(registry.renderRaw(template, {})).toBe(template);
    });

    it("handles null/undefined values in variables — coerces to empty string", () => {
      const template = "Value: {{val}}";
      // undefined payload key is left as-is (safe fallback), not '' — but null is coerced
      const result = registry.renderRaw(template, { val: null });
      expect(result).toBe("Value: ");
    });

    it("handles multiple occurrences of the same placeholder", () => {
      const template = "{{name}} says hello, {{name}}!";
      const result = registry.renderRaw(template, { name: "Rahul" });
      expect(result).toBe("Rahul says hello, Rahul!");
    });
  });

  // ─── Unknown type fallback ────────────────────────────────────────────────

  describe("unknown type fallback", () => {
    it("does not throw for unknown type", () => {
      expect(() =>
        registry.render("unknown_type" as NotificationType, "email", FULL_PAYLOAD),
      ).not.toThrow();
    });

    it("returns a non-empty fallback body for unknown type", () => {
      const result = registry.render("unknown_type" as NotificationType, "email", FULL_PAYLOAD);
      expect(result.body).toBeTruthy();
    });

    it("SMS fallback for unknown type has missingDlt=true", () => {
      const result = registry.render("unknown_type" as NotificationType, "sms", FULL_PAYLOAD);
      expect(result.missingDlt).toBe(true);
    });
  });

  // ─── DLT ID: when a real ID is set, it passes through ────────────────────

  describe("DLT template ID passthrough when set to a real value", () => {
    it("real dltTemplateId surfaces in render result for SMS", () => {
      // Temporarily override a template to have a real DLT ID.
      const originalSmsDlt = NOTIFICATION_TEMPLATES.grade_ready.smsDltTemplateId;
      // Mutate for test (restore after)
      (NOTIFICATION_TEMPLATES.grade_ready as { smsDltTemplateId?: string }).smsDltTemplateId = "1207162000000001234";

      try {
        const result = registry.render("grade_ready", "sms", FULL_PAYLOAD);
        expect(result.dltTemplateId).toBe("1207162000000001234");
        expect(result.missingDlt).toBeUndefined();
      } finally {
        (NOTIFICATION_TEMPLATES.grade_ready as { smsDltTemplateId?: string }).smsDltTemplateId = originalSmsDlt;
      }
    });

    it("real whatsappDltTemplateId surfaces in render result for whatsapp", () => {
      const original = NOTIFICATION_TEMPLATES.grade_ready.whatsappDltTemplateId;
      (NOTIFICATION_TEMPLATES.grade_ready as { whatsappDltTemplateId?: string }).whatsappDltTemplateId = "WA_DLT_12345";

      try {
        const result = registry.render("grade_ready", "whatsapp", FULL_PAYLOAD);
        expect(result.dltTemplateId).toBe("WA_DLT_12345");
        expect(result.missingDlt).toBeUndefined();
      } finally {
        (NOTIFICATION_TEMPLATES.grade_ready as { whatsappDltTemplateId?: string }).whatsappDltTemplateId = original;
      }
    });
  });

  // ─── Security: no secrets in rendered output ──────────────────────────────

  describe("security: no secrets in rendered output", () => {
    it("rendered output never contains API key patterns", () => {
      for (const type of ALL_NOTIFICATION_TYPES) {
        const channels: Array<"in_app" | "email" | "sms" | "whatsapp"> = ["in_app", "email", "sms", "whatsapp"];
        for (const channel of channels) {
          const result = registry.render(type, channel, FULL_PAYLOAD);
          const serialised = JSON.stringify(result);
          expect(serialised).not.toContain("RESEND_API_KEY");
          expect(serialised).not.toContain("WHATSAPP_ACCESS_TOKEN");
          expect(serialised).not.toContain("MSG91_AUTH_KEY");
          expect(serialised).not.toContain("NOTIFICATION_SIGNING_SECRET");
        }
      }
    });
  });
});
