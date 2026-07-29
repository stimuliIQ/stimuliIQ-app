// `announcement.bar` — the site-wide message strip shown above the website header.
// On/off toggle + message + display mode (fixed vs continuously scrolling) + optional link.
import * as React from "react";
import { Controller } from "react-hook-form";
import { Input, Label, Select, SelectItem, Switch, Textarea } from "@repo/ui";
import { AnnouncementBarValueSchema, type AnnouncementBarValue } from "@repo/types";

import { SiteSettingCard } from "./site-setting-card";

export function AnnouncementBarCard({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  return (
    <SiteSettingCard
      title="Announcement bar"
      description="An important message shown in a strip above the website's menu on every page. Turn it on only while you have something worth announcing."
      settingKey="announcement.bar"
      valueSchema={AnnouncementBarValueSchema}
      canEdit={canEdit}
      testId="site-setting-announcement-bar"
      renderFields={(form) => (
        <>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <Label id="announcement-bar-enabled-label">Show the announcement bar</Label>
              <p className="text-xs text-fg-muted">When off, the strip disappears from the website entirely.</p>
            </div>
            <Controller
              control={form.control}
              name="value.enabled"
              render={({ field }) => (
                <Switch
                  checked={Boolean(field.value)}
                  onCheckedChange={field.onChange}
                  disabled={!canEdit}
                  aria-labelledby="announcement-bar-enabled-label"
                  data-testid="announcement-bar-enabled"
                />
              )}
            />
          </div>

          <Textarea
            id="announcement-bar-message"
            label="Message"
            required
            rows={2}
            maxLength={300}
            helperText="Keep it to one sentence — this is a strip, not a page."
            {...form.register("value.message")}
            error={form.formState.errors.value?.message?.message as string | undefined}
            data-testid="announcement-bar-message"
          />

          <Controller
            control={form.control}
            name="value.mode"
            render={({ field }) => (
              <Select
                label="Display style"
                // `?? "static"` keeps this Radix Select CONTROLLED from the very first
                // render. `useSiteSettingForm` has no `defaultValues`, so `field.value` is
                // undefined until the fetched row arrives and `form.reset()` runs in an
                // effect — one render too late. A Radix Select that mounts with
                // `value={undefined}` is treated as uncontrolled and then ignores the value
                // it is handed afterwards, which is why the dropdown rendered blank even
                // though the stored value was "scroll".
                value={(field.value as "static" | "scroll" | undefined) ?? "static"}
                onValueChange={field.onChange}
                disabled={!canEdit}
                helperText='"Scrolling" moves the message continuously across the strip; "Fixed" shows it centered and still.'
                data-testid="announcement-bar-mode"
              >
                <SelectItem value="static">Fixed (message stays still)</SelectItem>
                <SelectItem value="scroll">Scrolling (continuous ticker)</SelectItem>
              </Select>
            )}
          />

          <Input
            id="announcement-bar-href"
            label="Link (optional)"
            placeholder="/scholarship"
            helperText="If set, clicking the message opens this page. Leave empty for plain text."
            {...form.register("value.href", { setValueAs: (v: string) => (typeof v === "string" && v.trim() === "" ? undefined : v) })}
            error={form.formState.errors.value?.href?.message as string | undefined}
            data-testid="announcement-bar-href"
          />
        </>
      )}
    />
  );
}

export type { AnnouncementBarValue };
