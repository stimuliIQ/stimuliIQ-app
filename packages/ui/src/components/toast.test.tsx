import type { JSX } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "./button";
import { ToastProvider, useToast } from "./toast";

function Harness(): JSX.Element {
  const { toast } = useToast();
  return (
    <Button
      onClick={() =>
        toast({ title: "Saved", description: "Your changes were saved.", variant: "success" })
      }
    >
      Trigger toast
    </Button>
  );
}

describe("Toast", () => {
  it("announces a toast via the imperative API and allows dismissal", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Trigger toast" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Your changes were saved.")).toBeInTheDocument();

    const dismiss = screen.getByRole("button", { name: "Dismiss notification" });
    await user.click(dismiss);
  });
});
