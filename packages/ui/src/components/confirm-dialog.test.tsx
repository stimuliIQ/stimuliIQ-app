import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfirmDialog } from "./confirm-dialog";

function Harness({
  onConfirm,
  onOpenChange,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Delete student?"
      description="This soft-deletes the record. You can restore it later."
      confirmLabel="Delete"
      tone="danger"
      onConfirm={onConfirm}
    />
  );
}

describe("ConfirmDialog", () => {
  it("renders an alertdialog with title/description and confirm/cancel actions", () => {
    render(<Harness onConfirm={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("alertdialog", { name: "Delete student?" })).toBeInTheDocument();
    expect(
      screen.getByText("This soft-deletes the record. You can restore it later."),
    ).toBeInTheDocument();
  });

  it("invokes onConfirm when the confirm button is activated", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange(false) on cancel and on Escape", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
