// `contact.whatsapp` — the WhatsApp float button's number + prefilled message.
import * as React from "react";
import { Input } from "@repo/ui";
import { ContactWhatsappValueSchema, type ContactWhatsappValue } from "@repo/types";

import { SiteSettingCard } from "./site-setting-card";

export function ContactWhatsappCard({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  return (
    <SiteSettingCard
      title="WhatsApp contact"
      description="The floating WhatsApp button's number + prefilled message."
      settingKey="contact.whatsapp"
      valueSchema={ContactWhatsappValueSchema}
      canEdit={canEdit}
      testId="site-setting-contact-whatsapp"
      renderFields={(form) => {
        const errors = form.formState.errors.value;
        return (
          <>
            <Input
              label="Number"
              required
              placeholder="919177748321"
              helperText="Country code + number, digits only, no spaces or +  — e.g. 919177748321."
              {...form.register("value.number")}
              error={errors?.number?.message}
              data-testid="contact-whatsapp-number"
            />
            <Input label="Prefilled message" required helperText="Plain text — do not URL-encode it. The website escapes it automatically." {...form.register("value.message")} error={errors?.message?.message} data-testid="contact-whatsapp-message" />
          </>
        );
      }}
    />
  );
}

export type { ContactWhatsappValue };
