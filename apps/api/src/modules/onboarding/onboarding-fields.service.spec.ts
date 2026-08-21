// apps/api/src/modules/onboarding/onboarding-fields.service.spec.ts
//
// Unit tests for OnboardingFieldsService, the CRM authoring surface that makes "add a
// question to the onboarding form" a row insert rather than a deploy.
//
// The invariants under test are the ones that protect data ALREADY COLLECTED from a later
// edit to the form:
//   - `key` never changes (it is the join key inside every answer snapshot);
//   - a duplicate key is a 409, not a silent second question with the same identity;
//   - deleting a question is a soft delete and does not touch existing answers;
//   - `identityRole` is exclusive, and reassigning it CLEARS the previous holder rather
//     than erroring, because reassignment is the routine operation staff perform;
//   - options/allowOther stay coherent with `type` across a PARTIAL patch, so flipping a
//     question to "radio" can never leave an unanswerable empty dropdown live.

import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { OnboardingFieldsService } from "./onboarding-fields.service";
import { OnboardingRepository, type OnboardingFieldRow } from "./onboarding.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

const TENANT = "tenant-1";

function mockRepository(): Mocked<OnboardingRepository> {
  return {
    getTenantIdBySlug: jest.fn(),
    listFields: jest.fn().mockResolvedValue([]),
    findFieldById: jest.fn(),
    findFieldByKey: jest.fn().mockResolvedValue(null),
    createField: jest.fn().mockResolvedValue({ id: "field-new" }),
    updateField: jest.fn(),
    softDeleteField: jest.fn(),
    clearIdentityRole: jest.fn(),
    reorderFields: jest.fn(),
    maxFieldSortOrder: jest.fn().mockResolvedValue(7),
    listSelectablePrograms: jest.fn(),
    findProgramById: jest.fn(),
    createSubmission: jest.fn(),
    listSubmissions: jest.fn(),
    findSubmissionById: jest.fn(),
    updateSubmission: jest.fn(),
    softDeleteSubmission: jest.fn(),
  } as unknown as Mocked<OnboardingRepository>;
}

function row(overrides: Partial<OnboardingFieldRow> & Pick<OnboardingFieldRow, "key" | "type">): OnboardingFieldRow {
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

const BASE_CREATE = {
  label: "College Name",
  type: "text" as const,
  required: true,
  allowOther: false,
  identityRole: "none" as const,
  sortOrder: 0,
  active: true,
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "onboarding.fields.manage", scope, actorId: "actor-1", tenantId: TENANT };
  return scopeContextStorage.run(ctx, fn);
}

describe("OnboardingFieldsService", () => {
  let service: OnboardingFieldsService;
  let repo: Mocked<OnboardingRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new OnboardingFieldsService(repo as unknown as OnboardingRepository);
  });

  it("fails closed on any scope narrower than `all`", async () => {
    await expect(runWithScope("branch", () => service.list(TENANT, {}))).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe("create()", () => {
    it("409s on a key already in use rather than creating a twin question", async () => {
      repo.findFieldByKey.mockResolvedValue(row({ key: "college_name", type: "text" }));
      await expect(
        runWithScope("all", () => service.create(TENANT, { ...BASE_CREATE, key: "college_name" })),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.createField).not.toHaveBeenCalled();
    });

    it("places a new question at the BOTTOM when no explicit order is given", async () => {
      repo.findFieldById.mockResolvedValue(row({ key: "college_name", type: "text" }));
      await runWithScope("all", () => service.create(TENANT, { ...BASE_CREATE, key: "college_name", sortOrder: 0 }));
      // maxFieldSortOrder is 7 → the new row lands at 8, not at 0 above "Name".
      expect(repo.createField).toHaveBeenCalledWith(TENANT, expect.objectContaining({ sortOrder: 8 }));
    });

    it("honours an explicit position when staff chose one", async () => {
      repo.findFieldById.mockResolvedValue(row({ key: "college_name", type: "text" }));
      await runWithScope("all", () => service.create(TENANT, { ...BASE_CREATE, key: "college_name", sortOrder: 3 }));
      expect(repo.createField).toHaveBeenCalledWith(TENANT, expect.objectContaining({ sortOrder: 3 }));
    });

    it("drops choices on a non-choice question instead of storing dead data", async () => {
      repo.findFieldById.mockResolvedValue(row({ key: "college_name", type: "text" }));
      await runWithScope("all", () =>
        service.create(TENANT, { ...BASE_CREATE, key: "college_name", type: "text", options: ["a", "b"] }),
      );
      expect(repo.createField).toHaveBeenCalledWith(TENANT, expect.objectContaining({ options: null }));
    });

    it("claiming an identity role clears it from whichever question held it", async () => {
      repo.findFieldById.mockResolvedValue(row({ key: "student_email", type: "email", identityRole: "email" }));
      await runWithScope("all", () =>
        service.create(TENANT, { ...BASE_CREATE, key: "student_email", type: "email", identityRole: "email" }),
      );
      expect(repo.clearIdentityRole).toHaveBeenCalledWith(TENANT, "email", "field-new");
    });
  });

  describe("update()", () => {
    it("404s an unknown field", async () => {
      repo.findFieldById.mockResolvedValue(null);
      await expect(
        runWithScope("all", () => service.update(TENANT, "missing", { label: "New" })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.updateField).not.toHaveBeenCalled();
    });

    // The partial-patch trap: `type` arrives without `options`, so coherence must be
    // checked against the MERGED result, not against the request body alone.
    it("rejects switching a question to a choice type without supplying choices", async () => {
      repo.findFieldById.mockResolvedValue(row({ key: "month_opted", type: "text" }));
      await expect(
        runWithScope("all", () => service.update(TENANT, "field-month_opted", { type: "radio" })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.updateField).not.toHaveBeenCalled();
    });

    it("keeps existing choices when only the label changes", async () => {
      const existing = row({ key: "month_opted", type: "radio", options: ["September"] as never });
      repo.findFieldById.mockResolvedValue(existing);
      await runWithScope("all", () => service.update(TENANT, existing.id, { label: "Preferred month" }));
      // `options` is left out of the patch entirely, an untouched column must not be
      // rewritten just because the request didn't mention it.
      expect(repo.updateField).toHaveBeenCalledWith(existing.id, { label: "Preferred month" });
    });

    it("clears now-meaningless choices when a choice question becomes free text", async () => {
      const existing = row({ key: "month_opted", type: "radio", options: ["September"] as never });
      repo.findFieldById.mockResolvedValue(existing);
      await runWithScope("all", () => service.update(TENANT, existing.id, { type: "text", allowOther: false }));
      expect(repo.updateField).toHaveBeenCalledWith(
        existing.id,
        expect.objectContaining({ type: "text", options: Prisma.DbNull }),
      );
    });
  });

  describe("remove()", () => {
    it("soft-deletes so answers already given to the question survive", async () => {
      const existing = row({ key: "referrals", type: "textarea" });
      repo.findFieldById.mockResolvedValue(existing);
      await runWithScope("all", () => service.remove(TENANT, existing.id));
      expect(repo.softDeleteField).toHaveBeenCalledWith(existing.id);
    });

    it("404s an unknown field", async () => {
      repo.findFieldById.mockResolvedValue(null);
      await expect(runWithScope("all", () => service.remove(TENANT, "missing"))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("reorder()", () => {
    const existing = [row({ key: "a", type: "text" }), row({ key: "b", type: "text" })];

    it("applies a full reorder", async () => {
      repo.listFields.mockResolvedValue(existing);
      await runWithScope("all", () => service.reorder(TENANT, { fieldIds: ["field-b", "field-a"] }));
      expect(repo.reorderFields).toHaveBeenCalledWith(TENANT, ["field-b", "field-a"]);
    });

    // A partial list would leave the omitted rows at stale positions, interleaving them
    // unpredictably with the reordered ones.
    it("rejects a partial list", async () => {
      repo.listFields.mockResolvedValue(existing);
      await expect(
        runWithScope("all", () => service.reorder(TENANT, { fieldIds: ["field-a"] })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.reorderFields).not.toHaveBeenCalled();
    });

    it("rejects ids that are not part of this form (stale editor state)", async () => {
      repo.listFields.mockResolvedValue(existing);
      await expect(
        runWithScope("all", () => service.reorder(TENANT, { fieldIds: ["field-a", "field-ghost"] })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });
});
