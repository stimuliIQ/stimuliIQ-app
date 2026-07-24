// react-hook-form binding for one `SiteSetting` key — load, edit, save (docs/specs/
// phase-10-page-builder.md "Site Settings"). Wraps the raw per-key value (which may itself
// be an array, e.g. `nav.primary_links`) in `{ value: ... }` so a single react-hook-form
// instance works uniformly whether the underlying shape is an array or an object —
// `useFieldArray`/`register` both need a NAMED field path, not the form root itself.
// CLAUDE.md §3: this is the "no business logic in components" seam — components only call
// this hook and render fields, never touch the API client or zod directly.
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@repo/ui";
import type { SiteSettingKey } from "@repo/types";

import { useSiteSetting, useUpsertSiteSetting } from "./use-site-settings";
import { surfaceError } from "../lib/surface-error";

export function useSiteSettingForm<TValueSchema extends z.ZodTypeAny>(key: SiteSettingKey, valueSchema: TValueSchema) {
  const wrapperSchema = React.useMemo(() => z.object({ value: valueSchema }), [valueSchema]);
  type WrapperValues = z.input<typeof wrapperSchema>;

  const { data, isLoading, isError, refetch } = useSiteSetting(key);
  const upsert = useUpsertSiteSetting();
  const { toast } = useToast();

  const form = useForm<WrapperValues>({
    // `zodResolver`'s inferred generic can't precisely line up with `WrapperValues` when
    // `TValueSchema` is a generic type parameter (the resolver's own input/output types
    // are only fully resolved for a CONCRETE schema, not a generic one) — same "one
    // controlled `any`-adjacent seam" as block-card.tsx's per-block-type resolver; the
    // schema itself still fully validates every field, this only relaxes the wrapper
    // generic's TS view of the resolver's return type.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(wrapperSchema) as any,
  });

  React.useEffect(() => {
    if (data) form.reset({ value: data.value } as WrapperValues);
    // Only re-sync when a NEW server value arrives (e.g. after Save/refetch) — not on
    // every local edit, which would fight the user's in-progress typing.
  }, [data]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await upsert.mutateAsync({ key, body: { value: values.value } });
      toast({ title: "Saved", description: "Live on your website within about 5 minutes.", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this setting");
    }
  });

  return {
    form,
    isLoading,
    isError,
    refetch,
    onSubmit,
    isSaving: upsert.isPending,
  };
}
