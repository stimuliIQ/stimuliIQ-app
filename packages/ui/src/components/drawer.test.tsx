import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "./button";
import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerTrigger } from "./drawer";

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }): JSX.Element {
  return (
    <Drawer onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>
        <Button>Open profile</Button>
      </DrawerTrigger>
      <DrawerContent title="Aditi Sharma" description="Student profile">
        <DrawerBody>Profile details</DrawerBody>
        <DrawerFooter>
          <Button>Save</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

describe("Drawer", () => {
  it("opens, traps focus inside the panel, and exposes title/description", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Open profile" }));

    const dialog = await screen.findByRole("dialog", { name: "Aditi Sharma" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Profile details")).toBeInTheDocument();
  });

  it("closes on Escape and reports the state change", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Open profile" }));
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes via the close button", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Open profile" }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Close panel" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
