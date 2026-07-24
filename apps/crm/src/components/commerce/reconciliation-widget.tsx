// Ledger reconciliation summary widget — docs/03 §20 ("revenue dashboard
// totals reconcile exactly with the payments ledger for any date range").
// P2 ships the reconciling PRIMITIVE (this widget calling the reconcile
// read endpoint), not a full revenue dashboard (that's P7). Finance/Owner/
// Admin only — gated by the parent page's RBAC check (server is the real
// enforcement; this only avoids showing a control that would 403).
import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, formatPaise, Input, Skeleton } from "@repo/ui";

import { useLedgerReconciliation } from "../../hooks/use-payments";

function startOfMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReconciliationWidget(): React.JSX.Element {
  const [from, setFrom] = React.useState(startOfMonthIso());
  const [to, setTo] = React.useState(todayIso());

  const params = from && to ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : undefined;
  const { data, isLoading, isError, refetch, isFetching } = useLedgerReconciliation(params);

  return (
    <Card data-testid="reconciliation-widget">
      <CardHeader>
        <CardTitle>Ledger reconciliation</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          Sum of captured payments minus processed refunds, compared against the order ledger&rsquo;s paid total —
          the invariant from docs/03 §20.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="From"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            wrapperClassName="w-40"
            data-testid="reconciliation-from"
          />
          <Input
            label="To"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            wrapperClassName="w-40"
            data-testid="reconciliation-to"
          />
          <Button variant="secondary" onClick={() => refetch()} data-testid="reconciliation-refresh">
            Refresh
          </Button>
        </div>

        {isLoading || isFetching ? (
          <div className="flex flex-col gap-2" data-testid="reconciliation-loading">
            <Skeleton shape="line" />
            <Skeleton shape="line" />
          </div>
        ) : isError ? (
          <EmptyState
            data-testid="reconciliation-error"
            title="Couldn't load reconciliation"
            description="Something went wrong computing the ledger reconciliation for this range."
            action={
              <Button variant="secondary" onClick={() => refetch()} data-testid="reconciliation-retry">
                Try again
              </Button>
            }
          />
        ) : !data ? (
          <EmptyState
            data-testid="reconciliation-empty"
            title="Choose a date range"
            description="Pick a From and To date to compute the reconciliation."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="reconciliation-summary">
            <div>
              <p className="text-xs text-fg-muted">Captured</p>
              <p className="text-lg font-semibold text-fg" data-testid="reconciliation-captured">
                {formatPaise(data.capturedAmountPaise)}
              </p>
              <p className="text-xs text-fg-subtle">{data.captureCount} payments</p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">Refunded</p>
              <p className="text-lg font-semibold text-fg" data-testid="reconciliation-refunded">
                {formatPaise(data.processedRefundAmountPaise)}
              </p>
              <p className="text-xs text-fg-subtle">{data.refundCount} refunds</p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">Net (captured − refunded)</p>
              <p className="text-lg font-semibold text-fg" data-testid="reconciliation-net">
                {formatPaise(data.netAmountPaise)}
              </p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">Order ledger paid total</p>
              <p className="text-lg font-semibold text-fg" data-testid="reconciliation-order-total">
                {formatPaise(data.orderPaidTotalPaise)}
              </p>
            </div>
            <div className="col-span-2 sm:col-span-4">
              {data.reconcilesOk ? (
                <Alert tone="success" icon={<CheckCircle2 />} data-testid="reconciliation-ok" role="status">
                  Reconciles — net amount matches the order ledger paid total exactly.
                </Alert>
              ) : (
                <Alert tone="danger" icon={<XCircle />} data-testid="reconciliation-mismatch" role="alert">
                  Mismatch — the net amount does not match the order ledger paid total. Investigate before trusting
                  revenue totals for this range.
                </Alert>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
