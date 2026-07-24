// apps/api/src/modules/notifications/dispatch/index.ts
//
// Barrel export for the dispatch seam + template registry.
//
// ─── What modules #6 (notifications) and #7 (campaigns) import from here ────
//
// Task #6 (NotificationsModule) imports:
//   - DispatchModule                   → import in notifications.module.ts
//   - NOTIFICATION_DISPATCH_PORT       → inject in notification.service.ts
//   - type NotificationDispatchPort    → type for the injected port
//   - type ChannelSendJob              → build send jobs for each channel
//   - type ChannelSendResult           → read dispatch results
//   - TemplateRegistry                 → renderAll(type, payload) + render(type, channel, payload)
//   - isInQuietHours                   → defer logic helper
//   - URGENT_NOTIFICATION_TYPES        → urgency config constant
//   - type QuietHoursResult            → result of the quiet hours check
//
// Task #7 (CampaignsModule) imports:
//   - DispatchModule                   → import in campaigns.module.ts
//   - CAMPAIGN_SEND_PORT               → inject in campaign.service.ts
//   - type CampaignSendPort            → type for the injected port
//   - type RecipientSendJob            → build per-recipient send jobs
//   - type RecipientSendResult         → read send results
//   - TemplateRegistry                 → renderRaw(templateBody, variables) for DB templates
//
// Task #9 (ForumModule — reply notifications) imports:
//   Uses NotificationsService (#6) which internally uses this module.
//   No direct dispatch imports needed.

export { DispatchModule } from "./dispatch.module";

// ─── Notification dispatch port ───────────────────────────────────────────
export { NOTIFICATION_DISPATCH_PORT } from "./notification-dispatch.port";
export type {
  NotificationDispatchPort,
  ChannelSendJob,
  ChannelSendResult,
} from "./notification-dispatch.port";

// ─── Campaign send port ───────────────────────────────────────────────────
export { CAMPAIGN_SEND_PORT } from "./campaign-send.port";
export type {
  CampaignSendPort,
  RecipientSendJob,
  RecipientSendResult,
} from "./campaign-send.port";

// ─── Template registry ────────────────────────────────────────────────────
export { TemplateRegistry, NOTIFICATION_TEMPLATES } from "./template-registry";
export type { RenderedTemplate, RenderedTemplateMap } from "./template-registry";

// ─── Quiet hours helper ───────────────────────────────────────────────────
export {
  isInQuietHours,
  URGENT_NOTIFICATION_TYPES,
  parseHHmm,
  getLocalMinutesOfDay,
  isTimeInWindow,
} from "./quiet-hours.helper";
export type { QuietHoursResult } from "./quiet-hours.helper";

// ─── Adapters (exported for test spying; not normally injected directly) ──
export { SyncNotificationDispatchAdapter } from "./sync-notification-dispatch.adapter";
export { SyncCampaignSendAdapter } from "./sync-campaign-send.adapter";
