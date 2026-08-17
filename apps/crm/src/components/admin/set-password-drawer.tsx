// Admin ▸ Users ▸ Set new password — an admin types the replacement credential themselves,
// as opposed to "Reset password", which mints a random one and emails it to the holder.
//
// THESE ARE NOT THE SAME ACT, and the difference is who ends up knowing the password:
//
//   Reset password    — the value is generated server-side, never returned, and goes only to
//                       the account holder's inbox. The operator cannot sign in as them.
//   Set new password  — the operator CHOOSES the value, so the operator knows it and can
//                       sign in as that user until the holder changes it.
//
// The second is strictly more powerful and is offered because there are real situations that
// need it (handing over a shared account, restoring access for someone with no working
// inbox, verifying a login end-to-end). The dialog says so plainly rather than presenting
// the two as interchangeable — the whole reason this screen grew an action menu was that a
// credential action which did not say what it did got misread.
//
// A Drawer rather than a ConfirmDialog because this takes input: ConfirmDialog carries no
// fields. The confirmation field is client-side only; the API takes a single `password` and
// has no notion of "confirm", which is correct — a typo guard belongs at the keyboard, not
// in the wire contract.
import * as React from "react";
import {
  Alert,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  PasswordInput,
  PasswordRequirements,
  useToast,
} from "@repo/ui";
import { checkPasswordRules } from "@repo/types";
import type { StaffUser } from "@repo/types";

import { useUpdateStaffUser } from "../../hooks/use-staff-users";
import { surfaceError } from "../../lib/surface-error";

interface SetPasswordDrawerProps {
  user: StaffUser | null;
  onOpenChange: (open: boolean) => void;
}

export function SetPasswordDrawer({ user, onOpenChange }: SetPasswordDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const update = useUpdateStaffUser();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");

  // Reset-on-target-change via the render-phase update idiom, and null-normalised on both
  // sides — see clear-two-factor-drawer.tsx's comment for why comparing `user?.id` against a
  // `null` initial state loops forever. A password typed for one user must never carry over
  // to the next.
  const currentUserId = user?.id ?? null;
  const [lastUserId, setLastUserId] = React.useState<string | null>(null);
  if (currentUserId !== lastUserId) {
    setLastUserId(currentUserId);
    setPassword("");
    setConfirm("");
  }

  // The SAME rules the server validates with (PasswordSchema), evaluated from one shared
  // source so the checklist cannot promise something the API then rejects.
  const rules = checkPasswordRules(password);
  const meetsPolicy = rules.every((rule) => rule.met);
  // Only complain about a mismatch once there is something to mismatch — flagging it while
  // the field is still empty is noise, not help.
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = meetsPolicy && confirm.length > 0 && !mismatch;

  async function handleSubmit() {
    if (!user || !canSubmit) return;
    try {
      await update.mutateAsync({ id: user.id, body: { password } });
      toast({
        title: "Password updated",
        description: `${user.name} can now sign in with the new password. They've been signed out everywhere else.`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't update this password");
    }
  }

  return (
    <Drawer open={Boolean(user)} onOpenChange={onOpenChange}>
      <DrawerContent
        position="center"
        title="Set a new password"
        description={user ? `${user.name} — ${user.email}` : undefined}
        data-testid="user-set-password-drawer"
      >
        <DrawerBody className="flex flex-col gap-4">
          <Alert tone="warning" title="You will know this password">
            Unlike “Reset password”, which emails a one-time password only they see, you are choosing this value — so
            you can sign in as {user?.name ?? "this user"} until they change it. They will be signed out everywhere,
            and their current password stops working immediately. Share it through something other than email.
          </Alert>

          <div className="flex flex-col gap-2">
            <PasswordInput
              label="New password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="user-set-password-input"
            />
            <PasswordRequirements rules={rules} />
          </div>

          <PasswordInput
            label="Confirm new password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={mismatch ? "Both passwords must match" : undefined}
            data-testid="user-set-password-confirm-input"
          />
        </DrawerBody>
        <DrawerFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="user-set-password-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            loading={update.isPending}
            disabled={!canSubmit}
            data-testid="user-set-password-submit"
          >
            Update password
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
