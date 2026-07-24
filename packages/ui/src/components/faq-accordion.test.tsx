import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FaqAccordion, buildFaqJsonLd, type FaqItem } from "./faq-accordion";

const items: FaqItem[] = [
  { id: "q1", question: "What is the duration of the program?", answer: "12 weeks." },
  { id: "q2", question: "Is placement guaranteed?", answer: "We provide placement assistance." },
  { id: "q3", question: "Can I pay in EMI?", answer: "Yes, 0% EMI is available." },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("FaqAccordion — rendering", () => {
  it("renders with default data-testid='faq-accordion'", () => {
    render(<FaqAccordion items={items} />);
    expect(screen.getByTestId("faq-accordion")).toBeInTheDocument();
  });

  it("renders all question triggers", () => {
    render(<FaqAccordion items={items} />);
    const triggers = screen.getAllByTestId("faq-trigger");
    expect(triggers).toHaveLength(3);
  });

  it("renders question text in triggers", () => {
    render(<FaqAccordion items={items} />);
    expect(screen.getByText("What is the duration of the program?")).toBeInTheDocument();
    expect(screen.getByText("Is placement guaranteed?")).toBeInTheDocument();
  });

  it("answers are not visible before expanding (single mode)", () => {
    render(<FaqAccordion items={items} />);
    // In single-collapsible mode items start closed
    expect(screen.queryByText("12 weeks.")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Keyboard expand/collapse
// ---------------------------------------------------------------------------

describe("FaqAccordion — keyboard interaction", () => {
  it("expands an item on Enter key", async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={items} />);
    const trigger = screen.getAllByTestId("faq-trigger")[0]!;
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("12 weeks.")).toBeInTheDocument();
  });

  it("expands an item on Space key", async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={items} />);
    const trigger = screen.getAllByTestId("faq-trigger")[0]!;
    trigger.focus();
    await user.keyboard(" ");
    expect(screen.getByText("12 weeks.")).toBeInTheDocument();
  });

  it("collapses after a second Enter (single collapsible mode)", async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={items} />);
    const trigger = screen.getAllByTestId("faq-trigger")[0]!;
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    expect(screen.queryByText("12 weeks.")).not.toBeInTheDocument();
  });

  it("allows multiple items open when allowMultiple=true", async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={items} allowMultiple />);
    const triggers = screen.getAllByTestId("faq-trigger");
    triggers[0]!.focus();
    await user.keyboard("{Enter}");
    triggers[1]!.focus();
    await user.keyboard("{Enter}");
    // Both answers should be visible
    expect(screen.getByText("12 weeks.")).toBeInTheDocument();
    expect(screen.getByText("We provide placement assistance.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// JSON-LD emission
// ---------------------------------------------------------------------------

describe("FaqAccordion — JSON-LD", () => {
  it("renders a JSON-LD script when emitJsonLd=true", () => {
    const { container } = render(<FaqAccordion items={items} emitJsonLd />);
    const script = container.querySelector("script[type='application/ld+json']");
    expect(script).toBeInTheDocument();
  });

  it("does NOT render a JSON-LD script when emitJsonLd=false (default)", () => {
    const { container } = render(<FaqAccordion items={items} />);
    const script = container.querySelector("script[type='application/ld+json']");
    expect(script).not.toBeInTheDocument();
  });

  it("buildFaqJsonLd produces valid JSON with FAQPage type", () => {
    const jsonStr = buildFaqJsonLd([{ question: "Q1?", answerText: "A1." }]);
    const parsed = JSON.parse(jsonStr);
    expect(parsed["@type"]).toBe("FAQPage");
    expect(parsed.mainEntity[0]["@type"]).toBe("Question");
    expect(parsed.mainEntity[0].name).toBe("Q1?");
    expect(parsed.mainEntity[0].acceptedAnswer.text).toBe("A1.");
  });

  it("buildFaqJsonLd escapes </script> in output", () => {
    const jsonStr = buildFaqJsonLd([
      { question: "Q", answerText: "Inject </script><script>alert(1)</script>" },
    ]);
    expect(jsonStr).not.toContain("</script>");
    expect(jsonStr).toContain("<\\/script>");
  });
});

// ---------------------------------------------------------------------------
// a11y
// ---------------------------------------------------------------------------

describe("FaqAccordion — a11y", () => {
  it("triggers are inside h3 heading elements", () => {
    const { container } = render(<FaqAccordion items={items} />);
    const h3s = container.querySelectorAll("h3");
    expect(h3s.length).toBe(items.length);
  });

  it("each trigger has aria-expanded attribute", () => {
    render(<FaqAccordion items={items} />);
    const triggers = screen.getAllByTestId("faq-trigger");
    triggers.forEach((t) => {
      expect(t).toHaveAttribute("aria-expanded");
    });
  });
});
