// `contact.details` — the footer/contact-page blurb.
import * as React from "react";
import { Textarea } from "@repo/ui";
import { ContactDetailsValueSchema, type ContactDetailsValue } from "@repo/types";

import { SiteSettingCard } from "./site-setting-card";

export function ContactDetailsCard({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  return (
    <SiteSettingCard
      title="Contact details"
      description="The footer/contact-page blurb."
      settingKey="contact.details"
      valueSchema={ContactDetailsValueSchema}
      canEdit={canEdit}
      testId="site-setting-contact-details"
      renderFields={(form) => (
        <Textarea
          id="contact-details-text"
          label="Contact text"
          required
          rows={3}
          {...form.register("value.contactText")}
          error={form.formState.errors.value?.contactText?.message}
          data-testid="contact-details-text"
        />
      )}
    />
  );
}

export type { ContactDetailsValue };
