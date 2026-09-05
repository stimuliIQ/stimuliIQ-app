// The automatic transactional emails — read, edit, preview, reset.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EmailTemplateKey, UpdateEmailTemplateRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const EMAIL_TEMPLATES_QUERY_KEY = ["email-templates"] as const;

export function useEmailTemplates() {
  return useQuery({
    queryKey: [...EMAIL_TEMPLATES_QUERY_KEY, "list"] as const,
    queryFn: () => apiClient.crm.emailTemplates.list(),
  });
}

/**
 * The rendered email.
 *
 * Not cached: the whole point is to show what the CURRENT text produces, so a preview held
 * from before a save would show the reader the previous wording and quietly contradict the
 * form beside it.
 */
export function useEmailTemplatePreview(key: EmailTemplateKey | null) {
  return useQuery({
    queryKey: [...EMAIL_TEMPLATES_QUERY_KEY, "preview", key ?? ""] as const,
    queryFn: () => apiClient.crm.emailTemplates.preview(key as EmailTemplateKey),
    enabled: Boolean(key),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

function useInvalidateEmailTemplates() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: EMAIL_TEMPLATES_QUERY_KEY });
}

export function useUpdateEmailTemplate() {
  const invalidate = useInvalidateEmailTemplates();
  return useMutation({
    mutationFn: ({ key, body }: { key: EmailTemplateKey; body: UpdateEmailTemplateRequest }) =>
      apiClient.crm.emailTemplates.update(key, body),
    onSuccess: invalidate,
  });
}

/** Discards the override so the shipped wording takes over again. */
export function useResetEmailTemplate() {
  const invalidate = useInvalidateEmailTemplates();
  return useMutation({
    mutationFn: (key: EmailTemplateKey) => apiClient.crm.emailTemplates.reset(key),
    onSuccess: invalidate,
  });
}
