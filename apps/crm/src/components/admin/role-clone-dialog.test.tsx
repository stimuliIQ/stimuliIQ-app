// Copying a role, from the reviewer's side of the glass.
//
// The behaviour worth pinning here is the KEY DERIVATION and the moment it stops: the key is
// permanent once created and its rules are not obvious, so the form previews what will be
// stored rather than rejecting it after submit — but the instant somebody edits the key by
// hand, the name must stop overwriting their choice. Getting that backwards produces a field
// that silently discards what you typed, which is the most infuriating kind of form bug.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@repo/ui";
import type { Role } from "@repo/types";

const cloneMutateAsync = vi.fn();
vi.mock("../../hooks/use-roles", () => ({
  useCloneRole: () => ({ mutateAsync: cloneMutateAsync, isPending: false }),
}));

import { RoleCloneDialog, roleKeyFromName } from "./role-clone-dialog";

const SOURCE: Role = {
  id: "role-1",
  key: "branch_manager",
  name: "Branch Manager",
  isSystem: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderDialog(source: Role | null = SOURCE) {
  return render(
    <ToastProvider>
      <RoleCloneDialog source={source} onOpenChange={() => {}} />
    </ToastProvider>,
  );
}

describe("roleKeyFromName", () => {
  it("turns a display name into the key the API will accept", () => {
    expect(roleKeyFromName("Branch Manager (copy)")).toBe("branch_manager_copy");
  });

  it("never starts a key with a digit, which the API rejects", () => {
    // The server's rule is /^[a-z][a-z0-9_]*$/. A name like "2nd Line Support" would
    // otherwise produce a key that fails validation only after submit.
    expect(roleKeyFromName("2nd Line Support")).toMatch(/^[a-z]/);
  });

  it("collapses punctuation rather than leaving trailing separators", () => {
    expect(roleKeyFromName("Finance — Regional!!")).toBe("finance_regional");
  });
});

describe("RoleCloneDialog", () => {
  beforeEach(() => {
    cloneMutateAsync.mockReset();
    cloneMutateAsync.mockResolvedValue({ ...SOURCE, id: "role-2", key: "k", name: "N" });
  });

  it("suggests a name and derives the key from it", () => {
    renderDialog();

    expect(screen.getByTestId("role-clone-name")).toHaveValue("Branch Manager (copy)");
    expect(screen.getByTestId("role-clone-key")).toHaveValue("branch_manager_copy");
  });

  it("keeps the key in step while the name is edited", async () => {
    const user = userEvent.setup();
    renderDialog();

    const nameInput = screen.getByTestId("role-clone-name");
    await user.clear(nameInput);
    await user.type(nameInput, "Regional Lead");

    expect(screen.getByTestId("role-clone-key")).toHaveValue("regional_lead");
  });

  it("STOPS deriving once the key is edited by hand", async () => {
    // The important half. A form that keeps overwriting what somebody typed is worse than
    // one that never helped.
    const user = userEvent.setup();
    renderDialog();

    const keyInput = screen.getByTestId("role-clone-key");
    await user.clear(keyInput);
    await user.type(keyInput, "custom_key");

    const nameInput = screen.getByTestId("role-clone-name");
    await user.clear(nameInput);
    await user.type(nameInput, "Something Else");

    expect(screen.getByTestId("role-clone-key")).toHaveValue("custom_key");
  });

  it("sends the source id with the new name and key", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByTestId("role-clone-submit"));

    expect(cloneMutateAsync).toHaveBeenCalledWith({
      id: "role-1",
      body: { key: "branch_manager_copy", name: "Branch Manager (copy)" },
    });
  });

  it("won't submit with an empty key", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(screen.getByTestId("role-clone-key"));

    expect(screen.getByTestId("role-clone-submit")).toBeDisabled();
  });

  it("says up front that a copy is bounded by what the actor holds", () => {
    // Surfaced before they name it, rather than as a 403 after. The server refuses the whole
    // copy rather than quietly making a weaker one, and somebody needs to know which.
    renderDialog();

    expect(screen.getByText(/only copy what you hold/i)).toBeInTheDocument();
  });
});
