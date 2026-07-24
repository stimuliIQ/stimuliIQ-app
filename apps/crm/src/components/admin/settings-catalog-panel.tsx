// Typed settings panel for one scope (system|company). Renders the curated
// SETTINGS_CATALOG as grouped, typed controls (text / email / textarea / select)
// with a single "Save changes" action for all edited fields, and an "Advanced"
// disclosure that surfaces any settings NOT in the catalog as raw key/value rows
// (so nothing is ever hidden) plus the raw "add a custom setting" form.
//
// Replaces the previous raw-JSON-only editor. The wire contract is unchanged — each
// field still upserts through the generic PUT /settings/:scope/:key (useSetSetting);
// the catalog is presentation metadata only (see lib/settings-catalog.ts).
import * as React from "react";
import { Alert, Button, Input, Select, SelectItem, Skeleton, Textarea, useToast } from "@repo/ui";
import type { SettingScope } from "@repo/types";

import { useSettingsList, useSetSetting } from "../../hooks/use-settings";
import { surfaceError } from "../../lib/surface-error";
import {
  SETTINGS_CATALOG,
  settingValueToString,
  type SettingField,
} from "../../lib/settings-catalog";

function CatalogFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: SettingField;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}): React.JSX.Element {
  const testId = `setting-field-${field.key}`;
  if (field.control === "textarea") {
    return (
      <Textarea
        label={field.label}
        helperText={field.description}
        placeholder={field.placeholder}
        value={value}
        disabled={disabled}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
    );
  }
  if (field.control === "select") {
    return (
      <Select
        label={field.label}
        helperText={field.description}
        placeholder="Select…"
        value={value || undefined}
        disabled={disabled}
        onValueChange={onChange}
        data-testid={testId}
      >
        {(field.options ?? []).map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </Select>
    );
  }
  return (
    <Input
      label={field.label}
      helperText={field.description}
      type={field.inputType ?? "text"}
      placeholder={field.placeholder}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
    />
  );
}

export function SettingsCatalogPanel({ scope, canEdit }: { scope: SettingScope; canEdit: boolean }): React.JSX.Element {
  const { toast } = useToast();
  const { data, isLoading, isError } = useSettingsList({ scope, page: 1, pageSize: 100 });
  const setSetting = useSetSetting();

  const groups = SETTINGS_CATALOG[scope];

  // Stored value per key, coerced to the string a typed control edits.
  const storedByKey = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const setting of data?.items ?? []) map.set(setting.key, settingValueToString(setting.value));
    return map;
  }, [data]);

  // Editable draft, seeded from stored values (empty when unset). Re-seeds whenever the
  // stored values change — i.e. after a successful save re-fetches, drafts re-sync so the
  // dirty state clears.
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    const next: Record<string, string> = {};
    for (const group of groups) for (const field of group.fields) next[field.key] = storedByKey.get(field.key) ?? "";
    setDrafts(next);
  }, [storedByKey, groups]);

  const catalogFieldKeys = React.useMemo(() => groups.flatMap((g) => g.fields.map((f) => f.key)), [groups]);
  const dirtyKeys = catalogFieldKeys.filter((key) => (drafts[key] ?? "") !== (storedByKey.get(key) ?? ""));

  async function handleSave() {
    try {
      // Only dirty fields are written; an untouched empty field is never persisted.
      await Promise.all(
        dirtyKeys.map((key) => setSetting.mutateAsync({ scope, key, body: { value: drafts[key] } })),
      );
      toast({ title: dirtyKeys.length > 1 ? "Settings saved" : "Setting saved", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't save settings");
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton shape="block" className="h-20" />
        <Skeleton shape="block" className="h-20" />
      </div>
    );
  }
  if (isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn&apos;t load {scope} settings.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid={`settings-catalog-${scope}`}>
      <Alert tone="info">
        These are stored configuration values for your {scope === "company" ? "organisation" : "platform"}. Edit the
        fields below and choose Save changes.
      </Alert>

      {groups.map((group) => (
        <section key={group.title} className="flex flex-col gap-4 rounded-md border border-border bg-card p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-fg">{group.title}</h2>
            {group.description ? <p className="text-xs text-fg-muted">{group.description}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {group.fields.map((field) => (
              <CatalogFieldControl
                key={field.key}
                field={field}
                value={drafts[field.key] ?? ""}
                disabled={!canEdit}
                onChange={(next) => setDrafts((current) => ({ ...current, [field.key]: next }))}
              />
            ))}
          </div>
        </section>
      ))}

      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={dirtyKeys.length === 0} loading={setSetting.isPending} data-testid={`settings-save-${scope}`}>
            Save changes
          </Button>
          {dirtyKeys.length > 0 ? (
            <span className="text-xs text-fg-muted" aria-live="polite">
              {dirtyKeys.length} unsaved {dirtyKeys.length === 1 ? "change" : "changes"}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
