// EmailTemplatesService — the override/default contract.
//
// What is worth pinning here is not that the CRUD works, but the four things that would
// quietly send the wrong email to a real student: the default must survive a missing row,
// an unknown placeholder must be refused rather than shipped as literal braces, student
// data must be HTML-escaped while staff prose is not, and reset must restore the shipped
// text rather than report success on a template nobody edited.
import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";

import { EmailTemplatesService } from "./email-templates.service";
import { EmailTemplatesRepository } from "./email-templates.repository";
import { EMAIL_TEMPLATE_DEFAULTS } from "./email-template-defaults";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<EmailTemplatesRepository> {
  return {
    findAll: jest.fn().mockResolvedValue([]),
    findByKey: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<EmailTemplatesRepository>;
}

const TENANT = "tenant-1";

function row(over: Record<string, unknown> = {}) {
  return {
    id: "tpl-1",
    tenantId: TENANT,
    key: "enrollment_welcome",
    subject: "Custom subject",
    heading: "Custom heading",
    body: "Custom body for {{studentName}}.",
    footnote: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-02-01T00:00:00Z"),
    deletedAt: null,
    ...over,
  };
}

describe("EmailTemplatesService", () => {
  let service: EmailTemplatesService;
  let repo: Mocked<EmailTemplatesRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new EmailTemplatesService(repo as unknown as EmailTemplatesRepository);
  });

  describe("resolving default vs override", () => {
    // The load-bearing one. A tenant with no rows is the NORMAL state, not an edge case:
    // nothing is seeded, so the enrolment email must render from code or a student who has
    // already paid never receives their login.
    it("falls back to the shipped text when no override exists", async () => {
      const template = await service.get(TENANT, "enrollment_welcome");
      expect(template.subject).toBe(EMAIL_TEMPLATE_DEFAULTS.enrollment_welcome.subject);
      expect(template.isCustomised).toBe(false);
      expect(template.updatedAt).toBeNull();
    });

    it("uses the override when one exists, and says so", async () => {
      repo.findByKey.mockResolvedValue(row());
      const template = await service.get(TENANT, "enrollment_welcome");
      expect(template.subject).toBe("Custom subject");
      expect(template.isCustomised).toBe(true);
    });

    it("lists every key, defaulted or overridden, so none can go missing from the screen", async () => {
      repo.findAll.mockResolvedValue([row()]);
      const list = await service.list(TENANT);
      expect(list.map((t) => t.key).sort()).toEqual(["enrollment_welcome", "payment_receipt"]);
      expect(list.find((t) => t.key === "enrollment_welcome")?.isCustomised).toBe(true);
      expect(list.find((t) => t.key === "payment_receipt")?.isCustomised).toBe(false);
    });
  });

  describe("update()", () => {
    it("saves prose that only uses declared placeholders", async () => {
      await service.update(TENANT, "enrollment_welcome", {
        subject: "Welcome",
        heading: "You're in",
        body: "Hello {{studentName}}, welcome.",
        footnote: null,
      });
      expect(repo.upsert).toHaveBeenCalledWith(
        TENANT,
        "enrollment_welcome",
        expect.objectContaining({ body: "Hello {{studentName}}, welcome." }),
      );
    });

    // A typo'd placeholder is not cosmetic: the renderer leaves it exactly as typed, so
    // "{{studnetName}}" reaches a student as visible braces in an email nobody re-reads.
    it("REFUSES a placeholder this email does not supply, rather than shipping the braces", async () => {
      await expect(
        service.update(TENANT, "enrollment_welcome", {
          subject: "Welcome",
          heading: "You're in",
          body: "Hello {{studnetName}}, welcome.",
          footnote: null,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it("checks the subject and footnote too, not just the body", async () => {
      await expect(
        service.update(TENANT, "enrollment_welcome", {
          subject: "Welcome {{orderId}}",
          heading: "You're in",
          body: "Hello.",
          footnote: null,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("stores a blank footnote as null, so an empty box does not render an empty line", async () => {
      await service.update(TENANT, "enrollment_welcome", {
        subject: "Welcome",
        heading: "You're in",
        body: "Hello.",
        footnote: "   ",
      });
      expect(repo.upsert).toHaveBeenCalledWith(TENANT, "enrollment_welcome", expect.objectContaining({ footnote: null }));
    });
  });

  describe("reset()", () => {
    it("removes the override", async () => {
      repo.findByKey.mockResolvedValue(row());
      await expect(service.reset(TENANT, "enrollment_welcome")).resolves.toEqual({ reset: true });
      expect(repo.remove).toHaveBeenCalledWith("tpl-1");
    });

    // Reporting success here would tell somebody they had undone a customisation that never
    // existed, and hide that the wording they dislike is the shipped default.
    it("404s when the template was never customised, instead of reporting a reset", async () => {
      repo.findByKey.mockResolvedValue(null);
      await expect(service.reset(TENANT, "enrollment_welcome")).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });

  describe("renderForSend()", () => {
    it("interpolates values and keeps the send site's fixed parts", async () => {
      const { subject, html } = await service.renderForSend(
        TENANT,
        "enrollment_welcome",
        { studentName: "Chandra Sekhar" },
        {
          details: [{ label: "LMS username", value: "student@test.com" }],
          button: { label: "Sign in to the LMS", url: "https://lms.example/login" },
        },
      );

      expect(subject).toBe(EMAIL_TEMPLATE_DEFAULTS.enrollment_welcome.subject);
      expect(html).toContain("LMS username");
      expect(html).toContain("https://lms.example/login");
    });

    // THE CREDENTIALS MUST SURVIVE THE TEMPLATE LAYER. The enrolment welcome is the only
    // email that carries a student's temporary password, and the prose around it is now
    // CRM-editable — so the risk is a future change to compose()/renderBrandedEmail quietly
    // dropping the fixed parts and shipping a welcome with no way to log in. Nobody would
    // notice from the CRM preview, which fills in placeholder credentials of its own.
    it("puts the temporary password and username in the rendered email", async () => {
      const { html } = await service.renderForSend(
        TENANT,
        "enrollment_welcome",
        { studentName: "Gandi Phanendra" },
        {
          details: [
            { label: "LMS username", value: "student@example.com" },
            { label: "Temporary password", value: "Tmp-SECRET-123" },
          ],
          button: { label: "Sign in to the LMS", url: "https://lms.example/login" },
        },
      );

      expect(html).toContain("Temporary password");
      expect(html).toContain("Tmp-SECRET-123");
      expect(html).toContain("LMS username");
      expect(html).toContain("student@example.com");
      expect(html).toContain("https://lms.example/login");
    });

    // An override replaces the PROSE only. If editing the wording could drop the credentials
    // table, a staff member rewording the welcome would silently lock new students out.
    it("keeps the credentials even when the prose has been customised", async () => {
      repo.findByKey.mockResolvedValue(row({ body: "A totally rewritten welcome message." }));
      const { html } = await service.renderForSend(
        TENANT,
        "enrollment_welcome",
        { studentName: "Gandi Phanendra" },
        { details: [{ label: "Temporary password", value: "Tmp-SECRET-123" }] },
      );

      expect(html).toContain("A totally rewritten welcome message.");
      expect(html).toContain("Tmp-SECRET-123");
    });

    // Student-supplied. A name is free text somebody typed into a form.
    it("HTML-escapes interpolated values", async () => {
      repo.findByKey.mockResolvedValue(row({ body: "Hello {{studentName}}." }));
      const { html } = await service.renderForSend(TENANT, "enrollment_welcome", {
        studentName: "<script>alert(1)</script>",
      });
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
    });

    // Staff prose is trusted and must NOT be escaped, or every apostrophe in every email
    // the company sends would arrive as "&#39;".
    it("does not escape the staff-authored prose itself", async () => {
      repo.findByKey.mockResolvedValue(row({ body: "We've received it." }));
      const { html } = await service.renderForSend(TENANT, "enrollment_welcome", {});
      expect(html).toContain("We've received it.");
    });

    it("treats a blank line as a paragraph break and a single newline as a line break", async () => {
      repo.findByKey.mockResolvedValue(row({ body: "One.\n\nTwo.\nThree." }));
      const { html } = await service.renderForSend(TENANT, "enrollment_welcome", {});
      expect(html).toContain("One.");
      expect(html).toContain("Two.<br/>Three.");
    });

    // The enrolment email's default must never mention money again — that is the change the
    // owner asked for, and the default is what every tenant sends until somebody edits it.
    it("sends no amount, order or invoice in the default enrolment welcome", async () => {
      const { subject, html } = await service.renderForSend(TENANT, "enrollment_welcome", {
        studentName: "Chandra Sekhar",
      });
      const visible = html.replace(/<[^>]*>/g, " ");
      expect(visible).not.toMatch(/₹/);
      expect(visible).not.toMatch(/\bamount\b/i);
      expect(visible).not.toMatch(/\binvoice\b/i);
      expect(visible).not.toMatch(/\border id\b/i);
      expect(subject).not.toMatch(/payment|₹/i);
    });

    // Both payment emails, not just the first. A student paying a second instalment used to
    // get "we've received your payment of ₹14,999.00" with the order and invoice under it.
    it("sends no amount, order or invoice in the default payment receipt either", async () => {
      const { subject, html } = await service.renderForSend(TENANT, "payment_receipt", {
        studentName: "Chandra Sekhar",
        amountRupees: "14,999.00",
        orderId: "a9adcbe6-2e3e-4351-87d0-ea470ebf0078",
        invoiceNumber: "INV-2026-0001",
      });

      const visible = html.replace(/<[^>]*>/g, " ");
      expect(visible).not.toContain("14,999.00");
      expect(visible).not.toContain("INV-2026-0001");
      expect(visible).not.toContain("a9adcbe6");
      expect(visible).not.toMatch(/₹/);
      expect(subject).not.toMatch(/₹|receipt/i);
    });

    // The placeholders stay DECLARED even though the default no longer uses them, so the
    // CRM can add a receipt back without a deploy. If this list ever shrinks, that door
    // closes and the 422 on save would be the only clue.
    it("still allows the money placeholders, so a receipt can be restored from the CRM", async () => {
      await expect(
        service.update(TENANT, "payment_receipt", {
          subject: "Payment receipt",
          heading: "Payment Received",
          body: "We received ₹{{amountRupees}} for order {{orderId}} ({{invoiceNumber}}).",
          footnote: null,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("preview()", () => {
    it("renders with each variable's sample value rather than leaving braces on screen", async () => {
      const result = await service.preview(TENANT, "payment_receipt");
      expect(result.html).not.toContain("{{");
      expect(result.subject).not.toContain("{{");
    });
  });
});
