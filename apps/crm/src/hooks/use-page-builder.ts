// Page builder data hooks — CRM builder-managed pages. Originally Phase-10 (docs/specs/
// phase-10-page-builder.md), now backing the Phase-11 locked-template editor
// (docs/plans/phase-11-locked-templates.md P4: no more ad-hoc page creation — every
// builder-managed row is one of the 6 seeded core-template pages, see @repo/types
// page-templates.schemas.ts). Mirrors use-content.ts conventions (CLAUDE.md §3: no
// business logic in components). `client.crm.content.pages.*` — never a hand-written
// fetch.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ContentPageBuilderDetail,
  ContentPageSummary,
  ListContentPageVersionsQuery,
  PreviewBuilderPageRequest,
  RevertContentPageVersionRequest,
  SaveBuilderPageRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const BUILDER_PAGES_QUERY_KEY = ["content", "pages", "builder"] as const;

/** The builder's own page directory — filtered to `isBuilderManaged: true` rows only, so
 *  legacy generic-CMS pages never show up here (Out of scope: this UI never edits those). */
export function useBuilderPagesList(search?: string) {
  return useQuery({
    queryKey: [...BUILDER_PAGES_QUERY_KEY, "list", search ?? ""] as const,
    queryFn: () =>
      apiClient.crm.content.pages.list({
        isBuilderManaged: true,
        page: 1,
        pageSize: 100,
        ...(search ? { search } : {}),
      }),
    placeholderData: (previousData) => previousData,
  });
}

function invalidateBuilderPages(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: BUILDER_PAGES_QUERY_KEY });
}

/** Full row (incl. `body`) for the editor's initial load — generic `ContentPageDetail`
 *  projection; builder rows always satisfy `PageBuilderBlockSchema` server-side, this just
 *  isn't reflected in the generic GET's TS type (see page-builder-editor.tsx cast comment). */
export function useContentPageDetail(id: string | undefined) {
  return useQuery({
    queryKey: [...BUILDER_PAGES_QUERY_KEY, "detail", id ?? ""] as const,
    queryFn: () => apiClient.crm.content.pages.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Newest-first, 1 item — used ONLY to infer `currentVersion` on initial editor load (the
 * generic detail GET doesn't carry it; see pages.schemas.ts comment: "currentVersion == the
 * count of version rows so far" == the newest version row's own `.version` number, 0 if the
 * page was never saved through the builder yet).
 */
export function useLatestContentPageVersion(id: string | undefined) {
  return useQuery({
    queryKey: [...BUILDER_PAGES_QUERY_KEY, "latest-version", id ?? ""] as const,
    queryFn: () => apiClient.crm.content.pages.listVersions(id as string, { page: 1, pageSize: 1 }),
    enabled: Boolean(id),
  });
}

export function useSaveBuilderPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SaveBuilderPageRequest }) => apiClient.crm.content.pages.saveBuilderPage(id, body),
    onSuccess: (_data, variables) => {
      invalidateBuilderPages(queryClient);
      void queryClient.invalidateQueries({ queryKey: [...BUILDER_PAGES_QUERY_KEY, "detail", variables.id] });
      void queryClient.invalidateQueries({ queryKey: [...BUILDER_PAGES_QUERY_KEY, "versions", variables.id] });
    },
  });
}

/** Read-only, unsaved-edit preview (AC 4) — no cache entry, always a fresh call. */
export function usePreviewBuilderPage() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PreviewBuilderPageRequest }) => apiClient.crm.content.pages.previewBuilderPage(id, body),
  });
}

export function useContentPageVersionsList(id: string | undefined, query: ListContentPageVersionsQuery) {
  return useQuery({
    queryKey: [...BUILDER_PAGES_QUERY_KEY, "versions", id ?? "", query] as const,
    queryFn: () => apiClient.crm.content.pages.listVersions(id as string, query),
    enabled: Boolean(id),
    placeholderData: (previousData) => previousData,
  });
}

export function useContentPageVersion(id: string | undefined, version: number | undefined) {
  return useQuery({
    queryKey: [...BUILDER_PAGES_QUERY_KEY, "version-detail", id ?? "", version ?? 0] as const,
    queryFn: () => apiClient.crm.content.pages.getVersion(id as string, version as number),
    enabled: Boolean(id) && typeof version === "number",
  });
}

export function useRevertContentPageVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version, body }: { id: string; version: number; body: RevertContentPageVersionRequest }) =>
      apiClient.crm.content.pages.revertToVersion(id, version, body),
    onSuccess: (_data, variables) => {
      invalidateBuilderPages(queryClient);
      void queryClient.invalidateQueries({ queryKey: [...BUILDER_PAGES_QUERY_KEY, "detail", variables.id] });
      void queryClient.invalidateQueries({ queryKey: [...BUILDER_PAGES_QUERY_KEY, "versions", variables.id] });
    },
  });
}

export type { ContentPageBuilderDetail, ContentPageSummary };
