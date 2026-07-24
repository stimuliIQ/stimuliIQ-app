// Invoices hooks — list/detail/download. Invoices are server-generated async
// (BullMQ invoice-gen queue); there is no create/update mutation here.
// Phase 2 Wave 5a (docs/plans/phase-2.md task #7).
import { useQuery } from "@tanstack/react-query";
import type { ListInvoicesQuery } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const INVOICES_QUERY_KEY = ["commerce", "invoices"] as const;

export function invoicesListKey(query: ListInvoicesQuery) {
  return [...INVOICES_QUERY_KEY, "list", query] as const;
}

export function invoiceDetailKey(id: string) {
  return [...INVOICES_QUERY_KEY, "detail", id] as const;
}

export function invoiceDownloadKey(id: string) {
  return [...INVOICES_QUERY_KEY, "download", id] as const;
}

export function useInvoicesList(query: ListInvoicesQuery) {
  return useQuery({
    queryKey: invoicesListKey(query),
    queryFn: () => apiClient.commerce.invoices.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: invoiceDetailKey(id ?? ""),
    queryFn: () => apiClient.commerce.invoices.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Download URL — fetched on-demand (not eagerly with the detail) since it's a
 * pre-signed URL with a short TTL. `enabled` gates on an explicit request
 * (e.g. clicking "Download") via the `enabled` param passed by the caller.
 */
export function useInvoiceDownload(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: invoiceDownloadKey(id ?? ""),
    queryFn: () => apiClient.commerce.invoices.getDownloadUrl(id as string),
    enabled: Boolean(id) && enabled,
  });
}
