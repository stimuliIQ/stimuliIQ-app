// Export creation drawer — pick an export type + format (csv|pdf) + the
// same filters as the matching on-screen dashboard/list, then POST
// /crm/exports (docs/plans/phase-7.md Wave 3 task #15, AC-30..34).
//
// Controlled-component form (not react-hook-form): `CreateExportRequestDto`
// is a 12-variant discriminated union with wildly different `params` shapes
// per type (Rule H-2), so RHF's typed `register` wiring doesn't fit cleanly
// — instead this holds plain `type`/`format`/`params` state and validates
// the exact submit payload through `CreateExportRequestDtoSchema` (the same
// zod schema the API uses) right before the request, surfacing any zod
// issue as a toast. This still satisfies CLAUDE.md §3.2 ("schemas from
// @repo/types, reused FE+BE") — the schema is the single source of truth for
// what's valid, react-hook-form is just not part of that path here.
import * as React from "react";
import { ZodError } from "zod";
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  Select,
  SelectItem,
  useToast,
} from "@repo/ui";
import { CreateExportRequestDtoSchema, type ExportEntityType, type ExportFormat } from "@repo/types";

import { useCreateExport } from "../../hooks/use-exports";
import { surfaceError } from "../../lib/surface-error";
import { EXPORT_TYPES, exportTypeInfo } from "../../lib/export-types";
import { buildExportParams } from "../../lib/build-report-params";
import { ReportParamsFields, type ReportParamsBag } from "./report-params-fields";

export interface ExportCreateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_TYPE: ExportEntityType = "revenue";

export function ExportCreateDrawer({ open, onOpenChange }: ExportCreateDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const createExport = useCreateExport();

  const [type, setType] = React.useState<ExportEntityType>(DEFAULT_TYPE);
  const [format, setFormat] = React.useState<ExportFormat>("csv");
  const [params, setParams] = React.useState<ReportParamsBag>({});

  const info = exportTypeInfo(type);

  React.useEffect(() => {
    if (!open) return;
    // Reset to a clean slate every time the drawer opens.
    setType(DEFAULT_TYPE);
    setFormat("csv");
    setParams({});
  }, [open]);

  React.useEffect(() => {
    if (!info?.pdfAllowed && format === "pdf") setFormat("csv");
  }, [info, format]);

  function handleTypeChange(value: string) {
    setType(value as ExportEntityType);
    setParams({});
  }

  function patchParams(patch: Partial<ReportParamsBag>) {
    setParams((prev) => ({ ...prev, ...patch }));
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const body = CreateExportRequestDtoSchema.parse({
        type,
        format,
        params: buildExportParams(type, params),
      });
      await createExport.mutateAsync(body);
      toast({
        title: "Export queued",
        description: "Check the table below for its status — a download link appears once it succeeds.",
        variant: "success",
      });
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ZodError) {
        const first = error.issues[0];
        toast({
          title: "Couldn't start export",
          description: first ? `${first.path.join(".") || "value"}: ${first.message}` : "Check the required fields.",
          variant: "destructive",
        });
        return;
      }
      surfaceError(toast, error, "Couldn't start export");
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title="New export"
        description="Runs as a background job — you'll see its status in the Export Jobs table below."
        data-testid="export-create-drawer"
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Select
              label="Export type"
              required
              value={type}
              onValueChange={handleTypeChange}
              placeholder="Select an export type"
              data-testid="export-form-type"
            >
              {EXPORT_TYPES.map((t) => (
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
              disabled={!info?.pdfAllowed}
              helperText={info?.pdfAllowed ? undefined : "Entity-list exports are CSV only."}
              placeholder="Select a format"
              data-testid="export-form-format"
            >
              <SelectItem value="csv">CSV</SelectItem>
              {info?.pdfAllowed ? <SelectItem value="pdf">PDF (printable summary)</SelectItem> : null}
            </Select>

            <ReportParamsFields type={type} params={params} onChange={patchParams} idPrefix="export-form" />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="export-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={createExport.isPending} data-testid="export-form-submit">
              Start export
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
ExportCreateDrawer.displayName = "ExportCreateDrawer";
