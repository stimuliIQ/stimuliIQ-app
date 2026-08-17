import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tooltip } from "./tooltip";

describe("Tooltip", () => {
  it("renders the label text alongside the trigger", () => {
    render(
      <Tooltip label="Edit">
        <button type="button" aria-label="Edit Phanendra Gandi">
          icon
        </button>
      </Tooltip>,
    );

    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Phanendra Gandi" })).toBeInTheDocument();
  });

  it("hides the label from assistive tech so the trigger's name is not announced twice", () => {
    const { container } = render(
      <Tooltip label="Delete">
        <button type="button" aria-label="Delete Phanendra Gandi">
          icon
        </button>
      </Tooltip>,
    );

    // The visible label must not add a second accessible name to the button.
    expect(screen.getByRole("button", { name: "Delete Phanendra Gandi" })).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("Delete");
  });

  it("is invisible until hover or keyboard focus", () => {
    render(
      <Tooltip label="Clear 2FA">
        <button type="button" aria-label="Clear two-factor authentication">
          icon
        </button>
      </Tooltip>,
    );

    const label = screen.getByText("Clear 2FA");
    expect(label.className).toContain("invisible");
    expect(label.className).toContain("group-hover:visible");
    expect(label.className).toContain("group-focus-within:visible");
  });

  it("never intercepts pointer events aimed at the control it labels", () => {
    render(
      <Tooltip label="Deactivate">
        <button type="button" aria-label="Deactivate Phanendra Gandi">
          icon
        </button>
      </Tooltip>,
    );

    expect(screen.getByText("Deactivate").className).toContain("pointer-events-none");
  });

  it("supports rendering below the trigger", () => {
    render(
      <Tooltip label="Edit" side="bottom">
        <button type="button" aria-label="Edit row">
          icon
        </button>
      </Tooltip>,
    );

    expect(screen.getByText("Edit").className).toContain("top-full");
  });
});
