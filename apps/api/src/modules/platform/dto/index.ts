// apps/api/src/modules/platform/dto/index.ts
//
// Re-exports the Phase-9 Completion feature-flags + settings zod schemas from
// @repo/types (docs/04-trd-architecture.md §2.2 module template, T9/T14/T23). Never
// redeclare a shape here — single source of truth stays in
// packages/types/src/platform/{feature-flags,settings}.schemas.ts.

export {
  FeatureFlagRolloutSchema,
  type FeatureFlagRollout,
  SetFeatureFlagRequestSchema,
  type SetFeatureFlagRequest,
  ListFeatureFlagsQuerySchema,
  type ListFeatureFlagsQuery,
  FeatureFlagSchema,
  type FeatureFlag,
  EvaluateFeatureFlagsQuerySchema,
  type EvaluateFeatureFlagsQuery,
  EvaluatedFeatureFlagsSchema,
  type EvaluatedFeatureFlags,
} from "@repo/types";

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
