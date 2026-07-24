// Report schedule create/edit drawer — recurring report emails
// (docs/plans/phase-7.md Wave 3 task #15, AC-37..39).
//
// `type`/`format`/`params` are immutable after creation (delete + recreate
// to change what's reported, per @repo/types comment on
// UpdateReportScheduleDtoSchema) — and the list/detail DTO doesn't even
// return `params` back, so edit mode only ever shows `type`/`format`
// read-only and edits `frequency`/`recipientEmail`/`active`.
//
// AC-37: a schedule's data access is re-evaluated at SEND time from the
// recipient's live permissions/scope — a schedule can never send data its
// owner (or a later different owner) can no longer see. This is called out
// explicitly in the copy below so nobody assumes a schedule "locks in"
// today's access.
import * as React from "react";
import { ZodError } from "zod";
import {
  Button,
  Checkbox,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  Input,
  Label,
  Select,
  SelectItem,
  useToast,
} from "@repo/ui";
import {
  CreateReportScheduleDtoSchema,
  UpdateReportScheduleDtoSchema,
  type ExportEntityType,
  type ExportFormat,
  type ReportScheduleDto,
  type ReportScheduleFrequency,
} from "@repo/types";

import { useCreateReportSchedule, useUpdateReportSchedule } from "../../hooks/use-report-schedules";
import { surfaceError } from "../../lib/surface-error";
import { REPORT_EXPORT_TYPES, exportTypeLabel } from "../../lib/export-types";
import { buildExportParams } from "../../lib/build-report-params";
import { ReportParamsFields, type ReportParamsBag } from "./report-params-fields";

export interface ReportScheduleFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit mode — the row already loaded by the list (no separate GET exists). */
  schedule?: ReportScheduleDto;
}

const FREQUENCY_OPTIONS: { value: ReportScheduleFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const DEFAULT_TYPE: ExportEntityType = "revenue";

export function ReportScheduleFormDrawer({ open, onOpenChange, schedule }: ReportScheduleFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(schedule);
  const { toast } = useToast();
  const createSchedule = useCreateReportSchedule();
  const updateSchedule = useUpdateReportSchedule();

  // Create-only fields (type/format/params are immutable — never editable).
  const [type, setType] = React.useState<ExportEntityType>(DEFAULT_TYPE);
  const [format, setFormat] = React.useState<ExportFormat>("csv");
  const [params, setParams] = React.useState<ReportParamsBag>({});

  // Shared fields (editable in both create + edit).
  const [frequency, setFrequency] = React.useState<ReportScheduleFrequency>("weekly");
  const [recipientEmail, setRecipientEmail] = React.useState("");
  const [active, setActive] = React.useState(true);

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && schedule) {
      setFrequency(schedule.frequency);
      setRecipientEmail(schedule.recipientEmail ?? "");
      setActive(schedule.active);
    } else {
      setType(DEFAULT_TYPE);
      setFormat("csv");
      setParams({});
      setFrequency("weekly");
      setRecipientEmail("");
      setActive(true);
    }
  }, [open, isEdit, schedule]);

  function patchParams(patch: Partial<ReportParamsBag>) {
    setParams((prev) => ({ ...prev, ...patch }));
  }

  const isPending = createSchedule.isPending || updateSchedule.isPending;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (isEdit && schedule) {
        const body = UpdateReportScheduleDtoSchema.parse({
          frequency,
          recipientEmail: recipientEmail.trim() ? recipientEmail.trim() : null,
          active,
        });
        await updateSchedule.mutateAsync({ id: schedule.id, body });
        toast({ title: "Schedule updated", variant: "success" });
      } else {
        const body = CreateReportScheduleDtoSchema.parse({
          type,
          format,
          frequency,
          recipientEmail: recipientEmail.trim() ? recipientEmail.trim() : undefined,
          params: buildExportParams(type, params),
        });
        await createSchedule.mutateAsync(body);
        toast({ title: "Schedule created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ZodError) {
        const first = error.issues[0];
        toast({
          title: isEdit ? "Couldn't update schedule" : "Couldn't create schedule",
          description: first ? `${first.path.join(".") || "value"}: ${first.message}` : "Check the required fields.",
          variant: "destructive",
        });
        return;
      }
      surfaceError(toast, error, isEdit ? "Couldn't update schedule" : "Couldn't create schedule");
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title={schedule ? "Edit schedule" : "New schedule"}
        description={schedule ? exportTypeLabel(schedule.type) : "A recurring report email, sent on the cadence you choose."}
        data-testid={schedule ? "schedule-edit-drawer" : "schedule-create-drawer"}
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <div className="rounded-md border border-dashed border-border bg-surface p-3 text-xs text-fg-muted" data-testid="schedule-scope-note">
              A schedule's data is re-evaluated at send time from the recipient's own permissions — it
              will never email data the recipient can no longer access, even if roles/scope change
              after this schedule was created.
            </div>

            {schedule ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-fg-muted">Report</span>
                  <p className="mt-1 text-fg">{exportTypeLabel(schedule.type)}</p>
                </div>
                <div>
                  <span className="text-fg-muted">Format</span>
                  <p className="mt-1 text-fg">{schedule.format.toUpperCase()}</p>
                </div>
              </div>
            ) : (
              <>
                <Select
                  label="Report"
                  required
                  value={type}
                  onValueChange={(value) => {
                    setType(value as ExportEntityType);
                    setParams({});
                  }}
                  placeholder="Select a report"
                  data-testid="schedule-form-type"
                >
                  {REPORT_EXPORT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </Select>
                <Select
                  label="Format"
                  required
                  value={format}
                  onValueChange={(value) => setFormat(value as ExportFormat)}
                  placeholder="Select a format"
                  data-testid="schedule-form-format"
                >
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="pdf">PDF (printable summary)</SelectItem>
                </Select>
                <ReportParamsFields type={type} params={params} onChange={patchParams} idPrefix="schedule-form" />
              </>
            )}

            <Select
              label="Frequency"
              required
              value={frequency}
              onValueChange={(value) => setFrequency(value as ReportScheduleFrequency)}
              placeholder="Select a frequency"
              data-testid="schedule-form-frequency"
            >
              {FREQUENCY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </Select>

            <Input
              label="Recipient email"
              type="email"
              placeholder="you@stimuliiq.com"
              helperText="Leave blank to send to your own registered email."
              value={recipientEmail}
              onChange={(event) => setRecipientEmail(event.target.value)}
              data-testid="schedule-form-recipient"
            />

            {isEdit ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="schedule-form-active"
                  checked={active}
                  onCheckedChange={(checked) => setActive(checked === true)}
                  data-testid="schedule-form-active"
                />
                <Label htmlFor="schedule-form-active">Schedule is active</Label>
              </div>
            ) : null}
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="schedule-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="schedule-form-submit">
              {isEdit ? "Save changes" : "Create schedule"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
ReportScheduleFormDrawer.displayName = "ReportScheduleFormDrawer";
