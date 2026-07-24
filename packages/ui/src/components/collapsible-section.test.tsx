import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CollapsibleSection } from "./collapsible-section";

// ---------------------------------------------------------------------------
// Rendering / defaults
// ---------------------------------------------------------------------------

describe("CollapsibleSection — rendering", () => {
  it("renders with default data-testid='collapsible-section'", () => {
    render(
      <CollapsibleSection header="1. Hero">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("collapsible-section")).toBeInTheDocument();
  });

  it("always renders the header content", () => {
    render(
      <CollapsibleSection header={<span>1. Hero</span>}>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText("1. Hero")).toBeInTheDocument();
  });

  it("defaults to collapsed (defaultOpen=false)", () => {
    render(
      <CollapsibleSection header="1. Hero">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("collapsible-section-trigger")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByTestId("collapsible-section")).toHaveAttribute("data-state", "closed");
  });

  it("honors defaultOpen=true (uncontrolled)", () => {
    render(
      <CollapsibleSection header="1. Hero" defaultOpen>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("collapsible-section-trigger")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

// ---------------------------------------------------------------------------
// Critical constraint: body stays mounted while collapsed
// ---------------------------------------------------------------------------

describe("CollapsibleSection — mounted-while-collapsed constraint", () => {
  it("keeps children mounted in the DOM while collapsed", () => {
    render(
      <CollapsibleSection header="1. Hero">
        <input data-testid="live-field" defaultValue="" />
      </CollapsibleSection>,
    );
    // Collapsed by default, yet the field must already be in the document.
    expect(screen.getByTestId("live-field")).toBeInTheDocument();
  });

  it("preserves live form state (same DOM node, retained value) across collapse/expand cycles", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection header="1. Hero" defaultOpen>
        <input data-testid="live-field" defaultValue="" />
      </CollapsibleSection>,
    );

    const fieldBeforeToggle = screen.getByTestId("live-field");
    await user.type(fieldBeforeToggle, "Stimuliiq");
    expect(fieldBeforeToggle).toHaveValue("Stimuliiq");

    // Collapse
    await user.click(screen.getByTestId("collapsible-section-trigger"));
    const fieldWhileCollapsed = screen.getByTestId("live-field");
    // Same DOM node — proves this was a CSS collapse, not an unmount/remount.
    expect(fieldWhileCollapsed).toBe(fieldBeforeToggle);
    expect(fieldWhileCollapsed).toHaveValue("Stimuliiq");

    // Re-expand
    await user.click(screen.getByTestId("collapsible-section-trigger"));
    const fieldAfterReopen = screen.getByTestId("live-field");
    expect(fieldAfterReopen).toBe(fieldBeforeToggle);
    expect(fieldAfterReopen).toHaveValue("Stimuliiq");
  });

  it("marks the body inert while collapsed and not inert while open", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection header="1. Hero">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const body = screen.getByTestId("collapsible-section-body");
    expect(body).toHaveAttribute("inert");

    await user.click(screen.getByTestId("collapsible-section-trigger"));
    expect(body).not.toHaveAttribute("inert");
  });
});

// ---------------------------------------------------------------------------
// Toggle interaction — mouse + keyboard
// ---------------------------------------------------------------------------

describe("CollapsibleSection — toggle interaction", () => {
  it("toggles aria-expanded/data-state on trigger click (uncontrolled)", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection header="1. Hero">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const trigger = screen.getByTestId("collapsible-section-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("collapsible-section")).toHaveAttribute("data-state", "open");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles on Enter key", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection header="1. Hero">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const trigger = screen.getByTestId("collapsible-section-trigger");
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("toggles on Space key", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection header="1. Hero">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const trigger = screen.getByTestId("collapsible-section-trigger");
    trigger.focus();
    await user.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("calls onOpenChange with the next state", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <CollapsibleSection header="1. Hero" onOpenChange={onOpenChange}>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    await user.click(screen.getByTestId("collapsible-section-trigger"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});

// ---------------------------------------------------------------------------
// Controlled mode
// ---------------------------------------------------------------------------

describe("CollapsibleSection — controlled mode", () => {
  it("reflects the `open` prop rather than internal state", () => {
    const { rerender } = render(
      <CollapsibleSection header="1. Hero" open={false} onOpenChange={() => {}}>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("collapsible-section-trigger")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    rerender(
      <CollapsibleSection header="1. Hero" open={true} onOpenChange={() => {}}>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("collapsible-section-trigger")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("does not change aria-expanded on click if the parent ignores onOpenChange", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection header="1. Hero" open={false} onOpenChange={() => {}}>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const trigger = screen.getByTestId("collapsible-section-trigger");
    await user.click(trigger);
    // Parent never re-rendered with open=true, so the controlled value stays false.
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

// ---------------------------------------------------------------------------
// headerActions — must not toggle the section
// ---------------------------------------------------------------------------

describe("CollapsibleSection — headerActions", () => {
  it("renders headerActions as a sibling of the trigger, not toggling on click", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CollapsibleSection
        header="1. Hero"
        onOpenChange={onOpenChange}
        headerActions={
          <button type="button" data-testid="remove-block" onClick={onRemove}>
            Remove
          </button>
        }
      >
        <p>Body content</p>
      </CollapsibleSection>,
    );

    await user.click(screen.getByTestId("remove-block"));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("collapsible-section-trigger")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("headerActions are not nested inside the toggle <button>", () => {
    render(
      <CollapsibleSection
        header="1. Hero"
        headerActions={<button data-testid="remove-block">Remove</button>}
      >
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const trigger = screen.getByTestId("collapsible-section-trigger");
    const action = screen.getByTestId("remove-block");
    expect(trigger.contains(action)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// a11y wiring
// ---------------------------------------------------------------------------

describe("CollapsibleSection — a11y", () => {
  it("aria-controls on the trigger matches the body element's id", () => {
    render(
      <CollapsibleSection header="1. Hero">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const trigger = screen.getByTestId("collapsible-section-trigger");
    const body = screen.getByTestId("collapsible-section-body");
    expect(trigger.getAttribute("aria-controls")).toBe(body.id);
  });

  it("body has role=region and aria-labelledby pointing at the trigger's id", () => {
    render(
      <CollapsibleSection header="1. Hero">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const trigger = screen.getByTestId("collapsible-section-trigger");
    const body = screen.getByTestId("collapsible-section-body");
    expect(body).toHaveAttribute("role", "region");
    expect(body.getAttribute("aria-labelledby")).toBe(trigger.id);
  });

  it("the chevron icon is aria-hidden", () => {
    const { container } = render(
      <CollapsibleSection header="1. Hero">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("the leading icon chip is aria-hidden", () => {
    render(
      <CollapsibleSection header="1. Hero" icon={<span data-testid="block-icon" />}>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const icon = screen.getByTestId("block-icon");
    expect(icon.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Accent tone
// ---------------------------------------------------------------------------

describe("CollapsibleSection — accent tone", () => {
  it("applies the chart-1 tinted classes to the icon chip", () => {
    render(
      <CollapsibleSection
        header="1. Hero"
        icon={<span data-testid="block-icon" />}
        accentTone="chart-1"
      >
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const chip = screen.getByTestId("block-icon").parentElement;
    expect(chip?.className).toContain("bg-chart-1/15");
    expect(chip?.className).toContain("text-chart-1");
  });

  it("defaults to the neutral tone when no accentTone is passed", () => {
    render(
      <CollapsibleSection header="1. Hero" icon={<span data-testid="block-icon" />}>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const chip = screen.getByTestId("block-icon").parentElement;
    expect(chip?.className).toContain("bg-fg-muted/15");
  });
});
