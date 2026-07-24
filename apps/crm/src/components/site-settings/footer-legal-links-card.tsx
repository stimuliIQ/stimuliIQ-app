// `footer.legal_links` — the compact legal-links row (privacy/terms/refund).
import * as React from "react";
import { FooterLegalLinksValueSchema, type FooterLegalLinksValue } from "@repo/types";

import { CompactLinkListField } from "./compact-link-list-field";
import { SiteSettingCard } from "./site-setting-card";

export function FooterLegalLinksCard({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  return (
    <SiteSettingCard
      title="Footer legal links"
      description="e.g. Privacy Policy, Terms, Refund Policy (up to 10)."
      settingKey="footer.legal_links"
      valueSchema={FooterLegalLinksValueSchema}
      canEdit={canEdit}
      testId="site-setting-footer-legal-links"
      renderFields={(form) => (
        <CompactLinkListField
          control={form.control}
          register={form.register}
          errors={form.formState.errors as never}
          name={"value" as never}
          max={10}
          ariaPrefix="Footer legal link"
        />
      )}
    />
  );
}

export type { FooterLegalLinksValue };
