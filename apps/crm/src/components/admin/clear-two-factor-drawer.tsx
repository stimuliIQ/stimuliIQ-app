// Admin ▸ Users ▸ Clear 2FA — the staff rescue path for a user who has lost BOTH their
// authenticator and access to their inbox. Everyone else self-serves via the "Lost your
// authenticator?" link on the sign-in page (see components/auth/login-form.tsx).
//
// A drawer rather than a ConfirmDialog because the reason is MANDATORY server-side
// (min 10 chars) and lands in the audit log — ConfirmDialog takes no input. Gated on
// `twofa.reset`, which only super_admin/admin hold; the button is hidden otherwise, and
// the API enforces it regardless (CLAUDE.md §3.5).
import * as React from "react";
import { Alert, Button, Drawer, DrawerBody, DrawerContent, DrawerFooter, Textarea, useToast } from "@repo/ui";
import type { StaffUser } from "@repo/types";

import { useClearStaffUserTwoFactor } from "../../hooks/use-staff-users";
import { surfaceError } from "../../lib/surface-error";

const MIN_REASON_LENGTH = 10; // Mirrors AdminClearTwoFactorRequestSchema.

interface ClearTwoFactorDrawerProps {
  user: StaffUser | null;
  onOpenChange: (open: boolean) => void;
}

export function ClearTwoFactorDrawer({ user, onOpenChange }: ClearTwoFactorDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const clear = useClearStaffUserTwoFactor();
  const [reason, setReason] = React.useState("");
  // Reset-on-target-change via the render-phase `key` idiom rather than an effect: the
  // reason must never carry over from one user to the next (a justification written for
  // Priya must not silently end up in Ravi's audit row), and doing it here means the
  // stale value is never rendered even for a frame.
  const [lastUserId, setLastUserId] = React.useState<string | null>(null);
  if (user?.id !== lastUserId) {
    setLastUserId(user?.id ?? null);
    setReason("");
  }

  const tooShort = reason.trim().length < MIN_REASON_LENGTH;

  async function handleConfirm() {
    if (!user || tooShort) return;
    try {
      const result = await clear.mutateAsync({ id: user.id, reason: reason.trim() });
      toast({
        title: result.cleared ? "Two-factor authentication cleared" : "No two-factor authentication to clear",
        description: result.cleared
          ? `${user.name} has been signed out everywhere and can now sign in with their password alone. Ask them to re-enrol immediately.`
          : `${user.name} did not have two-factor authentication enabled.`,
        variant: result.cleared ? "success" : "default",
      });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't clear two-factor authentication");
    }
  }

  return (
    <Drawer open={Boolean(user)} onOpenChange={onOpenChange}>
      <DrawerContent
        position="center"
        title="Clear two-factor authentication"
        description={user ? `${user.name} — ${user.email}` : undefined}
        data-testid="user-clear-2fa-drawer"
      >
        <DrawerBody className="flex flex-col gap-4">
          <Alert tone="warning" title="This removes a security factor">
            {user?.name ?? "This user"} will be signed out everywhere and will be able to sign in with their password
            alone until they enrol a new authenticator. Confirm their identity through a channel other than email
            before doing this.
          </Alert>
          <Textarea
            label="Reason"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Verified over a video call — lost phone and no access to their inbox."
            helperText={`Recorded in the audit log against your account. At least ${MIN_REASON_LENGTH} characters.`}
            data-testid="user-clear-2fa-reason"
          />
        </DrawerBody>
        <DrawerFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="user-clear-2fa-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            loading={clear.isPending}
            disabled={tooShort}
            data-testid="user-clear-2fa-submit"
          >
            Clear 2FA
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
