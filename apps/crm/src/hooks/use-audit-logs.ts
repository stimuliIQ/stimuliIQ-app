// Audit logs data hook — read-only (docs/03 §7.16/§20(b)); no mutation API.
import { useQuery } from "@tanstack/react-query";
import type { ListAuditLogsQuery } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const AUDIT_LOGS_QUERY_KEY = ["audit-logs"] as const;

export function auditLogsListKey(query: ListAuditLogsQuery) {
  return [...AUDIT_LOGS_QUERY_KEY, "list", query] as const;
}

export function useAuditLogsList(query: ListAuditLogsQuery, enabled = true) {
  return useQuery({
    queryKey: auditLogsListKey(query),
    queryFn: () => apiClient.crm.audit.list(query),
    enabled,
    placeholderData: (previousData) => previousData,
  });
}
