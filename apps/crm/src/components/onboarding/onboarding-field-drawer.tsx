// Create / edit one question on the onboarding form.
//
// This drawer is the whole "staff can change the form without a deploy" story, so two of
// its behaviours are deliberate and easy to mistake for oversights:
//
//   `key` is only editable on CREATE. It is the join key baked into every answer snapshot
//   already collected, so renaming it would detach historical answers from the question
//   that produced them. Editing shows it read-only, with the reason.
//
//   The choices box and the "Other" toggle only appear for select/radio. A `text` question
//   carrying orphaned choices is invisible-but-wrong data; the server drops them anyway, so
//   the form does not offer to create them.
import * as React from "react";
import { Button, Drawer, DrawerBody, DrawerContent, DrawerFooter, Input, Select, SelectItem, Switch, Textarea, useToast } from "@repo/ui";
import type { OnboardingField, OnboardingFieldType, OnboardingIdentityRole } from "@repo/types";
import { CHOICE_FIELD_TYPES } from "@repo/types";

import { useCreateOnboardingField, useUpdateOnboardingField } from "../../hooks/use-onboarding";
import { surfaceError } from "../../lib/surface-error";

const TYPE_OPTIONS: Array<{ value: OnboardingFieldType; label: string; hint: string }> = [
  { value: "text", label: "Short answer", hint: "One line of text." },
  { value: "textarea", label: "Paragraph", hint: "Multi-line text." },
  { value: "email", label: "Email", hint: "Validated as an email address." },
  { value: "phone", label: "Phone", hint: "Validated as a 10-digit mobile number." },
  { value: "number", label: "Number", hint: "Digits only." },
  { value: "date", label: "Date", hint: "A date picker." },
  { value: "select", label: "Dropdown", hint: "Pick one from a list you define." },
  { value: "radio", label: "Multiple choice", hint: "Pick one, shown as radio buttons." },
  { value: "checkbox", label: "Checkbox", hint: "A single yes/no tickbox." },
  { value: "file", label: "File upload", hint: "Image or PDF, up to 10 MB." },
  { value: "program", label: "Program", hint: "A dropdown filled automatically from your published programs." },
];

const IDENTITY_OPTIONS: Array<{ value: OnboardingIdentityRole; label: string }> = [
  { value: "none", label: "Don't use for a column" },
  { value: "name", label: "Use as the Name column" },
  { value: "email", label: "Use as the Email column" },
  { value: "phone", label: "Use as the Phone column" },
];

/**
 * Labelled switch row — the same label/description/switch markup program-form-drawer.tsx
 * uses, kept local because `Switch` (@repo/ui) is deliberately a bare control that takes
 * only `aria-label`.
 */
function SwitchRow({
  checked,
  onCheckedChange,
  label,
  description,
  testId,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  testId: string;
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-fg">{label}</span>
        {description ? <span className="text-xs text-fg-muted">{description}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} data-testid={testId} />
    </label>
  );
}

/** "Payment Receipt" → "payment_receipt" — a sane starting key staff can still edit. */
function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([^a-z])/, "f_$1")
    .slice(0, 60);
}

export interface OnboardingFieldDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: OnboardingField | null;
}

export function OnboardingFieldDrawer({ open, onOpenChange, field }: OnboardingFieldDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const createField = useCreateOnboardingField();
  const updateField = useUpdateOnboardingField();
  const isEdit = Boolean(field);

  const [label, setLabel] = React.useState("");
  const [key, setKey] = React.useState("");
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [helpText, setHelpText] = React.useState("");
  const [placeholder, setPlaceholder] = React.useState("");
  const [type, setType] = React.useState<OnboardingFieldType>("text");
  const [required, setRequired] = React.useState(false);
  const [optionsText, setOptionsText] = React.useState("");
  const [allowOther, setAllowOther] = React.useState(false);
  const [identityRole, setIdentityRole] = React.useState<OnboardingIdentityRole>("none");
  const [active, setActive] = React.useState(true);

  React.useEffect(() => {
    if (!open) return;
    setLabel(field?.label ?? "");
    setKey(field?.key ?? "");
    setKeyTouched(false);
    setHelpText(field?.helpText ?? "");
    setPlaceholder(field?.placeholder ?? "");
    setType(field?.type ?? "text");
    setRequired(field?.required ?? false);
    setOptionsText((field?.options ?? []).join("\n"));
    setAllowOther(field?.allowOther ?? false);
    setIdentityRole(field?.identityRole ?? "none");
    setActive(field?.active ?? true);
  }, [open, field]);

  const isChoice = (CHOICE_FIELD_TYPES as readonly string[]).includes(type);
  const options = optionsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const isPending = createField.isPending || updateField.isPending;
  const canSubmit = label.trim().length > 0 && (isEdit || key.trim().length > 0) && (!isChoice || options.length > 0);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const shared = {
      label: label.trim(),
      helpText: helpText.trim() ? helpText.trim() : null,
      placeholder: placeholder.trim() ? placeholder.trim() : null,
      type,
      required,
      options: isChoice ? options : null,
      allowOther: isChoice ? allowOther : false,
      identityRole,
      active,
    };
    try {
      if (isEdit && field) {
        await updateField.mutateAsync({ id: field.id, body: shared });
        toast({ title: "Question updated", variant: "success" });
      } else {
        // `sortOrder: 0` asks the server for "put it at the bottom" (see the service) —
        // a new question appearing above Name would never be what staff meant.
        await createField.mutateAsync({ ...shared, key: key.trim(), sortOrder: 0 });
        toast({ title: "Question added", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this question");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={isEdit ? "Edit question" : "New question"} size="md" data-testid="onboarding-field-drawer">
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input
              label="Question"
              required
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                // Auto-derive the key until staff type their own — then stop, so an edit
                // to the wording never silently rewrites a key they chose deliberately.
                if (!isEdit && !keyTouched) setKey(slugifyKey(e.target.value));
              }}
              placeholder="e.g. Payment Receipt"
              data-testid="onboarding-field-label"
            />

            <Input
              label="Field key"
              // Only mandatory on create — on edit the key is frozen (answers are stored
              // against it), so the field is disabled rather than required.
              required={!isEdit}
              value={key}
              disabled={isEdit}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(e.target.value);
              }}
              helperText={
                isEdit
                  ? "The key can't change. Every answer already collected is stored against it. Edit the question wording above instead."
                  : "Lowercase letters, numbers and underscores. Used to store answers; can't be changed later."
              }
              data-testid="onboarding-field-key"
            />

            <Select label="Answer type" required value={type} onValueChange={(v) => setType(v as OnboardingFieldType)} data-testid="onboarding-field-type">
              {TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>
            <p className="-mt-2 text-xs text-fg-subtle">{TYPE_OPTIONS.find((o) => o.value === type)?.hint}</p>

            {isChoice ? (
              <>
                <Textarea
                  label="Choices"
                  required
                  rows={4}
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  helperText="One choice per line."
                  placeholder={"September\nOctober\nNovember\nDecember"}
                  data-testid="onboarding-field-options"
                />
                <SwitchRow
                  checked={allowOther}
                  onCheckedChange={setAllowOther}
                  label='Allow an "Other" answer'
                  description="Adds a free-text option at the bottom of the list."
                  testId="onboarding-field-allow-other"
                />
              </>
            ) : null}

            <Textarea
              label="Help text (optional)"
              rows={2}
              value={helpText}
              onChange={(e) => setHelpText(e.target.value)}
              helperText="Shown in grey under the question."
              data-testid="onboarding-field-help"
            />

            <Input
              label="Placeholder (optional)"
              value={placeholder}
              onChange={(e) => setPlaceholder(e.target.value)}
              helperText="Faint hint text inside the answer box."
              data-testid="onboarding-field-placeholder"
            />

            <Select
              label="Submissions list column"
              value={identityRole}
              onValueChange={(v) => setIdentityRole(v as OnboardingIdentityRole)}
              helperText="Feeds the Name / Email / Phone column on the submissions list. Choosing one moves it off whichever question holds it now."
              data-testid="onboarding-field-identity"
            >
              {IDENTITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>

            <SwitchRow checked={required} onCheckedChange={setRequired} label="Required" testId="onboarding-field-required" />
            <SwitchRow
              checked={active}
              onCheckedChange={setActive}
              label="Show on the form"
              description="Turn off to hide the question without deleting it. Answers already collected are kept either way."
              testId="onboarding-field-active"
            />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending} disabled={!canSubmit} data-testid="onboarding-field-submit">
              {isEdit ? "Save changes" : "Add question"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
