// Copy a role, matrix and all.
//
// WHY THIS EXISTS: building a role "like Counsellor but without deletes" meant creating one
// blank and re-ticking several dozen checkboxes by eye against another screen. That is the
// kind of task people get subtly wrong and never find out about, because a permission that
// should be on and is not surfaces as a 403 for somebody else, weeks later.
//
// THE DIALOG ASKS FOR BOTH FIELDS AND PREFILLS NEITHER BLINDLY. The name is suggested
// ("Counsellor (copy)") because it is the label staff read and a suggestion is easy to
// replace; the key is DERIVED from the name as you type, because it is immutable once
// created and the rules on it are not obvious. Showing what will be stored beats rejecting
// it after submit — the same call the course-types form makes.
//
// It deliberately does NOT show or let you edit the permissions being copied. A clone is a
// faithful copy; editing the matrix is the next screen, on the role that now exists. Letting
// somebody trim grants here would make "clone" mean two different things depending on what
// they touched.
import * as React from "react";
import { Alert, Button, Input, Modal, useToast } from "@repo/ui";
import type { Role } from "@repo/types";

import { useCloneRole } from "../../hooks/use-roles";
import { surfaceError } from "../../lib/surface-error";

export interface RoleCloneDialogProps {
  /** The role being copied. `null` closes the dialog. */
  source: Role | null;
  onOpenChange: (open: boolean) => void;
  /** Called with the new role so the caller can select it and show its matrix. */
  onCloned?: (created: Role) => void;
}

/**
 * "Branch Manager (copy)" -> "branch_manager_copy".
 *
 * Mirrors the server's key rules (lowercase, snake_case, must start with a letter) so the
 * preview cannot suggest something the API will reject.
 */
export function roleKeyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([^a-z])/, "role_$1")
    .slice(0, 60);
}

export function RoleCloneDialog({
  source,
  onOpenChange,
  onCloned,
}: RoleCloneDialogProps): React.JSX.Element {
  const { toast } = useToast();
  const clone = useCloneRole();

  const [name, setName] = React.useState("");
  /** Set once the user edits the key by hand, after which the name stops driving it. */
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [key, setKey] = React.useState("");

  React.useEffect(() => {
    const suggested = source ? `${source.name} (copy)` : "";
    setName(suggested);
    setKey(roleKeyFromName(suggested));
    setKeyTouched(false);
  }, [source?.id, source?.name]);

  function handleNameChange(next: string): void {
    setName(next);
    if (!keyTouched) setKey(roleKeyFromName(next));
  }

  async function handleSubmit(): Promise<void> {
    if (!source || !name.trim() || !key.trim()) return;
    try {
      const created = await clone.mutateAsync({
        id: source.id,
        body: { key: key.trim(), name: name.trim() },
      });
      toast({
        title: "Role copied",
        description: `${created.name} has the same permissions as ${source.name}. Edit them from the matrix.`,
        variant: "success",
      });
      onCloned?.(created);
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't copy this role");
    }
  }

  return (
    <Modal
      open={Boolean(source)}
      onOpenChange={(next: boolean) => !next && onOpenChange(false)}
      title={source ? `Copy ${source.name}` : "Copy role"}
      data-testid="role-clone-dialog"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={clone.isPending}
            disabled={!name.trim() || !key.trim()}
            data-testid="role-clone-submit"
          >
            Copy role
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          The new role starts with exactly the permissions {source?.name} has today. Changing either
          one afterwards leaves the other alone.
        </p>

        <Input
          label="Name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          data-testid="role-clone-name"
          required
        />

        <Input
          label="Key"
          value={key}
          onChange={(e) => {
            setKeyTouched(true);
            setKey(e.target.value);
          }}
          helperText="Lowercase, no spaces. This is permanent — the name can be changed later, the key can't."
          data-testid="role-clone-key"
          required
        />

        {/*
            Stated up front rather than left to a 403. Somebody copying a role more
            privileged than themselves needs to know why it will be refused BEFORE they
            name it, and the server refuses the whole copy rather than quietly making a
            weaker one.
          */}
        <Alert tone="info" title="You can only copy what you hold">
          If {source?.name ?? "this role"} has a permission you don&apos;t have yourself, the copy
          is refused rather than made without it.
        </Alert>
      </div>
    </Modal>
  );
}
