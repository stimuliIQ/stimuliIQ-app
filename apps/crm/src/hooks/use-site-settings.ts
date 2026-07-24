// Phase-10 page builder — SiteSetting data hooks (docs/specs/phase-10-page-builder.md).
// `client.crm.siteSettings.*` (top-level, distinct permission domain from `content.*` —
// `site_settings.view`/`.edit`). Mirrors use-content.ts conventions.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListSiteSettingsQuery, SiteSettingKey, UpsertSiteSettingRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const SITE_SETTINGS_QUERY_KEY = ["site-settings"] as const;

export function useSiteSettingsList(query?: ListSiteSettingsQuery) {
  return useQuery({
    queryKey: [...SITE_SETTINGS_QUERY_KEY, "list", query ?? {}] as const,
    queryFn: () => apiClient.crm.siteSettings.list(query),
  });
}

export function useSiteSetting(key: SiteSettingKey | undefined) {
  return useQuery({
    queryKey: [...SITE_SETTINGS_QUERY_KEY, "detail", key ?? ""] as const,
    queryFn: () => apiClient.crm.siteSettings.get(key as SiteSettingKey),
    enabled: Boolean(key),
  });
}

export function useUpsertSiteSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body }: { key: SiteSettingKey; body: UpsertSiteSettingRequest }) => apiClient.crm.siteSettings.upsert(key, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SITE_SETTINGS_QUERY_KEY }),
  });
}
