// Top bar — global search/command-palette + branch switcher + notifications +
// profile/logout (docs/03 §10). The branch switcher is a real global scope
// filter (see app/branch-scope.tsx): picking a branch here moves every
// branch-aware list/dashboard in the CRM. It only renders for users who hold
// `branches.view`. The notifications bell stays a disabled placeholder (the
// notification center lives at the sidebar's Notifications route).
import * as React from "react";
import { Building2, Menu } from "lucide-react";
import { Select, SelectItem } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { useBranchScope } from "../../app/branch-scope";
import { ChangePasswordDialog } from "../account/change-password-dialog";
import { AccountMenu } from "./account-menu";
import { CommandPalette } from "./command-palette";
import { NotificationsBell } from "./notifications-bell";

interface TopbarProps {
  me: MeResponse | undefined;
  onLogout: () => void;
  loggingOut: boolean;
  /** Opens the off-canvas sidebar. Only rendered below `lg`, where the nav is a drawer. */
  onOpenMobileNav: () => void;
}

export function Topbar({ me, onLogout, loggingOut, onOpenMobileNav }: TopbarProps): React.JSX.Element {
  const { branches, canFilterBranch, selectedBranchId, setSelectedBranchId } = useBranchScope();
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false);

  return (
    <header
      data-testid="crm-topbar"
      className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:gap-4 sm:px-4"
    >
      {/* The only way into the nav below `lg`. It carries `aria-controls` rather than
          `aria-expanded` because the sidebar is always mounted (it slides), so "expanded"
          would be a claim about position, not about existence. */}
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open menu"
        aria-controls="crm-sidebar"
        data-testid="topbar-menu-button"
        className="-ml-1 shrink-0 rounded-md p-2 text-fg-muted transition-colors duration-fast hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <div className="min-w-0 flex-1">
        <CommandPalette />
      </div>

      {/* Global branch scope — picking a branch here filters every branch-aware
          screen in the CRM. Only shown to users who can view branches. */}
      {canFilterBranch ? (
        <div className="hidden items-center gap-1.5 text-fg-subtle md:flex">
          <Building2 className="size-4 shrink-0" aria-hidden="true" />
          <Select
            aria-label="Branch scope"
            placeholder="All branches"
            value={selectedBranchId ?? "__all__"}
            onValueChange={(value) =>
              setSelectedBranchId(value === "__all__" ? undefined : value)
            }
            wrapperClassName="w-48"
            data-testid="branch-switcher"
          >
            <SelectItem value="__all__">All branches</SelectItem>
            {branches.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name}
              </SelectItem>
            ))}
          </Select>
        </div>
      ) : null}

      {/* Live notifications. Was a disabled placeholder until lead assignment gave the
          CRM its first event a person genuinely needs to be TOLD about rather than go
          looking for. Backed by /me/notifications, which every role already holds
          `notifications.view` (own) for. */}
      <NotificationsBell />

      <AccountMenu
        name={me?.user.name ?? "-"}
        roles={me?.roles.join(", ") ?? ""}
        avatarUrl={me?.user.avatar ?? null}
        loggingOut={loggingOut}
        onChangePassword={() => setChangePasswordOpen(true)}
        onLogout={onLogout}
      />

      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </header>
  );
}
