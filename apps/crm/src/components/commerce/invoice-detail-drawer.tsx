// Invoice detail drawer — detail fields + a "Download" action that calls the
// download endpoint. Storage is a STUB in P2 (docs/plans/phase-2.md §"Risks
// #3"): when `stubMode: true` is returned, `url` is null — we show a clear
// "PDF generation pending / stubbed" message rather than crashing or
// rendering a dead download link.
import * as React from "react";
import { Download } from "lucide-react";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, EmptyState, formatPaise, Skeleton, useToast } from "@repo/ui";

import { useInvoice, useInvoiceDownload } from "../../hooks/use-invoices";
import { InvoiceStatusChip } from "./invoice-status-chip";

interface InvoiceDetailDrawerProps {
  invoiceId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function InvoiceDetailDrawer({ invoiceId, onOpenChange }: InvoiceDetailDrawerProps): React.JSX.Element {
  const open = Boolean(invoiceId);
  const { data: invoice, isLoading, isError, refetch } = useInvoice(invoiceId ?? undefined);
  const { toast } = useToast();
  const [downloadRequested, setDownloadRequested] = React.useState(false);
  const { data: download, isFetching: downloadFetching } = useInvoiceDownload(
    invoiceId ?? undefined,
    downloadRequested,
  );

  React.useEffect(() => {
    setDownloadRequested(false);
  }, [invoiceId]);

  React.useEffect(() => {
    if (!download) return;
    if (download.stubMode || !download.url) {
      toast({
        title: "Invoice PDF generation pending",
        description: "Storage is stubbed in this phase. The invoice row exists but no PDF has been rendered yet.",
        variant: "default",
      });
      return;
    }
    window.open(download.url, "_blank", "noopener,noreferrer");
  }, [download, toast]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={invoice ? `Invoice ${invoice.number}` : "Invoice"}
        description={invoice?.studentName}
        size="lg"
        data-testid="invoice-detail-drawer"
      >
        <DrawerBody>
          {isLoading ? (
            <div className="flex flex-col gap-3" data-testid="invoice-detail-loading">
              <Skeleton shape="line" />
              <Skeleton shape="line" />
              <Skeleton shape="block" />
            </div>
          ) : isError ? (
            <EmptyState
              data-testid="invoice-detail-error"
              title="Couldn't load this invoice"
              description="Something went wrong fetching the invoice details."
              action={
                <Button variant="secondary" onClick={() => refetch()} data-testid="invoice-detail-retry">
                  Try again
                </Button>
              }
            />
          ) : !invoice ? (
            <EmptyState data-testid="invoice-detail-empty" title="No data" description="This invoice has no details to show." />
          ) : (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-fg-muted">Status</dt>
                  <dd className="mt-1">
                    <InvoiceStatusChip status={invoice.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Amount</dt>
                  <dd className="mt-1 text-fg">{formatPaise(invoice.amountPaise)}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Student</dt>
                  <dd className="mt-1 text-fg">{invoice.studentName}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Program</dt>
                  <dd className="mt-1 text-fg">{invoice.programTitle}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Order</dt>
                  <dd className="mt-1 text-fg">{invoice.orderId}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Issued</dt>
                  <dd className="mt-1 text-fg">{invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleString() : "Pending"}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Storage key</dt>
                  <dd className="mt-1 text-fg">{invoice.storageKey ?? "Not yet generated (stub)"}</dd>
                </div>
              </dl>
              {invoice.tax ? (
                <div>
                  <h2 className="text-sm font-semibold text-fg">Tax breakdown</h2>
                  <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-surface p-3 text-xs text-fg-muted">
                    {JSON.stringify(invoice.tax, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          )}
        </DrawerBody>
        {invoice ? (
          <DrawerFooter>
            <Button
              variant="secondary"
              onClick={() => setDownloadRequested(true)}
              loading={downloadFetching}
              data-testid="invoice-download-button"
            >
              <Download className="size-4" aria-hidden="true" />
              Download invoice
            </Button>
          </DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
