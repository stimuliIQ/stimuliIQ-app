import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ActionMenu, type ActionMenuItem } from "./action-menu";

function items(overrides: Partial<ActionMenuItem>[] = []): ActionMenuItem[] {
  const base: ActionMenuItem[] = [
    { id: "edit", label: "Edit", onSelect: vi.fn() },
    { id: "delete", label: "Delete", tone: "danger", separatorBefore: true, onSelect: vi.fn() },
  ];
  return base.map((item, i) => ({ ...item, ...(overrides[i] ?? {}) }));
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Actions for Priya Sharma" }));
  await screen.findByRole("menu");
}

describe("ActionMenu", () => {
  it("names the trigger after its subject so rows are distinguishable", () => {
    render(<ActionMenu triggerLabel="Actions for Priya Sharma" items={items()} />);
    expect(screen.getByRole("button", { name: "Actions for Priya Sharma" })).toBeInTheDocument();
  });

  it("renders nothing when there are no items — an empty menu is worse than no menu", () => {
    const { container } = render(<ActionMenu triggerLabel="Actions for Priya Sharma" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each item by NAME once opened", async () => {
    const user = userEvent.setup();
    render(<ActionMenu triggerLabel="Actions for Priya Sharma" items={items()} />);
    await open(user);

    expect(screen.getByRole("menuitem", { name: /Edit/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Delete/i })).toBeInTheDocument();
  });

  it("fires the item's handler on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ActionMenu triggerLabel="Actions for Priya Sharma" items={items([{ onSelect }])} />);
    await open(user);

    await user.click(screen.getByRole("menuitem", { name: /Edit/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("is operable by keyboard alone", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <ActionMenu
        triggerLabel="Actions for Priya Sharma"
        items={items([{ onSelect: onEdit }, { onSelect: onDelete }])}
      />,
    );

    await user.tab();
    expect(screen.getByRole("button", { name: "Actions for Priya Sharma" })).toHaveFocus();

    // Opening via the keyboard lands focus on the FIRST item, so one ArrowDown reaches the
    // second. Asserting the exact landing point is the point: a menu that opens with
    // nothing focused forces a keyboard user to guess.
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    expect(screen.getByRole("menuitem", { name: /Edit/i })).toHaveFocus();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("does not fire a disabled item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ActionMenu triggerLabel="Actions for Priya Sharma" items={items([{ onSelect, disabled: true }])} />,
    );
    await open(user);

    await user.click(screen.getByRole("menuitem", { name: /Edit/i }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders an item's description alongside its label", async () => {
    const user = userEvent.setup();
    render(
      <ActionMenu
        triggerLabel="Actions for Priya Sharma"
        items={items([{ description: "Change their name or roles" }])}
      />,
    );
    await open(user);

    expect(screen.getByText("Change their name or roles")).toBeInTheDocument();
  });
});
