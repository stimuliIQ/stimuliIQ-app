// Organisation ▸ Teams — the org chart (docs/specs/org-teams.md, ADR-0069).
//
// The screen that gives the company a reporting structure. Before it existed there was no
// hierarchy of any kind in the product: the only way one member of staff related to another
// was `user_roles.branch_id`, a flat tag on a role assignment. Leave approval was hardcoded
// to "every active super admin", so one person signed off every absence in the company.
//
// THREE THINGS THIS SCREEN IS DELIBERATE ABOUT:
//   1. IT SAYS WHAT A TEAM DOES. A team is not a label — it decides who approves whose
//      leave. The banner says so, because somebody adding a person to a team is changing
//      who signs their absence off, and that must not be a surprise.
//   2. AN INCOMPLETE TEAM IS SHOWN, NOT HIDDEN. "No lead yet" renders as a warning chip
//      rather than a blank cell, because a missing lead silently reroutes that team's leave
//      to HR and the person who forgot is the only one who could fix it.
//   3. THE PICKERS EXPLAIN THEMSELVES. Somebody already on another team appears in the
//      member list marked with that team rather than being silently absent — a name missing
//      from a list with no explanation is what gets reported as "the dropdown is broken".
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { MeResponse, Team } from "@repo/types";

import { useDeleteTeam, useTeamsList } from "../../hooks/use-org";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { TeamFormDrawer } from "./team-form-drawer";

export function TeamsWorkspace({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const { toast } = useToast();
  const canManage = hasPermission(me?.permissions, "org.teams.manage");

  const { data, isLoading, isError, refetch } = useTeamsList({ page: 1, pageSize: 100 });
  const deleteTeam = useDeleteTeam();

  const [editing, setEditing] = React.useState<Team | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Team | null>(null);

  const rows = data?.items ?? [];

  function handleDelete(): void {
    if (!deleting) return;
    deleteTeam.mutate(deleting.id, {
      onSuccess: () => {
        toast({
          title: `“${deleting.name}” disbanded`,
          description: "Its members are no longer on a team, so their leave now goes to HR.",
          variant: "success",
        });
        setDeleting(null);
      },
      onError: (error) => {
        surfaceError(toast, error, "Couldn't disband this team");
        setDeleting(null);
      },
    });
  }

  const columns: Array<DataTableColumn<Team>> = [
    { id: "name", header: "Team", cell: (row) => row.name },
    {
      id: "manager",
      header: "Manager",
      cell: (row) =>
        row.manager ? (
          row.manager.name
        ) : (
          // Not a blank cell. A team with no manager routes its lead's own leave to HR, and
          // whoever is looking at this list is the person who can fix that.
          <StatusChip tone="warning" label="Not set" size="sm" />
        ),
    },
    {
      id: "lead",
      header: "Team lead",
      cell: (row) =>
        row.lead ? row.lead.name : <StatusChip tone="warning" label="Not set" size="sm" />,
    },
    {
      id: "members",
      header: "Members",
      align: "right",
      cell: (row) => (row.memberCount > 0 ? row.memberCount : "-"),
    },
    {
      id: "active",
      header: "Status",
      cell: (row) => (
        <StatusChip
          tone={row.active ? "success" : "neutral"}
          label={row.active ? "Active" : "Inactive"}
          size="sm"
        />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) =>
        canManage ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setDeleting(row);
            }}
            aria-label={`Disband ${row.name}`}
            data-testid={`delete-team-${row.id}`}
          >
            <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
          </Button>
        ) : null,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load teams"
        data-testid="teams-error"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="teams-workspace">
      <PageHeader
        title="Teams"
        description="Who reports to whom. A team has one manager, one team lead and its members."
      />

      <Alert tone="neutral" title="Teams decide who approves leave" data-testid="teams-purpose-note">
        A member&apos;s leave goes to their <strong>team lead</strong> first, then to their{" "}
        <strong>manager</strong>. A team lead&apos;s own leave goes straight to their manager, and a
        manager&apos;s goes to the super admin. Anyone not on a team yet has their leave handled by
        HR, so nothing is ever left without an approver.
      </Alert>

      {canManage ? (
        <div className="flex items-center justify-end">
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="team-create-button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New team
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        loading={isLoading}
        onRowClick={
          canManage
            ? (row) => {
                setEditing(row);
                setFormOpen(true);
              }
            : undefined
        }
        emptyState={{
          title: "No teams yet",
          description: canManage
            ? "Create a team, name its manager and team lead, then add its members. Until then everyone's leave goes to HR."
            : "Nobody has set up the org chart yet.",
        }}
        data-testid="teams-table"
      />

      <TeamFormDrawer
        team={editing}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Disband “${deleting?.name ?? ""}”?`}
        description={
          `Its ${deleting?.memberCount ?? 0} member(s) stay exactly as they are, but they will no longer be on a ` +
          "team — so their leave will go to HR until you put them on another one. Leave already approved is unaffected."
        }
        confirmLabel="Disband"
        onConfirm={handleDelete}
        data-testid="team-delete-confirm"
      />
    </div>
  );
}
