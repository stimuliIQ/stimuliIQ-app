// Permission editor — the headline Admin feature (docs/03 §7.16/§9).
//
// SHAPED LIKE THE SIDEBAR, NOT LIKE THE DATABASE. The catalog is ~200 `module.action`
// keys; listing them grouped by module, which is what this screen used to do, asks the
// administrator to already know the schema. So the tree here mirrors the CRM's own
// navigation (see lib/permission-screens.ts): a sidebar SECTION opens to the SCREENS in
// it, each screen has one toggle meaning "this role can open it", and switching that on
// reveals what they may DO there — add, edit, delete, export and the rest.
//
// TWO RULES MAKE THE TREE HONEST:
//  1. Turning a screen off also drops its action grants. "Can edit a screen they cannot
//     open" is not a state worth being able to save by accident.
//  2. A role that ALREADY holds actions without the screen's view permission (possible
//     from an older seed) keeps them: that row renders expanded with a warning instead of
//     silently discarding grants the editor did not put there.
//
// ON/OFF, NOT SCOPE. ON grants at "all" (org-wide), OFF revokes (product decision — the
// scope picker was removed). Grants a role already holds at a NARROWER scope are preserved
// until explicitly toggled off; flipping a row ON always (re)grants at "all". Saves via the
// full-replace `updatePermissions` mutation (hooks/use-roles.ts) — which is exactly why
// permission-screens.ts computes its leftovers from the live catalog rather than from a
// hand-written list: anything this component fails to render would be REVOKED on the next
// save, not merely hidden.
//
// RBAC-aware disabling: because ON means "all", a row is only enable-able when the EDITOR
// holds that permission at "all" scope themselves; otherwise it renders disabled with a
// hint. This is a UX guide only. The SERVER is the actual privilege-escalation enforcement
// point (CLAUDE.md §3.5; @repo/types crm/admin.schemas.ts file header) and will reject
// (403) any attempt to grant something broader than the editor's own resolved permission —
// that 403 is surfaced via the toast + inline banner below, it is not prevented
// client-side as the source of truth.
import * as React from "react";
import {
  Alert,
  Button,
  CollapsibleSection,
  EmptyState,
  InfoHint,
  Input,
  Skeleton,
  StatusChip,
  Switch,
  useToast,
} from "@repo/ui";
import type { MeResponse, PermissionCatalogEntry, PermissionScope, RolePermissionCell, Role } from "@repo/types";

import { usePermissionCatalog, useRolePermissions, useUpdateRolePermissions } from "../../hooks/use-roles";
import { describePermission } from "../../lib/permission-help";
import { errorStatus, queryErrorMessage } from "../../lib/surface-error";
import { buildPermissionModel, type PermissionActionRow, type PermissionScreenRow } from "../../lib/permission-screens";

// ON grants the permission at "all" (org-wide) scope; OFF revokes it.
const GRANT_SCOPE: PermissionScope = "all";

interface RolePermissionMatrixProps {
  role: Role;
  me: MeResponse | undefined;
}

function matches(query: string, ...haystack: string[]): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return haystack.some((value) => value.toLowerCase().includes(needle));
}

export function RolePermissionMatrix({ role, me }: RolePermissionMatrixProps): React.JSX.Element {
  const { toast } = useToast();
  const {
    data: catalog,
    isLoading: catalogLoading,
    isError: catalogError,
    error: catalogFetchError,
    refetch: refetchCatalog,
  } = usePermissionCatalog();
  const {
    data: rolePermissions,
    isLoading: grantsLoading,
    isError: grantsError,
    error: grantsFetchError,
    refetch: refetchGrants,
  } = useRolePermissions(role.id);
  const updatePermissions = useUpdateRolePermissions();

  // Local editable draft of grants, keyed by permissionKey -> scope (or undefined when not
  // granted). Reset whenever the role or its loaded grants change.
  const [draft, setDraft] = React.useState<Map<string, PermissionScope>>(new Map());
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!rolePermissions) return;
    const next = new Map<string, PermissionScope>();
    for (const grant of rolePermissions.grants) {
      if (grant.scope) next.set(grant.permissionKey, grant.scope);
    }
    setDraft(next);
    setServerError(null);
  }, [rolePermissions]);

  // Every hook must run BEFORE the loading/error early returns below — a hook that only
  // runs on some renders violates the Rules of Hooks ("rendered more hooks than during the
  // previous render") and crashes when a role switch flips this component through its
  // loading state.
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

  const entries: PermissionCatalogEntry[] = React.useMemo(
    () => (catalog?.modules ?? []).flatMap((group) => group.permissions),
    [catalog],
  );
  const model = React.useMemo(() => buildPermissionModel(entries), [entries]);

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
        description={queryErrorMessage(
          catalogFetchError ?? grantsFetchError,
          "Something went wrong fetching the permission catalog or this role's grants.",
        )}
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

  /**
   * The editor's own scope for a permission (or undefined if they don't hold it). Since ON
   * grants at "all", a row is only enable-able when the editor holds the permission at
   * "all" too — UX-guide only (see file header); the server is the actual escalation guard.
   */
  const editorScopeFor = (permissionKey: string): PermissionScope | undefined =>
    (me?.permissions ?? []).find((g) => g.key === permissionKey)?.scope;

  const setGrant = (permissionKey: string, checked: boolean, alsoRevoke: string[] = []) => {
    setDraft((current) => {
      const next = new Map(current);
      if (checked) {
        next.set(permissionKey, GRANT_SCOPE);
      } else {
        next.delete(permissionKey);
        // Rule 1 (file header): what you cannot open, you cannot act on.
        for (const key of alsoRevoke) next.delete(key);
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
      // Surface the server's privilege-escalation 403/validation error clearly — both as a
      // toast and an inline banner, since this is the real enforcement point (CLAUDE.md §3.5).
      const description = queryErrorMessage(error, "The server rejected this permission change.");
      setServerError(description);
      toast({
        title: errorStatus(error) === 403 ? "Permission change rejected" : "Couldn't save permissions",
        description,
        variant: "destructive",
      });
    }
  };

  /** One permission: a switch, its plain-English label, its help, and its raw key. */
  const renderToggle = (
    permission: PermissionActionRow,
    options: { onChange?: (checked: boolean) => void } = {},
  ): React.JSX.Element => {
    const granted = draft.has(permission.key);
    const editorScope = editorScopeFor(permission.key);
    const canGrant = editorScope === "all";
    const toggleId = `perm-${permission.key}`;
    return (
      <div key={permission.key} className="flex flex-wrap items-center gap-2 py-1" data-testid="permission-matrix-row">
        <Switch
          id={toggleId}
          aria-label={`Grant ${permission.label}`}
          checked={granted}
          disabled={!canGrant || updatePermissions.isPending}
          onCheckedChange={(checked) =>
            options.onChange ? options.onChange(checked) : setGrant(permission.key, checked)
          }
          data-testid={`permission-toggle-${permission.key}`}
        />
        <label htmlFor={toggleId} className="text-sm text-fg">
          {permission.label}
        </label>
        <InfoHint label={permission.label}>{describePermission(permission.key, permission.label)}</InfoHint>
        <span className="text-xs text-fg-subtle">{permission.key}</span>
        {!canGrant ? (
          <span className="text-xs text-warning" data-testid={`permission-row-locked-${permission.key}`}>
            {editorScope ? "(you only hold this at a limited scope)" : "(you don't hold this permission)"}
          </span>
        ) : null}
      </div>
    );
  };

  const renderScreen = (screen: PermissionScreenRow): React.JSX.Element => {
    const label = screen.screens.join(", ");
    const granted = draft.has(screen.gate);
    // Rule 2 (file header): actions granted without the screen's view permission are shown,
    // never quietly dropped — the role really does hold them until somebody says otherwise.
    const orphanActions = !granted && screen.actions.some((action) => draft.has(action.key));
    const visibleActions = screen.actions.filter((action) => matches(query, action.label, action.key, label));
    const showActions = (granted || orphanActions) && visibleActions.length > 0;

    return (
      <div key={screen.gate} className="border-b border-border px-4 py-2 last:border-0" data-testid="permission-screen">
        {renderToggle(
          { key: screen.gate, label },
          { onChange: (checked) => setGrant(screen.gate, checked, screen.actions.map((action) => action.key)) },
        )}
        <div className="ml-11 flex flex-wrap items-center gap-x-3 text-xs text-fg-subtle">
          {screen.path ? <span>{screen.path}</span> : null}
          {screen.offMenu ? <span className="text-warning">reachable by link, not on the menu</span> : null}
          {screen.alsoIn.length > 0 ? <span>also opens {screen.alsoIn.join(", ")}</span> : null}
        </div>
        {orphanActions ? (
          <p className="ml-11 mt-1 text-xs text-warning" data-testid={`permission-orphan-${screen.gate}`}>
            This role can act here but cannot open the screen. Switch it on, or turn the actions below off.
          </p>
        ) : null}
        {showActions ? (
          <div className="ml-11 mt-1 border-l border-border pl-3">
            {visibleActions.map((action) => renderToggle(action))}
          </div>
        ) : null}
      </div>
    );
  };

  // Filtering happens here rather than inside the model, so a search never changes which
  // permissions exist — only which are on screen. The draft is untouched by it.
  const visibleSections = model.sections
    .map((section) => ({
      ...section,
      screens: section.screens.filter(
        (screen) =>
          matches(query, section.label, screen.gate, ...screen.screens) ||
          screen.actions.some((action) => matches(query, action.label, action.key)),
      ),
    }))
    .filter((section) => section.screens.length > 0);

  const visibleExtras = model.extras
    .map((extra) => ({
      ...extra,
      permissions: extra.permissions.filter(
        (permission) => matches(query, extra.label) || matches(query, permission.label, permission.key),
      ),
    }))
    .filter((extra) => extra.permissions.length > 0);

  const nothingMatches = visibleSections.length === 0 && visibleExtras.length === 0;

  return (
    <div className="flex flex-col gap-3" data-testid="permission-matrix">
      {serverError ? (
        <Alert tone="danger" role="alert" data-testid="permission-matrix-server-error">
          {serverError}
        </Alert>
      ) : null}

      <p className="text-sm text-fg-muted">
        These are the sections of the CRM menu. Switch a screen on to let this role open it, then choose what they can
        do there. Switching a screen off also removes its actions. Press any info icon for a plain-English explanation.
        Rows you can't grant yourself are disabled as a guide; the server is the real enforcement point and rejects any
        attempt to go beyond your own access.
      </p>

      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find a screen or a permission"
        aria-label="Find a screen or a permission"
        data-testid="permission-matrix-search"
      />

      {nothingMatches ? (
        <EmptyState
          title={query ? "Nothing matches that search" : "No permissions in the catalog"}
          description={
            query ? "Try a screen name, an action, or part of a permission key." : "Nothing to configure yet."
          }
        />
      ) : null}

      {visibleSections.map((section, index) => {
        const grantedCount = section.screens.filter((screen) => draft.has(screen.gate)).length;
        const previousCaption = index > 0 ? visibleSections[index - 1]?.caption : undefined;
        return (
          <React.Fragment key={section.label}>
            {section.caption && section.caption !== previousCaption ? (
              <p className="pt-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{section.caption}</p>
            ) : null}
            <CollapsibleSection
              data-testid="permission-matrix-module"
              // Open where there is something to see: a section this role already reaches,
              // or one the current search matched.
              defaultOpen={grantedCount > 0 || query.length > 0}
              header={
                <>
                  <span className="truncate font-medium">{section.label}</span>
                  <StatusChip
                    tone={grantedCount > 0 ? "success" : "neutral"}
                    label={`${grantedCount} of ${section.screens.length}`}
                  />
                </>
              }
              bodyClassName="p-0"
            >
              {section.screens.map(renderScreen)}
            </CollapsibleSection>
          </React.Fragment>
        );
      })}

      {visibleExtras.length > 0 ? (
        <p className="pt-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Not part of the CRM menu</p>
      ) : null}

      {visibleExtras.map((extra) => {
        const grantedCount = extra.permissions.filter((permission) => draft.has(permission.key)).length;
        return (
          <CollapsibleSection
            key={extra.id}
            data-testid="permission-matrix-extra"
            defaultOpen={grantedCount > 0 || query.length > 0}
            header={
              <>
                <span className="truncate font-medium">{extra.label}</span>
                <StatusChip
                  tone={grantedCount > 0 ? "success" : "neutral"}
                  label={`${grantedCount} of ${extra.permissions.length}`}
                />
              </>
            }
          >
            <p className="mb-2 text-xs text-fg-muted">{extra.description}</p>
            {extra.permissions.map((permission) => renderToggle(permission))}
          </CollapsibleSection>
        );
      })}

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
