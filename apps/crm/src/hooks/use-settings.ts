// Settings data hooks (admin, system+company scope) — Phase 9 Completion T23/T39.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListSettingsQuery, SetSettingRequest, SettingScope } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const SETTINGS_QUERY_KEY = ["settings"] as const;

export function settingsListKey(query: ListSettingsQuery) {
  return [...SETTINGS_QUERY_KEY, "list", query] as const;
}

export function useSettingsList(query: ListSettingsQuery) {
  return useQuery({
    queryKey: settingsListKey(query),
    queryFn: () => apiClient.crm.settings.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useSetSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scope, key, body }: { scope: SettingScope; key: string; body: SetSettingRequest }) =>
      apiClient.crm.settings.set(scope, key, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
  });
}
