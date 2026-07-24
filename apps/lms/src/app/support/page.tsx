// /support — Support / help desk (raise + list own tickets). Phase 9 Completion, T36.
// docs/02 §7.16.
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

import { LmsShell } from "../../components/shell/lms-shell";
import { TicketsListContent } from "../../components/support/tickets-list-content";

export const metadata: Metadata = {
  title: "Support — stimuliiq",
  description: "Raise a support ticket and track its status.",
};

export default function SupportPage() {
  return (
    <LmsShell>
      <div data-testid="support-page">
        <TicketsListContent />
      </div>
    </LmsShell>
  );
}
