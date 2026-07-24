// Lead-form config manager — CRUD over the field-config definitions the web
// app's lead-capture components render against. Phase 9 Completion T32/T40.
//
// GAP: same as landing pages — no CRM controller implements
// `/api/v1/crm/lead-forms` in apps/api yet; wired against the real SDK,
// 404s until backend-builder ships it.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, DataTable, type DataTableColumn, Drawer, DrawerContent, DrawerBody, DrawerFooter, EmptyState, Input, Select, SelectItem, StatusChip, useToast } from "@repo/ui";
import type { LeadForm, LeadFormField, LeadFormFieldType, MeResponse } from "@repo/types";

import { useCreateLeadForm, useLeadFormsList, useUpdateLeadForm } from "../../hooks/use-lead-forms";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

const FIELD_TYPES: LeadFormFieldType[] = ["text", "email", "phone", "select", "textarea", "checkbox"];

function LeadFormFormDrawer({
  open,
  onOpenChange,
  form,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: LeadForm | null;
}): React.JSX.Element {
  const { toast } = useToast();
  const createForm = useCreateLeadForm();
  const updateForm = useUpdateLeadForm();
  const isEdit = Boolean(form);

  const [key, setKey] = React.useState("");
  const [name, setName] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [fields, setFields] = React.useState<LeadFormField[]>([]);

  React.useEffect(() => {
    if (!open) return;
    setKey(form?.key ?? "");
    setName(form?.name ?? "");
    setActive(form?.active ?? true);
    setFields(form?.fields ?? [{ key: "name", label: "Name", type: "text", required: true }]);
  }, [open, form]);

  function updateField(index: number, patch: Partial<LeadFormField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }
  function addField() {
    setFields((prev) => [...prev, { key: "", label: "", type: "text", required: false }]);
  }
  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  const isPending = createForm.isPending || updateForm.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (isEdit && form) {
        await updateForm.mutateAsync({ id: form.id, body: { name, active, fields } });
        toast({ title: "Lead form updated", variant: "success" });
      } else {
        await createForm.mutateAsync({ key, name, active, fields });
        toast({ title: "Lead form created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this lead form");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center" title={isEdit ? "Edit lead form" : "New lead form"} size="lg" data-testid="lead-form-form-drawer">
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Name" required placeholder="e.g. MBA Landing Page Form" value={name} onChange={(e) => setName(e.target.value)} data-testid="lead-form-name-input" />
            <Input
              label="Key"
              required
              disabled={isEdit}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. mba-landing-form"
              helperText="Lowercase kebab-case, e.g. mba-landing-form"
              data-testid="lead-form-key-input"
            />

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-fg">Fields</h3>
              {fields.map((field, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2.5">
                  <Input label="Key" placeholder="e.g. email" value={field.key} onChange={(e) => updateField(index, { key: e.target.value })} wrapperClassName="w-32" data-testid={`lead-form-field-key-${index}`} />
                  <Input label="Label" placeholder="e.g. Email Address" value={field.label} onChange={(e) => updateField(index, { label: e.target.value })} wrapperClassName="w-40" data-testid={`lead-form-field-label-${index}`} />
                  <Select label="Type" placeholder="Select field type" value={field.type} onValueChange={(v) => updateField(index, { type: v as LeadFormFieldType })} wrapperClassName="w-36" data-testid={`lead-form-field-type-${index}`}>
                    {FIELD_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </Select>
                  <label className="inline-flex items-center gap-1.5 pb-2 text-sm text-fg-muted">
                    <input type="checkbox" checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} className="size-4 rounded-sm border border-border" />
                    Required
                  </label>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove field ${field.label || index + 1}`} onClick={() => removeField(index)} data-testid={`lead-form-field-remove-${index}`}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={addField} className="self-start" data-testid="lead-form-field-add">
                <Plus className="size-4" aria-hidden="true" />
                Add field
              </Button>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 rounded-sm border border-border" data-testid="lead-form-active-checkbox" />
              Active
            </label>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending} disabled={!name.trim() || (!isEdit && !key.trim())} data-testid="lead-form-form-submit">
              {isEdit ? "Save changes" : "Create"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

export function LeadFormManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canEdit = hasPermission(me?.permissions, "lead_forms.edit");
  const { data, isLoading, isError, refetch } = useLeadFormsList({ page: 1, pageSize: 100 });
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LeadForm | null>(null);

  const columns: Array<DataTableColumn<LeadForm>> = [
    { id: "name", header: "Name", cell: (row) => row.name },
    { id: "key", header: "Key", cell: (row) => row.key },
    { id: "fields", header: "Fields", cell: (row) => row.fields.length },
    { id: "active", header: "Status", cell: (row) => (row.active ? <StatusChip tone="success" label="Active" size="sm" /> : <StatusChip tone="neutral" label="Inactive" size="sm" />) },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load lead forms"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
        data-testid="lead-forms-error"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="lead-form-manager">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-fg">Lead Forms</h2>
          <p className="text-sm text-fg-muted">Field configs for embeddable lead-capture forms on the marketing site.</p>
        </div>
        {canEdit ? (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="lead-form-create-button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New form
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        onRowClick={
          canEdit
            ? (row) => {
                setEditing(row);
                setFormOpen(true);
              }
            : undefined
        }
        emptyState={{ title: "No lead forms yet", description: "Create your first embeddable lead form." }}
        caption="Lead forms"
        data-testid="lead-form-table"
      />

      <LeadFormFormDrawer open={formOpen} onOpenChange={setFormOpen} form={editing} />
    </div>
  );
}
