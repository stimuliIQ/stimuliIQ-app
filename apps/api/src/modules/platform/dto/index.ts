// apps/api/src/modules/platform/dto/index.ts
//
// Re-exports the Phase-9 Completion settings zod schemas from @repo/types
// (docs/04-trd-architecture.md §2.2 module template, T14/T23). Never redeclare a shape
// here — single source of truth stays in packages/types/src/platform/settings.schemas.ts.
//
// The feature-flags half of this barrel was removed with the feature-flags module: the
// flag table, endpoints and CRM screen existed but nothing in any app ever evaluated a
// flag, so the whole seam was deleted rather than left as a toggle that changed nothing.

export {
  SettingScopeSchema,
  type SettingScope,
  ListSettingsQuerySchema,
  type ListSettingsQuery,
  SettingSchema,
  type Setting,
  SetSettingRequestSchema,
  type SetSettingRequest,
} from "@repo/types";
