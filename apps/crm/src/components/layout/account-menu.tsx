// Topbar account menu — replaces the old bare name/roles + standalone sign-out
// icon button with a single accessible dropdown (docs/03 §10). No @repo/ui
// dropdown/menu primitive exists yet (only ConfirmDialog/Drawer are built on
// Radix); this hand-rolls the same open/outside-click/Escape pattern already
// used by NotificationBell (packages/ui/src/components/notification-bell.tsx),
// plus roving arrow-key navigation between the two menu items.
//
// data-testid contract preserved for existing/e2e coverage: `topbar-user-name`,
// `topbar-user-roles`, `topbar-logout` (now a menu item instead of an icon button).
import * as React from "react";
import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import { Button, cn } from "@repo/ui";

export interface AccountMenuProps {
  name: string;
  roles: string;
  loggingOut: boolean;
  onChangePassword: () => void;
  onLogout: () => void;
}

export function AccountMenu({
  name,
  roles,
  loggingOut,
  onChangePassword,
  onLogout,
}: AccountMenuProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const close = React.useCallback((refocusTrigger: boolean) => {
    setOpen(false);
    if (refocusTrigger) triggerRef.current?.focus();
  }, []);

  // Focus the first item on open; wire Escape + outside-click to close + arrow
  // keys to move focus between items (mirrors NotificationBell's pattern, plus
  // roving focus since this is a real ARIA menu, not just a list).
  React.useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();

    function items(): HTMLButtonElement[] {
      return itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    }

    function focusBy(delta: number): void {
      const list = items();
      if (list.length === 0) return;
      const currentIndex = list.findIndex((el) => el === document.activeElement);
      const nextIndex = (currentIndex + delta + list.length) % list.length;
      list[nextIndex]?.focus();
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        focusBy(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusBy(-1);
      } else if (event.key === "Home") {
        event.preventDefault();
        items()[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items().at(-1)?.focus();
      }
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, close]);

  return (
    <div className="relative border-l border-border pl-4">
      <button
        ref={triggerRef}
        type="button"
        data-testid="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5 text-left",
          "transition-colors hover:bg-surface",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        )}
      >
        <span className="text-right">
          <p className="text-sm font-medium text-fg" data-testid="topbar-user-name">
            {name}
          </p>
          <p className="text-xs text-fg-muted" data-testid="topbar-user-roles">
            {roles}
          </p>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div
          id="account-menu"
          ref={menuRef}
          role="menu"
          aria-label="Account"
          aria-orientation="vertical"
          data-testid="account-menu"
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden",
            "rounded-lg border border-border bg-card py-1 shadow-md",
            "animate-in fade-in slide-in-from-top-2 duration-[150ms]",
          )}
        >
          <Button
            ref={(el) => {
              itemRefs.current[0] = el;
            }}
            type="button"
            variant="ghost"
            role="menuitem"
            data-testid="account-menu-change-password"
            className="h-9 w-full justify-start rounded-none px-3 text-fg"
            onClick={() => {
              close(false);
              onChangePassword();
            }}
          >
            <KeyRound className="size-4" aria-hidden="true" />
            Change password
          </Button>
          <Button
            ref={(el) => {
              itemRefs.current[1] = el;
            }}
            type="button"
            variant="ghost"
            role="menuitem"
            data-testid="topbar-logout"
            loading={loggingOut}
            className="h-9 w-full justify-start rounded-none px-3 text-danger hover:text-danger"
            onClick={() => {
              close(false);
              onLogout();
            }}
          >
            {loggingOut ? (
              "Signing out…"
            ) : (
              <>
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </>
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
