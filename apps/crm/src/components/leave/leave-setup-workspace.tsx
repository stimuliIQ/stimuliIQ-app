// Leave setup — super admin only. Three tabs, because these are three different jobs done
// on three different clocks: the leave TYPES are set up once and rarely touched, the
// ALLOWANCES are revisited every January, and the HOLIDAYS are entered a year at a time.
//
// The allowances tab saves the WHOLE YEAR in one go rather than a row at a time. A per-row
// save would leave a half-applied year behind on the first network failure, with nobody able
// to tell which half — and the allowance is what everybody's balance is measured against.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  Input,
  PageHeader,
  StatusChip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
} from "@repo/ui";
import type { Holiday, LeaveType } from "@repo/types";

import {
  useCreateHoliday,
  useCreateLeaveType,
  useDeleteHoliday,
  useDeleteLeaveType,
  useHolidays,
  useLeaveQuotas,
  useLeaveSettings,
  useLeaveTypes,
  useSaveLeaveQuotas,
  useUpdateLeaveSettings,
  useUpdateLeaveType,
} from "../../hooks/use-leave";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";
import { CheckboxField } from "./checkbox-field";

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

/** The current year and the next two — the only years anybody sets an allowance for. */
function yearOptions(): number[] {
  const now = new Date().getUTCFullYear();
  return [now - 1, now, now + 1];
}

function slugifyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// ── Leave types ───────────────────────────────────────────────────────────

function LeaveTypeDrawer({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: LeaveType | null;
}): React.JSX.Element {
  const { toast } = useToast();
  const create = useCreateLeaveType();
  const update = useUpdateLeaveType();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [paid, setPaid] = React.useState(true);
  const [allowHalfDay, setAllowHalfDay] = React.useState(true);
  const [active, setActive] = React.useState(true);

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setPaid(editing?.paid ?? true);
    setAllowHalfDay(editing?.allowHalfDay ?? true);
    setActive(editing?.active ?? true);
  }, [open, editing]);

  async function onSave(): Promise<void> {
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          body: { name, description: description || null, paid, allowHalfDay, active },
        });
      } else {
        await create.mutateAsync({
          // The key is derived from the name and never editable afterwards: it is what the
          // seed and any future report join on, so it must not move when somebody rewords
          // the label.
          key: slugifyKey(name),
          name,
          description: description || null,
          paid,
          allowHalfDay,
          active,
          sortOrder: 0,
        });
      }
      toast({ title: editing ? "Leave type updated" : "Leave type added", variant: "success" });
      onOpenChange(false);
    } catch (err) {
      surfaceError(toast, err, "Couldn't save this leave type");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={editing ? `Edit ${editing.name}` : "Add a leave type"}
        description="Leave types are what staff pick from on the apply form."
        data-testid="leave-type-drawer"
      >
        <DrawerBody>
          <div className="space-y-4">
            <Input
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Casual Leave"
              data-testid="leave-type-name"
            />
            <Textarea
              label="Description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              helperText="Shown to staff on the apply form. Optional."
              data-testid="leave-type-description"
            />
            <CheckboxField
              checked={paid}
              onCheckedChange={setPaid}
              label="Counts against a yearly allowance"
              helperText="Switch this off for unpaid leave, which is never refused on balance."
              data-testid="leave-type-paid"
            />
            <CheckboxField
              checked={allowHalfDay}
              onCheckedChange={setAllowHalfDay}
              label="Can be taken as a half day"
              data-testid="leave-type-half-day"
            />
            <CheckboxField
              checked={active}
              onCheckedChange={setActive}
              label="Available on the apply form"
              helperText="Switching this off hides it from new requests. Past leave keeps its label."
              data-testid="leave-type-active"
            />
          </div>
        </DrawerBody>
        <DrawerFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
            loading={create.isPending || update.isPending}
            disabled={name.trim().length === 0}
            data-testid="leave-type-save"
          >
            Save
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function LeaveTypesTab(): React.JSX.Element {
  const { toast } = useToast();
  const typesQuery = useLeaveTypes(false);
  const remove = useDeleteLeaveType();

  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LeaveType | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<LeaveType | null>(null);

  const columns: Array<DataTableColumn<LeaveType>> = [
    {
      id: "name",
      header: "Name",
      cell: (row) => (
        <button
          type="button"
          className="text-left font-medium text-brand-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setEditing(row);
            setDrawerOpen(true);
          }}
        >
          {row.name}
        </button>
      ),
    },
    { id: "paid", header: "Allowance", cell: (row) => (row.paid ? "Counted" : "Not counted") },
    { id: "half", header: "Half days", cell: (row) => (row.allowHalfDay ? "Allowed" : "Whole days only") },
    {
      id: "active",
      header: "On the form",
      cell: (row) => (
        <StatusChip tone={row.active ? "success" : "neutral"} label={row.active ? "Yes" : "Hidden"} />
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDeleteTarget(row)}
          aria-label={`Delete ${row.name}`}
          data-testid={`leave-type-delete-${row.id}`}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setDrawerOpen(true);
          }}
          data-testid="leave-type-add"
        >
          <Plus className="mr-1.5 size-4" aria-hidden="true" />
          Add a leave type
        </Button>
      </div>

      {typesQuery.isError ? (
        <Alert tone="danger" title="Couldn't load the leave types">
          {queryErrorMessage(typesQuery.error, "Something went wrong fetching the leave types.")}
        </Alert>
      ) : null}

      <DataTable
        rows={typesQuery.data ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        loading={typesQuery.isLoading}
        caption="Leave types"
        emptyState={{
          title: "No leave types yet",
          description: "Add Casual, Sick and Earned leave to get started.",
        }}
        data-testid="leave-types-table"
      />

      <LeaveTypeDrawer open={drawerOpen} onOpenChange={setDrawerOpen} editing={editing} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? "this leave type"}?`}
        // Says what will actually happen, including the case where it is refused. A type
        // anybody has used cannot be deleted — hiding it is what the person wants there.
        description="If anyone has ever applied for this type, deleting is refused so their history stays readable. Switch it off on the form instead."
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await remove.mutateAsync(deleteTarget.id);
            toast({ title: "Leave type deleted", variant: "success" });
            setDeleteTarget(null);
          } catch (err) {
            surfaceError(toast, err, "Couldn't delete this leave type");
          }
        }}
      />
    </div>
  );
}

// ── Allowances ────────────────────────────────────────────────────────────

function AllowancesTab(): React.JSX.Element {
  const { toast } = useToast();
  const [year, setYear] = React.useState(() => new Date().getUTCFullYear());

  const typesQuery = useLeaveTypes(false);
  const quotasQuery = useLeaveQuotas(year);
  const save = useSaveLeaveQuotas();

  const [draft, setDraft] = React.useState<Record<string, string>>({});

  // Re-seeded whenever the year or the saved data changes, so switching years never carries
  // last year's unsaved numbers across.
  React.useEffect(() => {
    const next: Record<string, string> = {};
    for (const quota of quotasQuery.data ?? []) next[quota.leaveTypeId] = String(quota.days);
    setDraft(next);
  }, [quotasQuery.data, year]);

  const paidTypes = (typesQuery.data ?? []).filter((type) => type.paid);

  async function onSave(): Promise<void> {
    const allocations = paidTypes
      .map((type) => ({ leaveTypeId: type.id, days: Number(draft[type.id] ?? "") }))
      .filter((entry) => Number.isFinite(entry.days) && entry.days >= 0);

    try {
      await save.mutateAsync({ year, allocations });
      toast({ title: `${year} allowances saved`, variant: "success" });
    } catch (err) {
      surfaceError(toast, err, "Couldn't save the allowances");
    }
  }

  return (
    <div className="space-y-4">
      <Alert tone="info">
        These are the days each member of staff gets per year. Changing an allowance mid-year
        changes what everyone has left immediately. It does not affect leave already approved.
      </Alert>

      <div className="flex flex-wrap items-end gap-3">
        {yearOptions().map((option) => (
          <Button
            key={option}
            variant={option === year ? "primary" : "secondary"}
            size="sm"
            onClick={() => setYear(option)}
            aria-pressed={option === year}
            data-testid={`leave-year-${option}`}
          >
            {option}
          </Button>
        ))}
      </div>

      {typesQuery.isError || quotasQuery.isError ? (
        // Never fall through to "there are no leave types yet" on a failed load: that reads
        // as a fact about the data and invites an admin to re-create allowances that exist.
        <Alert tone="danger" title="Couldn't load the allowances">
          {queryErrorMessage(
            typesQuery.error ?? quotasQuery.error,
            "Something went wrong fetching this year's allowances.",
          )}
        </Alert>
      ) : paidTypes.length === 0 ? (
        <Alert tone="warning">
          There are no leave types with an allowance yet. Add one on the Leave types tab first.
        </Alert>
      ) : (
        <div className="space-y-3" data-testid="leave-allowances">
          {paidTypes.map((type) => (
            <div key={type.id} className="flex flex-wrap items-end gap-3">
              <Input
                label={type.name}
                type="number"
                min={0}
                max={365}
                step={0.5}
                value={draft[type.id] ?? ""}
                onChange={(event) => setDraft((prev) => ({ ...prev, [type.id]: event.target.value }))}
                helperText={type.allowHalfDay ? "Days per year, halves allowed." : "Days per year."}
                wrapperClassName="w-56"
                data-testid={`leave-allowance-${type.id}`}
              />
            </div>
          ))}

          <Button onClick={onSave} loading={save.isPending} data-testid="leave-allowances-save">
            Save {year} allowances
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Holidays and the working week ─────────────────────────────────────────

function HolidaysTab(): React.JSX.Element {
  const { toast } = useToast();
  const [year, setYear] = React.useState(() => new Date().getUTCFullYear());

  const holidaysQuery = useHolidays(year);
  const settingsQuery = useLeaveSettings();
  const createHoliday = useCreateHoliday();
  const deleteHoliday = useDeleteHoliday();
  const updateSettings = useUpdateLeaveSettings();

  const [date, setDate] = React.useState("");
  const [name, setName] = React.useState("");
  const [optional, setOptional] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<Holiday | null>(null);

  const weeklyOffs = settingsQuery.data?.weeklyOffDays ?? [];

  async function onAdd(): Promise<void> {
    try {
      await createHoliday.mutateAsync({ date, name, description: null, optional });
      toast({ title: "Holiday added", variant: "success" });
      setDate("");
      setName("");
      setOptional(false);
    } catch (err) {
      surfaceError(toast, err, "Couldn't add this holiday");
    }
  }

  async function toggleWeeklyOff(day: number, checked: boolean): Promise<void> {
    const next = checked ? [...weeklyOffs, day] : weeklyOffs.filter((d) => d !== day);
    try {
      await updateSettings.mutateAsync({ weeklyOffDays: next });
    } catch (err) {
      surfaceError(toast, err, "Couldn't save the working week");
    }
  }

  const columns: Array<DataTableColumn<Holiday>> = [
    { id: "date", header: "Date", cell: (row) => row.date },
    { id: "name", header: "Holiday", cell: (row) => <span className="font-medium text-fg">{row.name}</span> },
    {
      id: "optional",
      header: "Type",
      cell: (row) => (
        <StatusChip
          tone={row.optional ? "warning" : "neutral"}
          label={row.optional ? "Optional, still a working day" : "Company holiday"}
        />
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDeleteTarget(row)}
          aria-label={`Delete ${row.name}`}
          data-testid={`holiday-delete-${row.id}`}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg">Working week</h2>
        <p className="text-sm text-fg-muted">
          Days nobody is expected in. They&apos;re shaded on the calendar and never counted as leave.
        </p>
        <div className="flex flex-wrap gap-4" data-testid="leave-weekly-offs">
          {WEEKDAYS.map((day) => (
            <CheckboxField
              key={day.value}
              checked={weeklyOffs.includes(day.value)}
              onCheckedChange={(value) => void toggleWeeklyOff(day.value, value)}
              label={day.label}
              data-testid={`weekly-off-${day.value}`}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg">Holidays</h2>

        <div className="flex flex-wrap items-end gap-3">
          {yearOptions().map((option) => (
            <Button
              key={option}
              variant={option === year ? "primary" : "secondary"}
              size="sm"
              onClick={() => setYear(option)}
              aria-pressed={option === year}
              data-testid={`holiday-year-${option}`}
            >
              {option}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            wrapperClassName="w-44"
            data-testid="holiday-date"
          />
          <Input
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Diwali"
            wrapperClassName="w-64"
            data-testid="holiday-name"
          />
          <CheckboxField
            checked={optional}
            onCheckedChange={setOptional}
            label="Optional"
            helperText="Shown on the calendar, but still costs a day if taken."
            data-testid="holiday-optional"
          />
          <Button
            onClick={onAdd}
            loading={createHoliday.isPending}
            disabled={!date || name.trim().length === 0}
            data-testid="holiday-add"
          >
            <Plus className="mr-1.5 size-4" aria-hidden="true" />
            Add
          </Button>
        </div>

        {holidaysQuery.isError ? (
          <Alert tone="danger" title="Couldn't load the holiday list">
            {queryErrorMessage(holidaysQuery.error, "Something went wrong fetching this year's holidays.")}
          </Alert>
        ) : null}

        <DataTable
          rows={holidaysQuery.data ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          loading={holidaysQuery.isLoading}
          caption={`Holidays in ${year}`}
          emptyState={{
            title: `No holidays set for ${year}`,
            description: "Add them here so leave across a holiday doesn't cost anyone a day.",
          }}
          data-testid="holidays-table"
        />
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? "this holiday"}?`}
        // Stated because the opposite is a reasonable thing to assume: leave already approved
        // across this date keeps the length it was agreed at.
        description="Leave already approved across this date keeps the length it was approved at. Only future requests are affected."
        confirmLabel="Delete"
        tone="danger"
        loading={deleteHoliday.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteHoliday.mutateAsync(deleteTarget.id);
            toast({ title: "Holiday deleted", variant: "success" });
            setDeleteTarget(null);
          } catch (err) {
            surfaceError(toast, err, "Couldn't delete this holiday");
          }
        }}
      />
    </div>
  );
}

export function LeaveSetupWorkspace(): React.JSX.Element {
  return (
    <div className="space-y-4 md:space-y-5" data-testid="leave-setup-workspace">
      <PageHeader
        title="Leave setup"
        description="The leave types staff can pick, what each one is worth per year, and the company calendar."
      />

      <Tabs defaultValue="allowances">
        <TabsList>
          <TabsTrigger value="allowances">Allowances</TabsTrigger>
          <TabsTrigger value="types">Leave types</TabsTrigger>
          <TabsTrigger value="holidays">Holidays &amp; working week</TabsTrigger>
        </TabsList>

        <TabsContent value="allowances">
          <AllowancesTab />
        </TabsContent>
        <TabsContent value="types">
          <LeaveTypesTab />
        </TabsContent>
        <TabsContent value="holidays">
          <HolidaysTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
