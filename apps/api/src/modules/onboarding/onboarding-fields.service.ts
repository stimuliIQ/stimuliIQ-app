// apps/api/src/modules/onboarding/onboarding-fields.service.ts
//
// CRM authoring for the onboarding form's question set. This is the service that makes
// "staff can add a new field" a row insert instead of a deploy — every question on
// stimuliiq.com/onboarding is a row this file writes.
//
// Two rules here are worth reading before changing anything:
//
//   `key` IS IMMUTABLE. It is the join key baked into every answer snapshot ever collected.
//   The update DTO deliberately has no `key`, so "rename this question" edits the visible
//   `label` — which is what staff actually mean — while historical answers stay attached to
//   the question that produced them.
//
//   `identityRole` IS EXCLUSIVE, AND THE SERVICE IS WHAT MAKES IT SO. At most one field may
//   feed each of the Name/Email/Phone columns in the CRM list. This is enforced here rather
//   than with a unique index because reassigning a role is a routine one-step edit ("use
//   *this* question for Name now"), and a DB constraint would make it fail unless staff
//   first cleared the old one. Assigning a role therefore CLEARS it elsewhere instead of
//   erroring — the reassignment staff asked for, performed atomically enough for a
//   single-writer admin screen.

import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateOnboardingFieldRequest,
  ListOnboardingFieldsQuery,
  OnboardingField,
  ReorderOnboardingFieldsRequest,
  UpdateOnboardingFieldRequest,
} from "@repo/types";
import { CHOICE_FIELD_TYPES } from "@repo/types";
import { requireScopeContext } from "../auth/lib/scope-context";
import { OnboardingRepository } from "./onboarding.repository";
import { readOptions, toFieldDto } from "./onboarding.util";

@Injectable()
export class OnboardingFieldsService {
  constructor(private readonly repository: OnboardingRepository) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "onboarding.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for the onboarding form.`,
      });
    }
  }

  async list(tenantId: string, query: ListOnboardingFieldsQuery): Promise<OnboardingField[]> {
    this.assertAllScope();
    const rows = await this.repository.listFields(tenantId, query.active !== undefined ? { active: query.active } : undefined);
    return rows.map(toFieldDto);
  }

  async create(tenantId: string, body: CreateOnboardingFieldRequest): Promise<OnboardingField> {
    this.assertAllScope();

    const clash = await this.repository.findFieldByKey(tenantId, body.key);
    if (clash) {
      throw new ConflictException({
        code: "onboarding.field_key_taken",
        title: "Field key already in use",
        detail: `A question with the key "${body.key}" already exists. Pick a different key.`,
      });
    }

    // A new question goes to the BOTTOM unless staff explicitly placed it. Defaulting to 0
    // would silently drop every new field above "Name", which is never what was meant.
    const sortOrder = body.sortOrder > 0 ? body.sortOrder : (await this.repository.maxFieldSortOrder(tenantId)) + 1;

    const created = await this.repository.createField(tenantId, {
      key: body.key,
      label: body.label,
      helpText: body.helpText ?? null,
      placeholder: body.placeholder ?? null,
      type: body.type,
      required: body.required,
      options: normaliseOptions(body.type, body.options ?? null),
      allowOther: body.allowOther,
      identityRole: body.identityRole,
      sortOrder,
      active: body.active,
    });

    if (body.identityRole !== "none") {
      await this.repository.clearIdentityRole(tenantId, body.identityRole, created.id);
    }

    const row = await this.repository.findFieldById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "onboarding.not_found", title: "Field not found after creation" });
    return toFieldDto(row);
  }

  async update(tenantId: string, id: string, body: UpdateOnboardingFieldRequest): Promise<OnboardingField> {
    this.assertAllScope();
    const existing = await this.repository.findFieldById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "onboarding.not_found", title: "Field not found" });

    // The coherence rules from the create schema, re-applied against the MERGED result:
    // a PATCH that flips `type` to "radio" without sending `options` would otherwise leave
    // an unanswerable empty dropdown live on the public form.
    const nextType = body.type ?? existing.type;
    const nextOptions = body.options !== undefined ? body.options : readOptions(existing.options);
    const nextAllowOther = body.allowOther ?? existing.allowOther;
    assertCoherent(nextType, nextOptions, nextAllowOther);

    const patch: Prisma.OnboardingFieldUpdateInput = {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.helpText !== undefined ? { helpText: body.helpText } : {}),
      ...(body.placeholder !== undefined ? { placeholder: body.placeholder } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.required !== undefined ? { required: body.required } : {}),
      ...(body.allowOther !== undefined ? { allowOther: body.allowOther } : {}),
      ...(body.identityRole !== undefined ? { identityRole: body.identityRole } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    };
    // Options are re-derived from the merged type so switching a "radio" to "text" drops
    // now-meaningless choices rather than leaving them stranded in the row.
    if (body.type !== undefined || body.options !== undefined) {
      const normalised = normaliseOptions(nextType, nextOptions);
      patch.options = normalised === null ? Prisma.DbNull : normalised;
    }

    await this.repository.updateField(id, patch);

    if (body.identityRole !== undefined && body.identityRole !== "none") {
      await this.repository.clearIdentityRole(tenantId, body.identityRole, id);
    }

    const updated = await this.repository.findFieldById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "onboarding.not_found", title: "Field not found after update" });
    return toFieldDto(updated);
  }

  /**
   * Soft-deletes a question. The answers already given to it survive untouched inside each
   * submission's snapshot — that is precisely why answers are snapshotted rather than
   * joined — so removing a question stops it being asked without erasing history.
   */
  async remove(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findFieldById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "onboarding.not_found", title: "Field not found" });
    await this.repository.softDeleteField(id);
  }

  async reorder(tenantId: string, body: ReorderOnboardingFieldsRequest): Promise<OnboardingField[]> {
    this.assertAllScope();
    const existing = await this.repository.listFields(tenantId);
    const knownIds = new Set(existing.map((field) => field.id));
    const unknown = body.fieldIds.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      throw new UnprocessableEntityException({
        code: "onboarding.unknown_field",
        title: "Unknown field in reorder",
        detail: "The form changed while you were editing it. Reload and try again.",
      });
    }
    // A partial list would leave the omitted fields at stale positions, interleaving them
    // unpredictably with the reordered ones — so the whole set must be supplied.
    if (body.fieldIds.length !== existing.length) {
      throw new UnprocessableEntityException({
        code: "onboarding.incomplete_reorder",
        title: "Incomplete reorder",
        detail: "Send every field in its new order.",
      });
    }
    await this.repository.reorderFields(tenantId, body.fieldIds);
    const rows = await this.repository.listFields(tenantId);
    return rows.map(toFieldDto);
  }
}

/** Choices only exist on choice-typed fields; everything else stores null. */
function normaliseOptions(type: string, options: string[] | null): string[] | null {
  if (!(CHOICE_FIELD_TYPES as readonly string[]).includes(type)) return null;
  return options && options.length > 0 ? options : null;
}

function assertCoherent(type: string, options: string[] | null, allowOther: boolean): void {
  const isChoice = (CHOICE_FIELD_TYPES as readonly string[]).includes(type);
  if (isChoice && (!options || options.length === 0)) {
    throw new UnprocessableEntityException({
      code: "onboarding.options_required",
      title: "Choices required",
      detail: `A "${type}" question needs at least one choice.`,
    });
  }
  if (!isChoice && allowOther) {
    throw new UnprocessableEntityException({
      code: "onboarding.allow_other_unsupported",
      title: "\"Other\" not supported",
      detail: `An "Other" option only applies to ${CHOICE_FIELD_TYPES.join("/")} questions.`,
    });
  }
}
