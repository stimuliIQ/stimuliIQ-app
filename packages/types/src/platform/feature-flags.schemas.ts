// Feature flags contract — Phase 9 Completion, T9/T14/T23. Backs `model FeatureFlag`.
// Admin CRUD (list/get/set) under /api/v1/crm/feature-flags. `evaluate` is a cheap,
// cached read any authenticated surface (web/lms/crm) can call to gate UI — it never
// substitutes for a server-side permission check (CLAUDE.md §3.5).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

/** Open-shape rollout rule — e.g. `{ percentage: 25 }` or `{ cohort: ["beta"] }`. */
export const FeatureFlagRolloutSchema = z.record(z.string(), z.unknown());
export type FeatureFlagRollout = z.infer<typeof FeatureFlagRolloutSchema>;

/** PUT /api/v1/crm/feature-flags/:key — upsert-by-key ("set"). */
export const SetFeatureFlagRequestSchema = z
  .object({
    enabled: z.boolean(),
    rollout: FeatureFlagRolloutSchema.nullable().optional(),
    description: z.string().max(500).optional(),
  })
  .strict();
export type SetFeatureFlagRequest = z.infer<typeof SetFeatureFlagRequestSchema>;

export const ListFeatureFlagsQuerySchema = z
  .object({
    enabled: z.coerce.boolean().optional(),
    search: z.string().min(1).max(120).optional().describe("Match by key."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListFeatureFlagsQuery = z.infer<typeof ListFeatureFlagsQuerySchema>;

export const FeatureFlagSchema = z.object({
  id: UuidSchema,
  key: z.string(),
  enabled: z.boolean(),
  rollout: FeatureFlagRolloutSchema.nullable(),
  description: z.string().nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

/** GET /api/v1/feature-flags/evaluate?keys=a,b,c — any authenticated caller, cached read. */
export const EvaluateFeatureFlagsQuerySchema = z
  .object({
    keys: z.string().min(1).describe("Comma-separated flag keys to evaluate."),
  })
  .strict();
export type EvaluateFeatureFlagsQuery = z.infer<typeof EvaluateFeatureFlagsQuerySchema>;

export const EvaluatedFeatureFlagsSchema = z.record(z.string(), z.boolean());
export type EvaluatedFeatureFlags = z.infer<typeof EvaluatedFeatureFlagsSchema>;
