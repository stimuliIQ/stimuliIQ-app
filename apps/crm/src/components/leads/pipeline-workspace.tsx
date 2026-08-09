// Leads ▸ Pipeline — the pipeline board with inbound Contact Messages alongside it
// as a second tab, so a counsellor working the board can triage a website enquiry
// without leaving the page.
//
// COMPOSES the two existing screens as tabs rather than rewriting either — the same
// approach leads-workspace.tsx took when Counselling/Tasks/Bookings became My Work.
// PipelineBoard and ContactMessageList are unchanged and each still renders its own
// PageHeader inside its tab (matching LeadsWorkspace, where every tab does the same).
//
// This tab is now the ONLY way in from the nav — the standalone "Contact Messages" leaf
// was removed once this existed (two doors into one room). The /leads/contact-messages
// route still exists and renders the same list, so old bookmarks and deep links keep
// working; see nav-config.ts's Leads block for how to resurface the leaf.
//
// PERMISSIONS: the two tabs are gated by DIFFERENT keys — the board is leads-scoped
// while contact submissions are `content.view` (the same key the nav leaf uses). A
// counsellor without `content.view` sees no Contact Messages tab at all, rather than a
// tab that 403s on open. The API enforces this regardless; the UI only hides what the
// server already forbids (CLAUDE.md §3.5).
import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { PipelineBoard } from "./pipeline-board";
import { ContactMessageList } from "./contact-message-list";
import { useContactSubmissionsList } from "../../hooks/use-content";
import { hasPermission } from "../../lib/permissions";

interface PipelineWorkspaceProps {
  me: MeResponse | undefined;
  /** `?owner=mine` deep link (from the notification bell) — seeds the board's owner filter. */
  initialOwnerFilter?: "mine";
}

/**
 * Tab label with a count of still-unhandled messages.
 *
 * The count is the bit that makes the tab worth having: without it, "don't jump between
 * pages" only means the jump is one click shorter — staff would still have to go and
 * look to find out whether anything is waiting.
 *
 * Deliberately its OWN component, so the query mounts only when the caller has already
 * established the user holds `content.view`. Reading the count in the parent and
 * branching on permission afterwards would fire a guaranteed-403 request for every
 * counsellor who lacks it, on every Pipeline page load.
 */
function ContactMessagesTabLabel(): React.JSX.Element {
  // `pageSize: 1` — only `meta.total` is read. This is a distinct query key from the
  // full table's (the `query` object differs), so it never clobbers its cached page.
  const { data } = useContactSubmissionsList({ page: 1, pageSize: 1, status: "new" });
  const newCount = data?.meta.total ?? 0;

  // The visible text is hidden from assistive tech and the accessible name supplied once,
  // whole. Interleaving sr-only fragments around the number would leave the computed name
  // at the mercy of JSX whitespace ("Contact Messages , 3 new"); building it as a single
  // string keeps it exactly "Contact Messages, 3 new".
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true">Contact Messages</span>
      {newCount > 0 ? (
        <span
          aria-hidden="true"
          className="rounded-full bg-info/15 px-1.5 py-0.5 text-xs font-medium tabular-nums text-info"
          data-testid="leads-tab-contact-messages-count"
        >
          {newCount}
        </span>
      ) : null}
      <span className="sr-only">{newCount > 0 ? `Contact Messages, ${newCount} new` : "Contact Messages"}</span>
    </span>
  );
}

export function PipelineWorkspace({ me, initialOwnerFilter }: PipelineWorkspaceProps): React.JSX.Element {
  const canViewMessages = hasPermission(me?.permissions, "content.view");

  // Nothing to tab between — render the board exactly as the page did before, so a user
  // without `content.view` gets no cosmetic single-tab chrome.
  if (!canViewMessages) return <PipelineBoard me={me} initialOwnerFilter={initialOwnerFilter} />;

  return (
    <Tabs defaultValue="pipeline">
      <TabsList aria-label="Leads sections">
        <TabsTrigger value="pipeline" data-testid="leads-tab-pipeline">
          Pipeline
        </TabsTrigger>
        <TabsTrigger value="contact-messages" data-testid="leads-tab-contact-messages">
          <ContactMessagesTabLabel />
        </TabsTrigger>
      </TabsList>
      <TabsContent value="pipeline">
        <PipelineBoard me={me} initialOwnerFilter={initialOwnerFilter} />
      </TabsContent>
      <TabsContent value="contact-messages">
        <ContactMessageList me={me} />
      </TabsContent>
    </Tabs>
  );
}
