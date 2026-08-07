// apps/api/src/modules/onboarding/onboarding.service.spec.ts
//
// Unit tests for OnboardingService — the anonymous submit path and the CRM read/triage
// path for the onboarding form (stimuliiq.com/onboarding).
//
// The cases below are chosen around the things that are structurally easy to get wrong in
// a form whose shape is data rather than code:
//   - validation resolved against the LIVE field set, not a fixed DTO;
//   - the answer SNAPSHOT freezing labels/types so later field edits can't rewrite history;
//   - identity columns derived from `identityRole` rather than from magic key names;
//   - the cross-tenant storage-key guard on file answers (the careers Wave-6 M3 lesson);
//   - signed download URLs minted per request, never a raw storage key on the wire.

import { ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { OnboardingAnswer } from "@repo/types";
import { OnboardingService } from "./onboarding.service";
import { OnboardingRepository, type OnboardingFieldRow, type OnboardingSubmissionRow } from "./onboarding.repository";
import type { OnboardingActivationService } from "./onboarding-activation.service";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

const TENANT = "tenant-1";

function mockRepository(): Mocked<OnboardingRepository> {
  return {
    getTenantIdBySlug: jest.fn().mockResolvedValue(TENANT),
    listFields: jest.fn(),
    findFieldById: jest.fn(),
    findFieldByKey: jest.fn(),
    createField: jest.fn(),
    updateField: jest.fn(),
    softDeleteField: jest.fn(),
    clearIdentityRole: jest.fn(),
    reorderFields: jest.fn(),
    maxFieldSortOrder: jest.fn(),
    listSelectablePrograms: jest.fn().mockResolvedValue([]),
    findProgramById: jest.fn(),
    createSubmission: jest.fn().mockResolvedValue({ id: "sub-1" }),
    listSubmissions: jest.fn(),
    findSubmissionById: jest.fn(),
    updateSubmission: jest.fn(),
    softDeleteSubmission: jest.fn(),
  } as unknown as Mocked<OnboardingRepository>;
}

function mockCaptcha() {
  return { verify: jest.fn().mockResolvedValue({ success: true }) };
}

function mockStorage() {
  return {
    getSignedUploadUrl: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    putObject: jest.fn(),
    delete: jest.fn(),
    head: jest.fn(),
  };
}

function mockRateLimiter() {
  return { hit: jest.fn().mockResolvedValue(false) };
}

function field(overrides: Partial<OnboardingFieldRow> & Pick<OnboardingFieldRow, "key" | "type">): OnboardingFieldRow {
  return {
    id: `field-${overrides.key}`,
    label: overrides.key,
    helpText: null,
    placeholder: null,
    required: false,
    options: null,
    allowOther: false,
    identityRole: "none",
    sortOrder: 0,
    active: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as OnboardingFieldRow;
}

const FIELDS: OnboardingFieldRow[] = [
  field({ key: "full_name", type: "text", label: "Name", required: true, identityRole: "name" }),
  field({ key: "email", type: "email", label: "Email ID", required: true, identityRole: "email" }),
  field({ key: "contact_number", type: "phone", label: "Contact Number", required: true, identityRole: "phone" }),
  field({ key: "program", type: "program", label: "Program", required: true }),
  field({
    key: "month_opted",
    type: "radio",
    label: "Month Opted",
    required: true,
    options: ["September", "October"] as never,
    allowOther: true,
  }),
  field({ key: "payment_receipt", type: "file", label: "Payment Receipt", required: true }),
];

const VALID_ANSWERS = {
  full_name: "Ananya Sharma",
  email: "Ananya@Example.com",
  contact_number: "9876543210",
  program: "program-1",
  month_opted: "October",
  payment_receipt: `onboarding/${TENANT}/uuid-receipt.png`,
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "onboarding.view", scope, actorId: "actor-1", tenantId: TENANT };
  return scopeContextStorage.run(ctx, fn);
}

/** Reads back what `createSubmission` was called with, as the typed snapshot. */
function submittedAnswers(repo: Mocked<OnboardingRepository>): OnboardingAnswer[] {
  return (repo.createSubmission as jest.Mock).mock.calls[0][1].answers as OnboardingAnswer[];
}

describe("OnboardingService", () => {
  let service: OnboardingService;
  let repo: Mocked<OnboardingRepository>;
  let storage: ReturnType<typeof mockStorage>;
  let captcha: ReturnType<typeof mockCaptcha>;
  let rateLimiter: ReturnType<typeof mockRateLimiter>;
  let activation: { activate: jest.Mock };

  beforeEach(() => {
    repo = mockRepository();
    storage = mockStorage();
    captcha = mockCaptcha();
    rateLimiter = mockRateLimiter();
    activation = { activate: jest.fn() };
    service = new OnboardingService(
      repo as unknown as OnboardingRepository,
      captcha as never,
      storage as never,
      rateLimiter as never,
      activation as unknown as OnboardingActivationService,
    );
    repo.listFields.mockResolvedValue(FIELDS);
    repo.findProgramById.mockResolvedValue({ id: "program-1", title: "Clinical Neurology Fellowship" });
  });

  describe("getPublicForm()", () => {
    it("returns only the public projection — no ids, identityRole or timestamps reach the browser", async () => {
      const form = await service.getPublicForm();
      expect(form.fields[0]).toEqual({
        key: "full_name",
        label: "Name",
        helpText: null,
        placeholder: null,
        type: "text",
        required: true,
        options: null,
        allowOther: false,
      });
      expect(form.fields[0]).not.toHaveProperty("id");
      expect(form.fields[0]).not.toHaveProperty("identityRole");
    });

    it("skips the catalog query entirely when no field asks for a program", async () => {
      repo.listFields.mockResolvedValue([field({ key: "full_name", type: "text" })]);
      await service.getPublicForm();
      expect(repo.listSelectablePrograms).not.toHaveBeenCalled();
    });
  });

  describe("getUploadUrl()", () => {
    const body = {
      fieldKey: "payment_receipt",
      contentType: "image/png" as const,
      fileName: "receipt.png",
      sizeBytes: 1024,
      captchaToken: "noop",
    };

    it("mints an onboarding/{tenant}-namespaced key for a real file field", async () => {
      repo.findFieldByKey.mockResolvedValue(field({ key: "payment_receipt", type: "file" }));
      storage.getSignedUploadUrl.mockResolvedValue({
        url: "https://signed.example.com/put",
        storageKey: `onboarding/${TENANT}/uuid-receipt.png`,
        expiresAt: new Date("2026-01-01T00:15:00Z"),
        requiredHeaders: { "Content-Type": "image/png" },
      });

      const result = await service.getUploadUrl(body);

      expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ key: expect.stringMatching(/^onboarding\/tenant-1\//), ttlSeconds: 900 }),
      );
      expect(result.storageKey).toBe(`onboarding/${TENANT}/uuid-receipt.png`);
    });

    it("refuses to mint for a key that is not an active file question (no open write primitive)", async () => {
      repo.findFieldByKey.mockResolvedValue(null);
      await expect(service.getUploadUrl(body)).rejects.toBeInstanceOf(UnprocessableEntityException);

      // A real field of the wrong type is refused for the same reason.
      repo.findFieldByKey.mockResolvedValue(field({ key: "payment_receipt", type: "text" }));
      await expect(service.getUploadUrl(body)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(storage.getSignedUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe("submit()", () => {
    it("accepts a complete submission and stores it", async () => {
      const result = await service.submit({ answers: VALID_ANSWERS, captchaToken: "noop" }, "1.2.3.4");
      expect(result.id).toBe("sub-1");
      expect(repo.createSubmission).toHaveBeenCalledTimes(1);
    });

    it("reports EVERY missing required answer at once, keyed by field", async () => {
      const error = await service.submit({ answers: {}, captchaToken: "noop" }, "1.2.3.4").catch((e) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      const paths = (error.getResponse().errors as Array<{ path: string }>).map((e) => e.path);
      expect(paths).toEqual(
        expect.arrayContaining([
          "answers.full_name",
          "answers.email",
          "answers.contact_number",
          "answers.program",
          "answers.month_opted",
          "answers.payment_receipt",
        ]),
      );
      expect(repo.createSubmission).not.toHaveBeenCalled();
    });

    it("accepts free text for a radio question that allows Other", async () => {
      await service.submit({ answers: { ...VALID_ANSWERS, month_opted: "January next year" }, captchaToken: "noop" }, "ip");
      expect(repo.createSubmission).toHaveBeenCalled();
    });

    it("rejects an off-list choice when the question does NOT allow Other", async () => {
      repo.listFields.mockResolvedValue([
        field({ key: "month_opted", type: "radio", label: "Month", required: true, options: ["September"] as never }),
      ]);
      await expect(
        service.submit({ answers: { month_opted: "Marchember" }, captchaToken: "noop" }, "ip"),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("rejects a program id the catalog does not offer (browser-supplied ids are not trusted)", async () => {
      repo.findProgramById.mockResolvedValue(null);
      const error = await service
        .submit({ answers: { ...VALID_ANSWERS, program: "some-other-uuid" }, captchaToken: "noop" }, "ip")
        .catch((e) => e);
      expect((error.getResponse().errors as Array<{ path: string }>).map((e) => e.path)).toContain("answers.program");
    });

    // SECURITY: the careers Wave-6 M3 lesson, applied here. A submitted storage key is only
    // ever one this API minted into THIS tenant's namespace — otherwise the CRM detail view
    // would later mint a signed download URL for someone else's object.
    it("rejects a file answer whose storage key points outside this tenant's namespace", async () => {
      const error = await service
        .submit(
          { answers: { ...VALID_ANSWERS, payment_receipt: "onboarding/other-tenant/uuid-receipt.png" }, captchaToken: "noop" },
          "ip",
        )
        .catch((e) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error.getResponse().errors as Array<{ path: string }>).map((e) => e.path)).toContain("answers.payment_receipt");
      expect(repo.createSubmission).not.toHaveBeenCalled();
    });

    it("refuses to accept anything when the form has no questions", async () => {
      repo.listFields.mockResolvedValue([]);
      await expect(service.submit({ answers: {}, captchaToken: "noop" }, "ip")).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it("freezes each answer's label and type into the snapshot", async () => {
      await service.submit({ answers: VALID_ANSWERS, captchaToken: "noop" }, "ip");
      const answers = submittedAnswers(repo);
      expect(answers).toContainEqual(
        expect.objectContaining({ key: "full_name", label: "Name", type: "text", value: "Ananya Sharma" }),
      );
      // A program answer is stored by TITLE — a staff member reading a submission should
      // not have to resolve a uuid to know which program was chosen.
      expect(answers).toContainEqual(
        expect.objectContaining({ key: "program", value: "Clinical Neurology Fellowship" }),
      );
      // A file answer keeps the opaque key separately and displays the original filename.
      expect(answers).toContainEqual(
        expect.objectContaining({
          key: "payment_receipt",
          value: "receipt.png",
          storageKey: `onboarding/${TENANT}/uuid-receipt.png`,
        }),
      );
    });

    it("derives the CRM identity columns from identityRole, normalising email and phone", async () => {
      await service.submit({ answers: VALID_ANSWERS, captchaToken: "noop" }, "ip");
      expect(repo.createSubmission).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({
          fullName: "Ananya Sharma",
          email: "ananya@example.com", // lowercased
          phone: "+919876543210", // stored E.164, entered as 10 local digits
          programId: "program-1",
        }),
      );
    });

    it("leaves identity columns null when no field claims the role", async () => {
      repo.listFields.mockResolvedValue([field({ key: "college_name", type: "text", label: "College" })]);
      await service.submit({ answers: { college_name: "ABC Institute" }, captchaToken: "noop" }, "ip");
      expect(repo.createSubmission).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({ fullName: null, email: null, phone: null }),
      );
    });

    it("never stores the raw IP — only a hash (DPDP)", async () => {
      await service.submit({ answers: VALID_ANSWERS, captchaToken: "noop" }, "203.0.113.7");
      const stored = (repo.createSubmission as jest.Mock).mock.calls[0][1];
      expect(stored.ipHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(stored)).not.toContain("203.0.113.7");
    });

    it("strips HTML from free-text answers at write time (anonymous, untrusted input)", async () => {
      repo.listFields.mockResolvedValue([field({ key: "referrals", type: "textarea", label: "Referrals" })]);
      await service.submit({ answers: { referrals: "<script>alert(1)</script>Priya" }, captchaToken: "noop" }, "ip");
      expect(submittedAnswers(repo)[0]?.value).toBe("alert(1)Priya");
    });
  });

  describe("CRM reads", () => {
    const ROW: OnboardingSubmissionRow = {
      id: "sub-1",
      fullName: "Ananya Sharma",
      email: "ananya@example.com",
      phone: "+919876543210",
      programId: "program-1",
      answers: [
        { fieldId: "f1", key: "full_name", label: "Name", type: "text", value: "Ananya Sharma", storageKey: null },
        {
          fieldId: "f2",
          key: "payment_receipt",
          label: "Payment Receipt",
          type: "file",
          value: "receipt.png",
          storageKey: `onboarding/${TENANT}/uuid-receipt.png`,
        },
      ] as never,
      status: "pending",
      reviewNotes: null,
      reviewedAt: null,
      studentProfileId: null,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      program: { title: "Clinical Neurology Fellowship" },
      reviewedBy: null,
    };

    it("fails closed on any scope narrower than `all`", async () => {
      repo.listSubmissions.mockResolvedValue({ rows: [], total: 0 });
      await expect(
        runWithScope("branch", () => service.listSubmissions(TENANT, { page: 1, pageSize: 20 })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("flags rows carrying an attachment so the list can show it without opening each one", async () => {
      repo.listSubmissions.mockResolvedValue({ rows: [ROW], total: 1 });
      const result = await runWithScope("all", () => service.listSubmissions(TENANT, { page: 1, pageSize: 20 }));
      expect(result.items[0]?.hasAttachment).toBe(true);
    });

    it("mints a signed download URL per file answer and never returns the raw key as a URL", async () => {
      repo.findSubmissionById.mockResolvedValue(ROW);
      storage.getSignedDownloadUrl.mockResolvedValue({ url: "https://signed.example.com/get", expiresAt: new Date() });

      const detail = await runWithScope("all", () => service.getSubmissionById(TENANT, "sub-1"));

      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith({ key: `onboarding/${TENANT}/uuid-receipt.png` });
      expect(detail.attachmentUrls[`onboarding/${TENANT}/uuid-receipt.png`]).toBe("https://signed.example.com/get");
    });

    it("still returns the text answers when signing an attachment fails", async () => {
      repo.findSubmissionById.mockResolvedValue(ROW);
      storage.getSignedDownloadUrl.mockRejectedValue(new Error("storage unconfigured"));

      const detail = await runWithScope("all", () => service.getSubmissionById(TENANT, "sub-1"));

      expect(detail.answers).toHaveLength(2);
      expect(detail.attachmentUrls).toEqual({});
    });

    it("404s an unknown submission", async () => {
      repo.findSubmissionById.mockResolvedValue(null);
      await expect(runWithScope("all", () => service.getSubmissionById(TENANT, "missing"))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("stamps the reviewer on any triage write, and never touches the answers", async () => {
      repo.findSubmissionById.mockResolvedValue(ROW);
      await runWithScope("all", () => service.updateSubmission(TENANT, "sub-1", { status: "hold" }, "staff-1"));

      const patch = (repo.updateSubmission as jest.Mock).mock.calls[0][1];
      expect(patch).toEqual(
        expect.objectContaining({ status: "hold", reviewedById: "staff-1", reviewedAt: expect.any(Date) }),
      );
      expect(patch).not.toHaveProperty("answers");
    });

    // ── Approve: the decision with consequences ───────────────────────────
    describe("approveSubmission()", () => {
      const ACTIVATION = {
        studentProfileId: "student-1",
        enrollmentId: "enrol-1",
        batchName: "September 2026 Batch",
        studentCreated: true,
        credentialsEmailed: true,
      };

      beforeEach(() => {
        repo.findSubmissionById.mockResolvedValue(ROW);
        activation.activate.mockResolvedValue(ACTIVATION);
      });

      it("activates the student, then records the approval with the reviewer and the link", async () => {
        const result = await runWithScope("all", () =>
          service.approveSubmission(TENANT, "sub-1", { batchId: "batch-1" }, "staff-1"),
        );

        expect(activation.activate).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: TENANT,
            batchId: "batch-1",
            email: "ananya@example.com",
            programId: "program-1",
          }),
        );
        expect(repo.updateSubmission).toHaveBeenCalledWith(
          "sub-1",
          expect.objectContaining({
            status: "approved",
            studentProfileId: "student-1",
            reviewedById: "staff-1",
            reviewedAt: expect.any(Date),
          }),
        );
        expect(result.activation).toEqual(ACTIVATION);
      });

      // Ordering guarantee: a failed activation must leave the submission untouched and
      // still actionable, never "approved" with no student behind it.
      it("does NOT mark the submission approved when activation fails", async () => {
        activation.activate.mockRejectedValue(new UnprocessableEntityException({ code: "onboarding.batch_not_found" }));

        await expect(
          runWithScope("all", () => service.approveSubmission(TENANT, "sub-1", { batchId: "bad" }, "staff-1")),
        ).rejects.toBeInstanceOf(UnprocessableEntityException);

        expect(repo.updateSubmission).not.toHaveBeenCalled();
      });

      // Idempotency: `studentProfileId` is set only by a successful activation, so its
      // presence is proof this submission already enrolled someone.
      it("refuses a second approval instead of enrolling the student twice", async () => {
        repo.findSubmissionById.mockResolvedValue({ ...ROW, status: "approved", studentProfileId: "student-1" });

        await expect(
          runWithScope("all", () => service.approveSubmission(TENANT, "sub-1", { batchId: "batch-1" }, "staff-2")),
        ).rejects.toBeInstanceOf(UnprocessableEntityException);

        expect(activation.activate).not.toHaveBeenCalled();
      });

      it("passes the college answer through from the frozen snapshot", async () => {
        repo.findSubmissionById.mockResolvedValue({
          ...ROW,
          answers: [
            { fieldId: "f3", key: "college_name", label: "College Name", type: "text", value: "ABC Institute", storageKey: null },
          ] as never,
        });

        await runWithScope("all", () => service.approveSubmission(TENANT, "sub-1", { batchId: "batch-1" }, "staff-1"));

        expect(activation.activate).toHaveBeenCalledWith(expect.objectContaining({ college: "ABC Institute" }));
      });
    });

    // An approved submission has an enrolled student behind it; flipping the chip back
    // would make the record disagree with reality.
    it("refuses to re-decide an already-approved submission via PATCH", async () => {
      repo.findSubmissionById.mockResolvedValue({ ...ROW, status: "approved", studentProfileId: "student-1" });

      await expect(
        runWithScope("all", () => service.updateSubmission(TENANT, "sub-1", { status: "rejected" }, "staff-1")),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.updateSubmission).not.toHaveBeenCalled();
    });

    it("still allows notes to be added to an approved submission", async () => {
      repo.findSubmissionById.mockResolvedValue({ ...ROW, status: "approved", studentProfileId: "student-1" });

      await runWithScope("all", () => service.updateSubmission(TENANT, "sub-1", { reviewNotes: "Receipt verified" }, "staff-1"));

      expect(repo.updateSubmission).toHaveBeenCalledWith("sub-1", expect.objectContaining({ reviewNotes: "Receipt verified" }));
    });

    describe("listApprovableBatches()", () => {
      it("returns the open cohorts of the submission's program", async () => {
        repo.findSubmissionById.mockResolvedValue(ROW);
        repo.listApprovableBatches.mockResolvedValue([
          { id: "batch-1", name: "September 2026 Batch", startDate: new Date("2026-09-01T00:00:00Z"), status: "planned" },
        ]);

        const batches = await runWithScope("all", () => service.listApprovableBatches(TENANT, "sub-1"));

        expect(repo.listApprovableBatches).toHaveBeenCalledWith(TENANT, "program-1");
        expect(batches[0]).toEqual({
          id: "batch-1",
          name: "September 2026 Batch",
          startDate: "2026-09-01T00:00:00.000Z",
          status: "planned",
        });
      });

      it("returns an empty list — not an error — when the form captured no program", async () => {
        repo.findSubmissionById.mockResolvedValue({ ...ROW, programId: null });
        await expect(runWithScope("all", () => service.listApprovableBatches(TENANT, "sub-1"))).resolves.toEqual([]);
        expect(repo.listApprovableBatches).not.toHaveBeenCalled();
      });
    });
  });
});
