// `seo.defaults` — sitewide fallback SEO metadata.
import * as React from "react";
import { Input } from "@repo/ui";
import { SeoDefaultsValueSchema, type SeoDefaultsValue } from "@repo/types";

import { SiteSettingCard } from "./site-setting-card";

export function SeoDefaultsCard({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  return (
    <SiteSettingCard
      title="SEO defaults"
      description="Sitewide fallback SEO metadata, used when a page doesn't set its own."
      settingKey="seo.defaults"
      valueSchema={SeoDefaultsValueSchema}
      canEdit={canEdit}
      testId="site-setting-seo-defaults"
      renderFields={(form) => {
        const errors = form.formState.errors.value;
        return (
          <>
            <Input label="Site name" required {...form.register("value.siteName")} error={errors?.siteName?.message} data-testid="seo-defaults-site-name" />
            <Input label="Default description" required {...form.register("value.defaultDescription")} error={errors?.defaultDescription?.message} data-testid="seo-defaults-description" />
            <Input
              label="Social sharing image"
              required
              placeholder="/og/default.png"
              helperText="Shown when someone shares your site on WhatsApp, LinkedIn, etc. A path on your own site, e.g. /og/default.png."
              {...form.register("value.defaultOgImagePath")}
              error={errors?.defaultOgImagePath?.message}
              data-testid="seo-defaults-og-image-path"
            />
          </>
        );
      }}
    />
  );
}

export type { SeoDefaultsValue };
