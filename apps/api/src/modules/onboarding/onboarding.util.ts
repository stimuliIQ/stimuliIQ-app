// apps/api/src/modules/onboarding/onboarding.util.ts
//
// Row → DTO mappers shared by the public service and the CRM admin service, kept in one
// file so the two never grow slightly different ideas of what a field is. The public
// projection in particular MUST stay narrower than the CRM one — see `toPublicField`.

import type { OnboardingField, OnboardingValidatableField, PublicOnboardingField } from "@repo/types";
import type { OnboardingFieldRow } from "./onboarding.repository";

/**
 * Storage-key namespace for onboarding file answers. Every minted key is
 * `onboarding/{tenantId}/{uuid}-{filename}` (S3StorageProvider.buildKey), and the submit
 * path re-checks that prefix before trusting a client-supplied key — so this constant is
 * load-bearing security, not just tidiness.
 */
export const ONBOARDING_STORAGE_NAMESPACE = "onboarding";

/** `options` is JSON in the DB; anything that is not an array of strings reads as "none". */
export function readOptions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length > 0 ? strings : null;
}

/** Full field, as the CRM authoring screen sees it. */
export function toFieldDto(row: OnboardingFieldRow): OnboardingField {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    helpText: row.helpText,
    placeholder: row.placeholder,
    type: row.type,
    required: row.required,
    options: readOptions(row.options),
    allowOther: row.allowOther,
    identityRole: row.identityRole,
    sortOrder: row.sortOrder,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Field as an anonymous browser sees it. `id`, `identityRole`, `active` and the timestamps
 * are deliberately absent: they are CRM-authoring concerns that mean nothing to a student
 * and would only widen what a public endpoint discloses about internal configuration.
 */
export function toPublicField(row: OnboardingFieldRow): PublicOnboardingField {
  return {
    key: row.key,
    label: row.label,
    helpText: row.helpText,
    placeholder: row.placeholder,
    type: row.type,
    required: row.required,
    options: readOptions(row.options),
    allowOther: row.allowOther,
  };
}

/** The subset `buildOnboardingAnswerIssues` (@repo/types) needs to validate an answer. */
export function toValidatableField(row: OnboardingFieldRow): OnboardingValidatableField {
  return {
    key: row.key,
    label: row.label,
    type: row.type,
    required: row.required,
    options: readOptions(row.options),
    allowOther: row.allowOther,
  };
}
