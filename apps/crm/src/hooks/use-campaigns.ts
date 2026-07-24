// Campaigns + campaign-templates data hooks — Phase 6 CRM Marketing surface.
// All TanStack Query usage + api-client calls live here; no business logic
// in components (CLAUDE.md §3: hooks own data concerns).
//
// Covers:
//   - Campaign templates (listTemplates, create/update/delete)
//   - Campaigns (list, get, create, update, delete)
//   - Send / pause / cancel lifecycle actions
//   - Per-campaign recipients + metrics queries
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CampaignChannel,
  CampaignStatus,
  CreateCampaignDto,
  CreateCampaignTemplateDto,
  ListCampaignsQuery,
  ListCampaignRecipientsQuery,
  ListCampaignTemplatesQuery,
  RecipientStatus,
  UpdateCampaignDto,
  UpdateCampaignTemplateDto,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

// ── Query keys ─────────────────────────────────────────────────────────────────

export const CAMPAIGNS_QUERY_KEY = ["campaigns"] as const;
export const CAMPAIGN_TEMPLATES_QUERY_KEY = ["campaign-templates"] as const;

export function campaignTemplatesListKey(query: Partial<ListCampaignTemplatesQuery>) {
  return [...CAMPAIGN_TEMPLATES_QUERY_KEY, "list", query] as const;
}
export function campaignTemplateDetailKey(id: string) {
  return [...CAMPAIGN_TEMPLATES_QUERY_KEY, "detail", id] as const;
}
export function campaignsListKey(query: Partial<ListCampaignsQuery>) {
  return [...CAMPAIGNS_QUERY_KEY, "list", query] as const;
}
export function campaignDetailKey(id: string) {
  return [...CAMPAIGNS_QUERY_KEY, "detail", id] as const;
}
export function campaignRecipientsKey(id: string, query: Partial<ListCampaignRecipientsQuery>) {
  return [...CAMPAIGNS_QUERY_KEY, "recipients", id, query] as const;
}
export function campaignMetricsKey(id: string) {
  return [...CAMPAIGNS_QUERY_KEY, "metrics", id] as const;
}

// ── Template helpers ───────────────────────────────────────────────────────────

function useInvalidateTemplates() {
  const queryClient = useQueryClient();
  return (templateId?: string) => {
    void queryClient.invalidateQueries({ queryKey: CAMPAIGN_TEMPLATES_QUERY_KEY });
    if (templateId) {
      void queryClient.invalidateQueries({ queryKey: campaignTemplateDetailKey(templateId) });
    }
  };
}

export function useCampaignTemplatesList(query: Partial<ListCampaignTemplatesQuery> = {}) {
  return useQuery({
    queryKey: campaignTemplatesListKey(query),
    queryFn: () => apiClient.engagement.campaigns.listTemplates(query),
    placeholderData: (prev) => prev,
  });
}

export function useCampaignTemplate(id: string | undefined) {
  return useQuery({
    queryKey: campaignTemplateDetailKey(id ?? ""),
    queryFn: () => apiClient.engagement.campaigns.getTemplate(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCampaignTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (body: CreateCampaignTemplateDto) =>
      apiClient.engagement.campaigns.createTemplate(body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateCampaignTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCampaignTemplateDto }) =>
      apiClient.engagement.campaigns.updateTemplate(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useDeleteCampaignTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.engagement.campaigns.deleteTemplate(id),
    onSuccess: () => invalidate(),
  });
}

// ── Campaign helpers ───────────────────────────────────────────────────────────

function useInvalidateCampaigns() {
  const queryClient = useQueryClient();
  return (campaignId?: string) => {
    void queryClient.invalidateQueries({ queryKey: CAMPAIGNS_QUERY_KEY });
    if (campaignId) {
      void queryClient.invalidateQueries({ queryKey: campaignDetailKey(campaignId) });
      void queryClient.invalidateQueries({ queryKey: campaignMetricsKey(campaignId) });
    }
  };
}

export function useCampaignsList(
  query: Partial<ListCampaignsQuery> & { status?: CampaignStatus; channel?: CampaignChannel } = {},
) {
  return useQuery({
    queryKey: campaignsListKey(query),
    queryFn: () => apiClient.engagement.campaigns.list(query),
    placeholderData: (prev) => prev,
  });
}

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: campaignDetailKey(id ?? ""),
    queryFn: () => apiClient.engagement.campaigns.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (body: CreateCampaignDto) =>
      apiClient.engagement.campaigns.create(body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCampaignDto }) =>
      apiClient.engagement.campaigns.update(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useDeleteCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (id: string) => apiClient.engagement.campaigns.delete(id),
    onSuccess: () => invalidate(),
  });
}

export function useSendCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (id: string) => apiClient.engagement.campaigns.send(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

export function usePauseCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (id: string) => apiClient.engagement.campaigns.pause(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

export function useCancelCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (id: string) => apiClient.engagement.campaigns.cancel(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

// ── Recipients + metrics (per-campaign) ───────────────────────────────────────

export function useCampaignRecipients(
  campaignId: string | undefined,
  query: Partial<ListCampaignRecipientsQuery> & { status?: RecipientStatus } = {},
) {
  return useQuery({
    queryKey: campaignRecipientsKey(campaignId ?? "", query),
    queryFn: () =>
      apiClient.engagement.campaigns.listRecipients(campaignId as string, query),
    enabled: Boolean(campaignId),
    placeholderData: (prev) => prev,
  });
}

export function useCampaignMetrics(campaignId: string | undefined) {
  return useQuery({
    queryKey: campaignMetricsKey(campaignId ?? ""),
    queryFn: () =>
      apiClient.engagement.campaigns.getMetrics(campaignId as string),
    enabled: Boolean(campaignId),
    // Refresh metrics every 30 seconds when window is focused (delivery receipts arrive via webhooks)
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
