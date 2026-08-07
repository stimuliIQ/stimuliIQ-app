// Command palette (⌘K) — minimal stretch implementation per docs/03 §10/§11
// ("command palette for power users"). Reuses @repo/ui's Drawer primitives
// (Radix Dialog under the hood) instead of importing Radix directly — the
// CRM app only depends on @repo/ui/@repo/api-client/@repo/types per
// CLAUDE.md §3.2, no bespoke one-off UI primitives. Wave 4b extended
// `ACTIONS` with Batches/Admin; Phase 2 Wave 5a adds Commerce
// (Payments/Orders/Invoices/Refunds/Coupons). Wave 5b adds Leads
// (Pipeline/My Work — lifecycle-redesign P2 folded Counselling/Tasks/Bookings
// into the one My Work cockpit).
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Drawer, DrawerContent, DrawerBody, cn } from "@repo/ui";

interface CommandAction {
  id: string;
  label: string;
  group: string;
  to: string;
}

const ACTIONS: CommandAction[] = [
  { id: "dashboard", label: "Go to Dashboard", group: "Navigate", to: "/" },
  { id: "students", label: "Go to Students directory", group: "Navigate", to: "/students" },
  { id: "faculty", label: "Go to Faculty directory", group: "Navigate", to: "/faculty" },
  { id: "courses", label: "Go to Courses", group: "Navigate", to: "/courses" },
  { id: "batches", label: "Go to Batches", group: "Navigate", to: "/batches" },
  { id: "admin-roles", label: "Go to Roles & Permissions", group: "Admin", to: "/admin/roles" },
  { id: "admin-branches", label: "Go to Branches", group: "Admin", to: "/admin/branches" },
  { id: "admin-audit-logs", label: "Go to Audit Logs", group: "Admin", to: "/admin/audit-logs" },
  { id: "commerce-payments", label: "Go to Payments ledger", group: "Commerce", to: "/commerce/payments" },
  { id: "commerce-orders", label: "Go to Orders ledger", group: "Commerce", to: "/commerce/orders" },
  { id: "commerce-invoices", label: "Go to Invoices", group: "Commerce", to: "/commerce/invoices" },
  { id: "commerce-refunds", label: "Go to Refunds", group: "Commerce", to: "/commerce/refunds" },
  { id: "commerce-coupons", label: "Go to Coupons", group: "Commerce", to: "/commerce/coupons" },
  { id: "leads-pipeline", label: "Go to Leads pipeline", group: "Leads", to: "/leads" },
  // lifecycle-redesign P2: Counselling/Tasks/Bookings are now the three tabs of the
  // one "My Work" cockpit at /leads/counselling. Deep-link commands for the absorbed
  // tabs still resolve there (the standalone routes redirect).
  { id: "leads-my-work", label: "Go to My Work (follow-ups, bookings)", group: "Leads", to: "/leads/counselling" },
];

export function CommandPalette(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const navigate = useNavigate();

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isCmdK) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filtered = ACTIONS.filter((action) =>
    action.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <button
        type="button"
        aria-label="Open command palette"
        data-testid="command-palette-trigger"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-[var(--density-toolbar-height)] w-full max-w-xs items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm text-fg-subtle",
          "transition-colors duration-fast hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Search className="size-4" aria-hidden="true" />
        <span>Search or jump to…</span>
        <kbd className="ml-auto rounded border border-border bg-surface px-1.5 py-0.5 text-xs">⌘K</kbd>
      </button>
      <Drawer
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <DrawerContent
          title="Jump to…"
          description="Search and navigate to a section of the CRM."
          size="sm"
          data-testid="command-palette"
          className="inset-y-auto left-1/2 right-auto top-24 h-auto max-h-[70vh] -translate-x-1/2 border border-border"
        >
          <DrawerBody className="flex flex-col gap-2 p-3">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type a command or search…"
              aria-label="Search commands"
              data-testid="command-palette-input"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <ul role="listbox" aria-label="Results" className="max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-fg-muted">No matches.</li>
              ) : (
                filtered.map((action) => (
                  <li key={action.id}>
                    <button
                      type="button"
                      data-testid={`command-palette-item-${action.id}`}
                      onClick={() => {
                        setOpen(false);
                        setQuery("");
                        void navigate({ to: action.to });
                      }}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-fg hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span>{action.label}</span>
                      <span className="text-xs text-fg-subtle">{action.group}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  );
}
