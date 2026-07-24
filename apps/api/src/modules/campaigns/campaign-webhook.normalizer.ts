// apps/api/src/modules/campaigns/campaign-webhook.normalizer.ts
//
// Normalizes a (already-HMAC-verified) provider webhook payload into the internal
// CampaignWebhookEventDto[] shape the service consumes. Pure functions — no I/O, no secrets.
//
// The controller verifies the signature BEFORE calling these; a malformed body simply
// yields [] (the service treats an unknown providerMessageId as a no-op, AC-40).
//
// Vendor payload references:
//   - Resend (Svix): { type: "email.delivered" | "email.bounced" | ..., data: { email_id } }
//   - Meta WhatsApp:  { entry: [{ changes: [{ value: { statuses: [{ id, status, errors? }] } }] }] }
//
// When live credentials arrive, extend the event maps below to cover any additional
// vendor event names; the target shape (providerMessageId + normalized event) is stable.

import type { CampaignWebhookEventDto } from "@repo/types";

type NormalizedEvent = CampaignWebhookEventDto["event"];

// Resend event type → normalized RecipientStatus-ish event.
const RESEND_EVENT_MAP: Record<string, NormalizedEvent> = {
  "email.delivered": "delivered",
  "email.opened": "read",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "failed",
  "email.failed": "failed",
};

// Meta WhatsApp status → normalized event.
const WHATSAPP_STATUS_MAP: Record<string, NormalizedEvent> = {
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

function safeParse(rawString: string): unknown {
  try {
    return JSON.parse(rawString);
  } catch {
    return null;
  }
}

export function normalizeCampaignWebhook(
  channel: "email" | "whatsapp",
  rawString: string,
): CampaignWebhookEventDto[] {
  const parsed = safeParse(rawString);
  if (!parsed || typeof parsed !== "object") return [];

  // Escape hatch: a body already in the normalized shape (used by tests + internal replays).
  const asRecord = parsed as Record<string, unknown>;
  if (typeof asRecord["providerMessageId"] === "string" && typeof asRecord["event"] === "string") {
    return [asRecord as unknown as CampaignWebhookEventDto];
  }

  if (channel === "email") {
    const type = asRecord["type"];
    const data = asRecord["data"] as Record<string, unknown> | undefined;
    const providerMessageId = data?.["email_id"];
    const event = typeof type === "string" ? RESEND_EVENT_MAP[type] : undefined;
    if (typeof providerMessageId === "string" && event) {
      return [{ providerMessageId, event }];
    }
    return [];
  }

  // WhatsApp — walk entry[].changes[].value.statuses[].
  const out: CampaignWebhookEventDto[] = [];
  const entries = asRecord["entry"];
  if (!Array.isArray(entries)) return [];
  for (const entry of entries) {
    const changes = (entry as Record<string, unknown>)?.["changes"];
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as Record<string, unknown>)?.["value"] as Record<string, unknown> | undefined;
      const statuses = value?.["statuses"];
      if (!Array.isArray(statuses)) continue;
      for (const status of statuses) {
        const s = status as Record<string, unknown>;
        const providerMessageId = s["id"];
        const event = typeof s["status"] === "string" ? WHATSAPP_STATUS_MAP[s["status"] as string] : undefined;
        if (typeof providerMessageId === "string" && event) {
          const errorDetail = Array.isArray(s["errors"]) ? "provider_failed" : undefined;
          out.push({ providerMessageId, event, ...(errorDetail ? { errorDetail } : {}) });
        }
      }
    }
  }
  return out;
}
