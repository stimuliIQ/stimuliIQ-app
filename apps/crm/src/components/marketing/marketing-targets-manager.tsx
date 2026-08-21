// Marketing ▸ Targets — the super-admin surface: set the numbers, read the scoreboard.
// Spec: docs/specs/marketing-targets.md, ADR-0067.
//
// ONE SCREEN, NOT TWO. Setting targets and reporting on them are the same table: you decide
// next month's number by looking at how this month went, and splitting them across an
// "edit" page and a "report" page would mean holding one in your head while reading the
// other. So every row shows target, done and left, and the row action edits it in place.
//
// EVERY TARGETABLE PERSON IS A ROW, TARGET OR NOT. Somebody with no number set still appears,
// with their real completed figures and a "Not set" chip. Omitting them would make "nobody
// gave Anil a target" look exactly like "Anil is not on the team", and the first is the
// thing this screen exists to catch.
//
// RBAC: gated on `marketing_targets.manage`, which prisma/seed.ts grants to super_admin
// ALONE, outside the permission catalog the admin catch-all iterates. The API is the real
// enforcement (CLAUDE.md §3.5); this only avoids rendering what would 403.
import * as React from "react";
import { CalendarDays, IndianRupee, Pencil, Target, Trash2 } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  EmptyState,
  Input,
  KpiCard,
  MoneyInput,
  PageHeader,
  StatusChip,
  Textarea,
  cn,
  formatPaise,
  useToast,
} from "@repo/ui";
import type { MarketingTargetProgress, MeResponse, TargetMetricProgress } from "@repo/types";
import { toTargetMonth } from "@repo/types";

import {
  useDeleteMarketingTarget,
  useMarketingTargetsList,
  useUpsertMarketingTarget,
} from "../../hooks/use-marketing-targets";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { formatTargetMonth } from "../dashboard/marketing-target-cards";

/**
 * The months offered in the picker: this month, the next two (so targets can be set ahead of
 * time), and the previous nine (so the year can be reviewed). Deliberately a fixed list
 * rather than a free date input — a target month is always a real month near now, and a text
 * field invites `2026-13`.
 */
function monthOptions(): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let offset = 2; offset >= -9; offset--) {
    months.push(toTargetMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))));
  }
  return months;
}

export interface MarketingTargetsManagerProps {
  me: MeResponse | undefined;
}

export function MarketingTargetsManager({ me }: MarketingTargetsManagerProps): React.JSX.Element {
  const canManage = hasPermission(me?.permissions, "marketing_targets.manage");
  const months = React.useMemo(monthOptions, []);
  const [month, setMonth] = React.useState(() => toTargetMonth());
  const [editing, setEditing] = React.useState<MarketingTargetProgress | null>(null);
  const [deleting, setDeleting] = React.useState<MarketingTargetProgress | null>(null);

  const list = useMarketingTargetsList({ month }, canManage);
  const remove = useDeleteMarketingTarget();
  const { toast } = useToast();

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader title="Marketing targets" />
        <EmptyState
          title="You don't have access to marketing targets"
          description="Setting and reviewing monthly targets is restricted to the owner account."
          data-testid="marketing-targets-forbidden"
        />
      </div>
    );
  }

  const rows = list.data?.rows ?? [];
  const totals = list.data?.totals;

  const columns = [
    {
      id: "person",
      header: "Person",
      cell: (row: MarketingTargetProgress) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{row.userName}</p>
          <p className="truncate text-xs text-fg-subtle">{row.userEmail}</p>
        </div>
      ),
    },
    {
      id: "conversions",
      header: "Conversions",
      align: "right" as const,
      cell: (row: MarketingTargetProgress) => (
        <MetricCell metric={row.conversions} format={(n) => String(n)} testId={`conversions-${row.userId}`} />
      ),
    },
    {
      id: "revenue",
      header: "Revenue",
      align: "right" as const,
      cell: (row: MarketingTargetProgress) => (
        <MetricCell metric={row.revenuePaise} format={formatPaise} testId={`revenue-${row.userId}`} />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row: MarketingTargetProgress) => <RowStatus row={row} />,
    },
    {
      id: "setBy",
      header: "Set by",
      cell: (row: MarketingTargetProgress) => (
        <span className="text-sm text-fg-muted">{row.setByName ?? "—"}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Marketing targets"
        description="Set each person's monthly number. Progress is measured automatically from closed leads and captured payments, so there is nothing to tick off."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-fg">Month</span>
          <span className="relative">
            <CalendarDays
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
              aria-hidden="true"
            />
            <select
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              data-testid="marketing-targets-month"
              className="h-9 rounded-md border border-border bg-card pl-8 pr-3 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {months.map((value) => (
                <option key={value} value={value}>
                  {formatTargetMonth(value)}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      {totals ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Team conversions"
            value={`${totals.conversions.completed} / ${totals.conversions.target}`}
            icon={<Target />}
            loading={list.isLoading}
            data-testid="marketing-targets-total-conversions"
          />
          <KpiCard
            label="Team revenue"
            value={`${formatPaise(totals.revenuePaise.completed)} / ${formatPaise(totals.revenuePaise.target)}`}
            icon={<IndianRupee />}
            loading={list.isLoading}
            data-testid="marketing-targets-total-revenue"
          />
          <KpiCard
            label="People with a target"
            value={`${totals.peopleWithTarget} / ${rows.length}`}
            loading={list.isLoading}
            data-testid="marketing-targets-total-people"
          />
          <KpiCard
            label="Hitting their target"
            value={`${totals.peopleMeetingTarget} / ${totals.peopleWithTarget}`}
            loading={list.isLoading}
            data-testid="marketing-targets-total-meeting"
          />
        </div>
      ) : null}

      {list.isError ? (
        <Alert tone="danger" title="Couldn't load targets">
          <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.userId}
        loading={list.isLoading}
        caption={`Marketing targets for ${formatTargetMonth(month)}`}
        emptyState={{
          title: "No marketing staff yet",
          description:
            "Targets are offered to users holding the Marketing role. Add one in Admin ▸ Users to set their first target.",
        }}
        rowActions={(row) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(row)}
              data-testid={`marketing-target-edit-${row.userId}`}
              aria-label={`${row.targetId ? "Edit" : "Set"} target for ${row.userName}`}
            >
              <Pencil className="size-4" aria-hidden="true" />
              {row.targetId ? "Edit" : "Set target"}
            </Button>
            {row.targetId ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleting(row)}
                data-testid={`marketing-target-delete-${row.userId}`}
                aria-label={`Remove target for ${row.userName}`}
              >
                <Trash2 className="size-4 text-danger" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        )}
        data-testid="marketing-targets-table"
      />

      <TargetDrawer row={editing} month={month} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove ${deleting?.userName ?? ""}'s target?`}
        description={`They will have no target for ${formatTargetMonth(month)}. Nothing they have already closed is affected: progress is measured from real leads and payments, not from this row.`}
        confirmLabel="Remove target"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          const id = deleting?.targetId;
          if (!id) return;
          remove.mutate(id, {
            onSuccess: () => {
              toast({ title: "Target removed", variant: "success" });
              setDeleting(null);
            },
            onError: (error) => surfaceError(toast, error, "Couldn't remove that target."),
          });
        }}
        data-testid="marketing-target-delete-confirm"
      />
    </div>
  );
}
MarketingTargetsManager.displayName = "MarketingTargetsManager";

/** "23 / 40" with "17 left" underneath, or an em dash when the metric is not measured. */
function MetricCell({
  metric,
  format,
  testId,
}: {
  metric: TargetMetricProgress;
  format: (value: number) => string;
  testId: string;
}): React.JSX.Element {
  if (metric.target === 0) {
    // Not measured on this. Show what they did anyway — a person closing deals against no
    // revenue target is exactly who the next target should be set for.
    return (
      <div className="text-right" data-testid={testId}>
        <p className="text-sm text-fg">{format(metric.completed)}</p>
        <p className="text-xs text-fg-subtle">no target</p>
      </div>
    );
  }
  return (
    <div className="text-right" data-testid={testId}>
      <p className="text-sm font-medium tabular-nums text-fg">
        <span className={cn(metric.met && "text-success")}>{format(metric.completed)}</span>
        <span className="text-fg-subtle"> / {format(metric.target)}</span>
      </p>
      <p className="text-xs text-fg-subtle">{metric.met ? "met" : `${format(metric.pending)} left`}</p>
    </div>
  );
}

function RowStatus({ row }: { row: MarketingTargetProgress }): React.JSX.Element {
  if (!row.targetId) return <StatusChip tone="neutral" size="sm" label="Not set" />;
  const measured = [row.conversions, row.revenuePaise].filter((m) => m.target > 0);
  if (measured.every((m) => m.met)) return <StatusChip tone="success" size="sm" label="Met" />;
  const worst = Math.min(...measured.map((m) => m.percent ?? 0));
  return (
    <StatusChip
      tone={worst >= 0.6 ? "info" : "warning"}
      size="sm"
      label={`${Math.round(worst * 100)}%`}
    />
  );
}

/**
 * Set or replace one person's number.
 *
 * The person is fixed by the row that opened it — there is no user picker, because picking a
 * person you can already see the row for is a chance to pick the wrong one.
 */
function TargetDrawer({
  row,
  month,
  onClose,
}: {
  row: MarketingTargetProgress | null;
  month: string;
  onClose: () => void;
}): React.JSX.Element {
  const upsert = useUpsertMarketingTarget();
  const { toast } = useToast();
  const [conversions, setConversions] = React.useState("0");
  const [revenuePaise, setRevenuePaise] = React.useState(0);
  const [note, setNote] = React.useState("");

  // Re-seed from the row each time the drawer opens, so editing person A then person B never
  // shows A's numbers under B's name.
  React.useEffect(() => {
    if (!row) return;
    setConversions(String(row.conversions.target));
    setRevenuePaise(row.revenuePaise.target);
    setNote(row.note ?? "");
  }, [row]);

  const conversionsNumber = Number.parseInt(conversions, 10);
  const conversionsValid = Number.isFinite(conversionsNumber) && conversionsNumber >= 0;
  // Mirrors the server's refine: a row with both numbers at zero measures nothing, and
  // removing the target is how you say "no target".
  const measuresNothing = conversionsValid && conversionsNumber === 0 && revenuePaise === 0;

  return (
    <Drawer open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent
        title={row ? `Target for ${row.userName}` : "Target"}
        description={`${formatTargetMonth(month)} · progress is measured automatically`}
        data-testid="marketing-target-drawer"
      >
        <DrawerBody className="space-y-4">
          <Input
            label="Conversions target"
            type="number"
            min={0}
            inputMode="numeric"
            value={conversions}
            onChange={(event) => setConversions(event.target.value)}
            helperText="Leads this person closes during the month. 0 means they are not measured on volume."
            error={conversionsValid ? undefined : "Enter a whole number, 0 or more."}
            data-testid="marketing-target-conversions-input"
          />
          <MoneyInput
            label="Revenue target"
            value={revenuePaise}
            onChange={setRevenuePaise}
            helperText="Payments captured against their leads during the month. ₹0 means they are not measured on revenue."
            data-testid="marketing-target-revenue-input"
          />
          <Textarea
            label="Note (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            rows={2}
            helperText="Context for this number, e.g. 'pro-rated, joined on the 12th'. Shown to them on their dashboard."
            data-testid="marketing-target-note-input"
          />
          {measuresNothing ? (
            <Alert tone="warning" title="This target measures nothing">
              Set a conversions figure, a revenue figure, or both. To give this person no target
              at all, close this and use Remove target instead.
            </Alert>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <Button variant="secondary" onClick={onClose} disabled={upsert.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!conversionsValid || measuresNothing || upsert.isPending || !row}
            loading={upsert.isPending}
            onClick={() => {
              if (!row || !conversionsValid) return;
              upsert.mutate(
                {
                  userId: row.userId,
                  month,
                  conversionsTarget: conversionsNumber,
                  revenueTargetPaise: revenuePaise,
                  ...(note.trim() ? { note: note.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    toast({ title: `Target saved for ${row.userName}`, variant: "success" });
                    onClose();
                  },
                  onError: (error) => surfaceError(toast, error, "Couldn't save that target."),
                },
              );
            }}
            data-testid="marketing-target-save"
          >
            Save target
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
