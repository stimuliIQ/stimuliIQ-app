// Settings contract — Phase 9 Completion, T9/T14/T23. Backs `model Setting`
// (system|company scope, per prisma `SettingScope`). Admin read/write under
// /api/v1/crm/settings. `system` scope is platform-wide (Owner/Admin only, typically
// seed-managed); `company` scope is the tenant-configurable override CRM staff edit.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

export const SettingScopeSchema = z.enum(["system", "company"]);
export type SettingScope = z.infer<typeof SettingScopeSchema>;

export const ListSettingsQuerySchema = z
  .object({
    scope: SettingScopeSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListSettingsQuery = z.infer<typeof ListSettingsQuerySchema>;

export const SettingSchema = z.object({
  id: UuidSchema,
  scope: SettingScopeSchema,
  key: z.string(),
  value: z.unknown(),
  updatedAt: IsoDateTimeSchema,
});
export type Setting = z.infer<typeof SettingSchema>;

/** PUT /api/v1/crm/settings/:scope/:key — upsert-by-(scope,key) ("set"). */
export const SetSettingRequestSchema = z
  .object({
    value: z.unknown(),
  })
  .strict();
export type SetSettingRequest = z.infer<typeof SetSettingRequestSchema>;
