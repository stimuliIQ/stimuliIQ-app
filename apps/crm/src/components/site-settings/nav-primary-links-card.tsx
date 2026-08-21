// `nav.primary_links` — the header's static nav link list (docs/specs/
// phase-10-page-builder.md "Site Settings").
import * as React from "react";
import { NavPrimaryLinksValueSchema, type NavPrimaryLinksValue } from "@repo/types";

import { CompactLinkListField } from "./compact-link-list-field";
import { SiteSettingCard } from "./site-setting-card";

export function NavPrimaryLinksCard({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  return (
    <SiteSettingCard
      title="Top menu links"
      description="The links shown in your website's header. 1 to 12 of them."
      settingKey="nav.primary_links"
      valueSchema={NavPrimaryLinksValueSchema}
      canEdit={canEdit}
      testId="site-setting-nav-primary-links"
      renderFields={(form) => (
        <CompactLinkListField
          control={form.control}
          register={form.register}
          errors={form.formState.errors as never}
          name={"value" as never}
          max={12}
          min={1}
          ariaPrefix="Top menu link"
        />
      )}
    />
  );
}

export type { NavPrimaryLinksValue };
