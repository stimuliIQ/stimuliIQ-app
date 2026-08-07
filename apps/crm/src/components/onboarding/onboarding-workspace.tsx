// Onboarding — the CRM screen behind stimuliiq.com/onboarding.
//
// Two tabs, because the screen answers two different questions that happen to share a
// subject:
//   Submissions — "what did students send us?" (the daily work)
//   Form fields — "what are we asking them?" (occasional, higher-privilege)
//
// The Form-fields tab is gated on `onboarding.fields.manage`, a different permission from
// the submission ones: a counsellor should work the intake queue without being able to
// quietly delete the payment-receipt question out of the live form. As always this is
// presentation only — the API guard is the real enforcement (lib/permissions.ts).
import * as React from "react";
import { ArrowDown, ArrowUp, ExternalLink, Paperclip, Plus, Trash2 } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectItem,
  StatusChip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@repo/ui";
import type { MeResponse, OnboardingField, OnboardingSubmissionStatus, OnboardingSubmissionSummary } from "@repo/types";

import {
  useDeleteOnboardingField,
  useDeleteOnboardingSubmission,
  useOnboardingFields,
  useOnboardingSubmissions,
  useReorderOnboardingFields,
} from "../../hooks/use-onboarding";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { onboardingFormDisplayUrl, onboardingFormUrl } from "../../lib/public-urls";
import { surfaceError } from "../../lib/surface-error";
import { OnboardingFieldDrawer } from "./onboarding-field-drawer";
import { OnboardingSubmissionDrawer, submissionStatusTone } from "./onboarding-submission-drawer";

const PAGE_SIZE = 25;

const STATUS_FILTERS: Array<{ value: OnboardingSubmissionStatus | "all"; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "new", label: "New" },
  { value: "in_review", label: "In review" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
];

const TYPE_LABELS: Record<string, string> = {
  text: "Short answer",
  textarea: "Paragraph",
  email: "Email",
  phone: "Phone",
  number: "Number",
  date: "Date",
  select: "Dropdown",
  radio: "Multiple choice",
  checkbox: "Checkbox",
  file: "File upload",
  program: "Program",
};

export function OnboardingWorkspace({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canEdit = hasPermission(me?.permissions, "onboarding.edit");
  const canDelete = hasPermission(me?.permissions, "onboarding.delete");
  const canManageFields = hasPermission(me?.permissions, "onboarding.fields.manage");

  return (
    <div className="space-y-4 md:space-y-5" data-testid="onboarding-workspace">
      <PageHeader
        title="Onboarding"
        description={
          <>
            Everything students submit through the onboarding form at{" "}
            <span className="font-medium text-fg">{onboardingFormDisplayUrl()}</span> — including their payment
            receipt. The Form fields tab controls exactly what that form asks.
          </>
        }
        actions={
          <a
            href={onboardingFormUrl()}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-500 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="onboarding-open-form"
          >
            Open the form
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        }
      />

      <Tabs defaultValue="submissions">
        <TabsList>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          {canManageFields ? <TabsTrigger value="fields">Form fields</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="submissions">
          <SubmissionsTab canEdit={canEdit} canDelete={canDelete} />
        </TabsContent>

        {canManageFields ? (
          <TabsContent value="fields">
            <FieldsTab />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

// ── Submissions ───────────────────────────────────────────────────────────

function SubmissionsTab({ canEdit, canDelete }: { canEdit: boolean; canDelete: boolean }): React.JSX.Element {
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<OnboardingSubmissionStatus | "all">("all");
  const [page, setPage] = React.useState(1);
  const debouncedSearch = useDebouncedValue(search);

  // Any filter change resets to page 1 — otherwise a narrowed result set lands the user on
  // a page that no longer exists and the table reads as empty.
  React.useEffect(() => setPage(1), [debouncedSearch, status]);

  const { data, isLoading, isError, refetch } = useOnboardingSubmissions({
    page,
    pageSize: PAGE_SIZE,
    ...(status !== "all" ? { status } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  });
  const deleteSubmission = useDeleteOnboardingSubmission();

  const [openId, setOpenId] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const columns: Array<DataTableColumn<OnboardingSubmissionSummary>> = [
    {
      id: "name",
      header: "Name",
      cell: (row) => (
        <span className="flex items-center gap-2">
          {row.fullName ?? <span className="text-fg-subtle">—</span>}
          {row.hasAttachment ? (
            <Paperclip className="size-3.5 text-fg-subtle" aria-label="Has an attachment" />
          ) : null}
        </span>
      ),
    },
    { id: "email", header: "Email", cell: (row) => row.email ?? "—" },
    { id: "phone", header: "Phone", cell: (row) => row.phone ?? "—" },
    { id: "program", header: "Program", cell: (row) => row.programTitle ?? "—" },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusChip tone={submissionStatusTone(row.status)} label={row.status.replace("_", " ")} size="sm" />,
    },
    { id: "submitted", header: "Submitted", cell: (row) => new Date(row.createdAt).toLocaleDateString() },
    {
      id: "actions",
      header: "Actions",
      cell: (row) =>
        canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteId(row.id);
            }}
            aria-label={`Delete submission from ${row.fullName ?? "unknown"}`}
            data-testid={`delete-onboarding-${row.id}`}
          >
            <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
          </Button>
        ) : null,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load submissions"
        data-testid="onboarding-submissions-error"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input
          aria-label="Search submissions"
          placeholder="Search by name, email or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          wrapperClassName="w-72"
          data-testid="onboarding-search-input"
        />
        <Select
          aria-label="Filter by status"
          value={status}
          onValueChange={(v) => setStatus(v as OnboardingSubmissionStatus | "all")}
          wrapperClassName="w-48"
          data-testid="onboarding-status-filter"
        >
          {STATUS_FILTERS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        onRowClick={(row) => setOpenId(row.id)}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.meta?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No submissions yet",
          description: "They'll appear here as soon as a student fills in the onboarding form.",
        }}
        caption="Onboarding submissions"
        data-testid="onboarding-submissions-table"
      />

      <OnboardingSubmissionDrawer
        submissionId={openId}
        onOpenChange={(open) => !open && setOpenId(null)}
        canEdit={canEdit}
      />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this submission?"
        description="It will be soft-deleted and hidden from this list. The uploaded receipt is kept."
        confirmLabel="Delete"
        tone="danger"
        loading={deleteSubmission.isPending}
        onConfirm={() => {
          if (!deleteId) return;
          deleteSubmission.mutate(deleteId, {
            onSuccess: () => {
              toast({ title: "Submission deleted", variant: "success" });
              setDeleteId(null);
            },
            onError: (error) => {
              surfaceError(toast, error, "Couldn't delete this submission");
              setDeleteId(null);
            },
          });
        }}
        data-testid="confirm-delete-onboarding-submission"
      />
    </div>
  );
}

// ── Form fields ───────────────────────────────────────────────────────────

function FieldsTab(): React.JSX.Element {
  const { toast } = useToast();
  const { data: fields, isLoading, isError, refetch } = useOnboardingFields();
  const reorderFields = useReorderOnboardingFields();
  const deleteField = useDeleteOnboardingField();

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<OnboardingField | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<OnboardingField | null>(null);

  /**
   * Move one question up or down. The endpoint takes the FULL ordered list rather than a
   * single (id, position) pair, because a partial write would leave the untouched rows at
   * stale positions and interleave them unpredictably with the moved one.
   */
  function move(index: number, direction: -1 | 1): void {
    if (!fields) return;
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    reorderFields.mutate(
      { fieldIds: next.map((field) => field.id) },
      { onError: (error) => surfaceError(toast, error, "Couldn't reorder the questions") },
    );
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load the form fields"
        data-testid="onboarding-fields-error"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const columns: Array<DataTableColumn<OnboardingField>> = [
    {
      id: "order",
      header: "Order",
      cell: (row) => {
        const index = (fields ?? []).findIndex((field) => field.id === row.id);
        return (
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={index <= 0 || reorderFields.isPending}
              onClick={(e) => {
                e.stopPropagation();
                move(index, -1);
              }}
              aria-label={`Move ${row.label} up`}
              data-testid={`onboarding-field-up-${row.key}`}
            >
              <ArrowUp className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={index < 0 || index >= (fields?.length ?? 0) - 1 || reorderFields.isPending}
              onClick={(e) => {
                e.stopPropagation();
                move(index, 1);
              }}
              aria-label={`Move ${row.label} down`}
              data-testid={`onboarding-field-down-${row.key}`}
            >
              <ArrowDown className="size-3.5" aria-hidden="true" />
            </Button>
          </span>
        );
      },
    },
    { id: "label", header: "Question", cell: (row) => row.label },
    { id: "key", header: "Key", cell: (row) => <code className="text-xs text-fg-muted">{row.key}</code> },
    { id: "type", header: "Type", cell: (row) => TYPE_LABELS[row.type] ?? row.type },
    { id: "required", header: "Required", cell: (row) => (row.required ? "Yes" : "No") },
    {
      id: "active",
      header: "On the form",
      cell: (row) => <StatusChip tone={row.active ? "success" : "neutral"} label={row.active ? "Shown" : "Hidden"} size="sm" />,
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(row);
          }}
          aria-label={`Delete ${row.label}`}
          data-testid={`delete-onboarding-field-${row.key}`}
        >
          <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-fg-muted">
          These are the questions students see, top to bottom. Edits go live immediately.
        </p>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          data-testid="onboarding-field-create"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add question
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={fields ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        onRowClick={(row) => {
          setEditing(row);
          setFormOpen(true);
        }}
        emptyState={{
          title: "No questions yet",
          description: "Add the first question and it will appear on the form straight away.",
        }}
        caption="Onboarding form fields"
        data-testid="onboarding-fields-table"
      />

      <OnboardingFieldDrawer open={formOpen} onOpenChange={setFormOpen} field={editing} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Remove "${deleteTarget?.label ?? ""}"?`}
        // Said plainly because it is the question staff will actually have: deleting a
        // question does NOT delete the answers already given to it — those are frozen
        // inside each submission.
        description="It stops being asked on the form. Answers already collected for it stay on the submissions that have them. To hide a question temporarily, edit it and turn off “Show on the form” instead."
        confirmLabel="Remove"
        tone="danger"
        loading={deleteField.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteField.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast({ title: "Question removed", variant: "success" });
              setDeleteTarget(null);
            },
            onError: (error) => {
              surfaceError(toast, error, "Couldn't remove this question");
              setDeleteTarget(null);
            },
          });
        }}
        data-testid="confirm-delete-onboarding-field"
      />
    </div>
  );
}
