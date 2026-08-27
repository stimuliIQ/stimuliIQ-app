import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InfoHint } from "./info-hint";

describe("InfoHint", () => {
  it("keeps the explanation closed until the icon is pressed", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="View students">Opens the Students list.</InfoHint>);

    expect(screen.queryByText("Opens the Students list.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "What does View students mean?" }));
    expect(screen.getByText("Opens the Students list.")).toBeInTheDocument();
  });

  it("reports its open state to assistive tech", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="View students">Opens the Students list.</InfoHint>);
    const trigger = screen.getByRole("button", { name: "What does View students mean?" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // The panel the trigger claims to control is the one that actually appeared.
    expect(document.getElementById(trigger.getAttribute("aria-controls") ?? "")).toHaveTextContent(
      "Opens the Students list.",
    );
  });

  it("closes on a second press", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="View students">Opens the Students list.</InfoHint>);
    const trigger = screen.getByRole("button", { name: "What does View students mean?" });

    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByText("Opens the Students list.")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="View students">Opens the Students list.</InfoHint>);

    await user.click(screen.getByRole("button", { name: "What does View students mean?" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Opens the Students list.")).not.toBeInTheDocument();
  });

  it("closes when something outside it is pressed", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <InfoHint label="View students">Opens the Students list.</InfoHint>
        <button type="button">Elsewhere</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "What does View students mean?" }));
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByText("Opens the Students list.")).not.toBeInTheDocument();
  });

  it("opens from the keyboard, so the help is not hover-only", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="View students">Opens the Students list.</InfoHint>);

    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Opens the Students list.")).toBeInTheDocument();
  });
});
