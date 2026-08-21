// /support/[id] — Support ticket detail (thread + reply + rate). Phase 9 Completion, T36.
import type { Metadata } from "next";

import { LmsShell } from "../../../components/shell/lms-shell";
import { TicketDetailContent } from "../../../components/support/ticket-detail-content";

export const metadata: Metadata = {
  title: "Ticket | stimuliiq Support",
};

interface TicketPageProps {
  params: Promise<{ id: string }>;
}

export default async function TicketDetailPage({ params }: TicketPageProps) {
  const { id } = await params;

  return (
    <LmsShell>
      <div data-testid="ticket-detail-page">
        <TicketDetailContent ticketId={id} />
      </div>
    </LmsShell>
  );
}
