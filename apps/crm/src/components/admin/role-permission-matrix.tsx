// Permission matrix editor — the headline Admin feature (docs/03 §7.16/§9).
// Loads the full permission catalog (grouped by module) once, plus the
// selected role's current grants, and renders an accessible <table> grid:
// one row per `module.action` permission with a single on/off Switch. ON grants
// the permission at "all" (org-wide) scope, OFF revokes it (product decision —
// the scope picker was removed in favour of a plain toggle). Grants a role
// already holds at a NARROWER scope are preserved until explicitly toggled off;
// flipping a row ON always (re)grants at "all". Saves via the full-replace
// `updatePermissions` mutation (see hooks/use-roles.ts).
//
// RBAC-aware disabling: because ON means "all", a row is only enable-able when
// the EDITOR holds that permission at "all" scope themselves; otherwise it is
// rendered disabled with a hint. This is a UX guide only. The SERVER is the
// actual privilege-escalation enforcement point (CLAUDE.md §3.5; @repo/types
// crm/admin.schemas.ts file header) and will reject (403) any attempt to grant
// something broader than the editor's own resolved permission — that 403 is
// surfaced via the toast + inline banner below, it is not prevented client-side
// as the source of truth.
import * as React from "react";
import { Alert, Button, EmptyState, Skeleton, Switch, useToast } from "@repo/ui";
import type { MeResponse, PermissionScope, RolePermissionCell, Role } from "@repo/types";

import { usePermissionCatalog, useRolePermissions, useUpdateRolePermissions } from "../../hooks/use-roles";

// The permission editor is a simple on/off toggle per permission: ON grants the
// permission at "all" (org-wide) scope, OFF revokes it (product decision — see the
// role directory). The underlying model still stores a scope per grant, so grants
// a role ALREADY holds at a narrower scope (e.g. a seeded branch-scoped role) are
// preserved as-is until explicitly toggled off — flipping a row ON always (re)grants
// it at "all". Because ON means "all", a row is only enable-able when the editor
// themselves holds that permission at "all" scope (the server rejects any broader
// grant than the editor's own — CLAUDE.md §3.5).
const GRANT_SCOPE: PermissionScope = "all";

interface RolePermissionMatrixProps {
  role: Role;
  me: MeResponse | undefined;
}

export function RolePermissionMatrix({ role, me }: RolePermissionMatrixProps): React.JSX.Element {
  const { toast } = useToast();
  const { data: catalog, isLoading: catalogLoading, isError: catalogError, refetch: refetchCatalog } =
    usePermissionCatalog();
  const {
    data: rolePermissions,
    isLoading: grantsLoading,
    isError: grantsError,
    refetch: refetchGrants,
  } = useRolePermissions(role.id);
  const updatePermissions = useUpdateRolePermissions();

  // Local editable draft of grants, keyed by permissionKey -> scope (or
  // undefined when not granted). Reset whenever the role or its loaded
  // grants change.
  const [draft, setDraft] = React.useState<Map<string, PermissionScope>>(new Map());
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!rolePermissions) return;
    const next = new Map<string, PermissionScope>();
    for (const grant of rolePermissions.grants) {
      if (grant.scope) next.set(grant.permissionKey, grant.scope);
    }
    setDraft(next);
    setServerError(null);
  }, [rolePermissions]);

  // Must be computed BEFORE the loading/error early returns below — a hook that
  // only runs on some renders violates the Rules of Hooks ("rendered more hooks
  // than during the previous render") and crashes when a role switch flips this
  // component through its loading state. Depends only on values available above.
  const hasChanges = React.useMemo(() => {
    const original = new Map<string, PermissionScope>();
    for (const grant of rolePermissions?.grants ?? []) {
      if (grant.scope) original.set(grant.permissionKey, grant.scope);
    }
    if (original.size !== draft.size) return true;
    for (const [key, scope] of draft) {
      if (original.get(key) !== scope) return true;
    }
    return false;
  }, [draft, rolePermissions]);

  const isLoading = catalogLoading || grantsLoading;
  const isError = catalogError || grantsError;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" data-testid="permission-matrix-loading">
        <Skeleton shape="block" />
        <Skeleton shape="block" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        data-testid="permission-matrix-error"
        title="Couldn't load the permission matrix"
        description="Something went wrong fetching the permission catalog or this role's grants."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              void refetchCatalog();
              void refetchGrants();
            }}
            data-testid="permission-matrix-retry"
          >
            Try again
          </Button>
        }
      />
    );
  }

  const modules = catalog?.modules ?? [];

  /**
   * The editor's own scope for a permission (or undefined if they don't hold it).
   * Since ON grants at "all", a row is only enable-able when the editor holds the
   * permission at "all" too — UX-guide only (see file header); the server is the
   * actual escalation guard and rejects anything broader than the editor's grant.
   */
  const editorScopeFor = (permissionKey: string): PermissionScope | undefined =>
    (me?.permissions ?? []).find((g) => g.key === permissionKey)?.scope;

  const handleToggle = (permissionKey: string, checked: boolean) => {
    setDraft((current) => {
      const next = new Map(current);
      if (checked) {
        next.set(permissionKey, GRANT_SCOPE);
      } else {
        next.delete(permissionKey);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setServerError(null);
    const grants: RolePermissionCell[] = Array.from(draft.entries()).map(([permissionKey, scope]) => ({
      permissionKey,
      scope,
    }));
    try {
      await updatePermissions.mutateAsync({
        roleId: role.id,
        body: { grants: grants.map(({ permissionKey, scope }) => ({ permissionKey, scope: scope as PermissionScope })) },
      });
      toast({ title: "Permissions saved", variant: "success" });
    } catch (error) {
      // Surface the server's privilege-escalation 403/validation error
      // clearly — both as a toast and an inline banner, since this is the
      // real enforcement point (CLAUDE.md §3.5).
      const problem =
        error && typeof error === "object" && "problem" in error
          ? (error as { problem: { detail?: string; title?: string; status?: number } }).problem
          : undefined;
      const description = problem?.detail ?? problem?.title ?? (error instanceof Error ? error.message : undefined);
      setServerError(description ?? "The server rejected this permission change.");
      toast({
        title: problem?.status === 403 ? "Permission change rejected" : "Couldn't save permissions",
        description,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="permission-matrix">
      {serverError ? (
        <Alert tone="danger" role="alert" data-testid="permission-matrix-server-error">
          {serverError}
        </Alert>
      ) : null}

      <p className="text-sm text-fg-muted">
        Toggle a permission on to grant this role full (org-wide) access to it, off to revoke it. Rows you can't grant
        yourself (because you don't hold that permission at full access) are disabled here as a guide — the server is the
        actual enforcement point and will reject any attempt to escalate beyond your own access.
      </p>

      {modules.length === 0 ? (
        <EmptyState title="No permissions in the catalog" description="Nothing to configure yet." />
      ) : (
        modules.map((moduleGroup) => (
          <div key={moduleGroup.module} className="rounded-md border border-border" data-testid="permission-matrix-module">
            <h2 className="border-b border-border bg-surface px-3 py-2 text-sm font-medium capitalize text-fg">
              {moduleGroup.module}
            </h2>
            <table className="w-full text-sm">
              <caption className="sr-only">Permissions for {moduleGroup.module}</caption>
              <thead>
                <tr className="border-b border-border text-left text-fg-muted">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Permission
                  </th>
                  <th scope="col" className="w-24 px-3 py-2 text-right font-medium">
                    Access
                  </th>
                </tr>
              </thead>
              <tbody>
                {moduleGroup.permissions.map((permission) => {
                  const granted = draft.has(permission.key);
                  const editorScope = editorScopeFor(permission.key);
                  const canGrant = editorScope === "all";
                  const toggleId = `perm-${permission.key}`;
                  return (
                    <tr key={permission.key} className="border-b border-border last:border-0" data-testid="permission-matrix-row">
                      <td className="px-3 py-2 align-middle">
                        <label htmlFor={toggleId} className="text-fg">
                          {permission.label}
                        </label>
                        <span className="ml-2 text-xs text-fg-subtle">{permission.key}</span>
                        {!canGrant ? (
                          <span className="ml-2 text-xs text-warning" data-testid={`permission-row-locked-${permission.key}`}>
                            {editorScope ? "(you only hold this at a limited scope)" : "(you don't hold this permission)"}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right align-middle">
                        <Switch
                          id={toggleId}
                          aria-label={`Grant ${permission.label}`}
                          checked={granted}
                          disabled={!canGrant || updatePermissions.isPending}
                          onCheckedChange={(checked) => handleToggle(permission.key, checked)}
                          data-testid={`permission-toggle-${permission.key}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button
          onClick={handleSave}
          disabled={!hasChanges}
          loading={updatePermissions.isPending}
          data-testid="permission-matrix-save"
        >
          Save permissions
        </Button>
      </div>
    </div>
  );
}
