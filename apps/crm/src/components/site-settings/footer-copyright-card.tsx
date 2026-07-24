// `footer.copyright_text` — the footer's copyright line template (`{year}` interpolated
// client-side at render time, never baked in server-side).
import * as React from "react";
import { Input } from "@repo/ui";
import { FooterCopyrightTextValueSchema, type FooterCopyrightTextValue } from "@repo/types";

import { SiteSettingCard } from "./site-setting-card";

export function FooterCopyrightCard({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  return (
    <SiteSettingCard
      title="Footer copyright text"
      description='Must contain the literal placeholder "{year}" — replaced with the current year at render time.'
      settingKey="footer.copyright_text"
      valueSchema={FooterCopyrightTextValueSchema}
      canEdit={canEdit}
      testId="site-setting-footer-copyright"
      renderFields={(form) => (
        <Input
          label="Template"
          required
          placeholder="© {year} stimuliiq. All rights reserved."
          {...form.register("value.template")}
          error={form.formState.errors.value?.template?.message}
          data-testid="footer-copyright-template"
        />
      )}
    />
  );
}

export type { FooterCopyrightTextValue };
