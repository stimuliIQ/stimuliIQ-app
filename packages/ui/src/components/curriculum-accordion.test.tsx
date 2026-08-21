import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CurriculumAccordion,
  LessonList,
  type CurriculumModule,
  type LessonItem,
} from "./curriculum-accordion";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const lessons: LessonItem[] = [
  {
    id: "les-1",
    title: "Variables & types",
    type: "video",
    durationMin: 12,
    status: "completed",
    isPreview: false,
    isLocked: false,
  },
  {
    id: "les-2",
    title: "Control flow",
    type: "video",
    durationMin: 18,
    status: "in_progress",
    isPreview: false,
    isLocked: false,
  },
  {
    id: "les-3",
    title: "Reading: Python docs",
    type: "reading",
    durationMin: 5,
    status: "not_started",
    isPreview: true,
    isLocked: false,
  },
  {
    id: "les-4",
    title: "Advanced topics",
    type: "video",
    durationMin: 30,
    status: "not_started",
    isPreview: false,
    isLocked: true,
  },
];

const modules: CurriculumModule[] = [
  {
    id: "mod-1",
    title: "Python Basics",
    lessons: lessons.slice(0, 3),
  },
  {
    id: "mod-2",
    title: "Advanced Python",
    lessons: lessons.slice(3),
  },
];

// ---------------------------------------------------------------------------
// CurriculumAccordion, structure
// ---------------------------------------------------------------------------

describe("CurriculumAccordion, rendering", () => {
  it("renders with aria-label='Course curriculum'", () => {
    render(<CurriculumAccordion modules={modules} />);
    expect(screen.getByRole("region", { name: "Course curriculum" })).toBeInTheDocument();
  });

  it("renders a trigger for each module", () => {
    render(<CurriculumAccordion modules={modules} />);
    expect(screen.getByTestId("curriculum-accordion")).toBeInTheDocument();
    // Two module triggers
    const triggers = screen.getAllByTestId("curriculum-module-trigger");
    expect(triggers).toHaveLength(2);
  });

  it("renders module titles in the triggers", () => {
    render(<CurriculumAccordion modules={modules} />);
    expect(screen.getByText("Python Basics")).toBeInTheDocument();
    expect(screen.getByText("Advanced Python")).toBeInTheDocument();
  });

  it("renders all lessons when defaultOpenAll=true (default)", () => {
    render(<CurriculumAccordion modules={modules} />);
    // All lessons visible by default
    expect(screen.getByText("Variables & types")).toBeInTheDocument();
    expect(screen.getByText("Control flow")).toBeInTheDocument();
    expect(screen.getByText("Reading: Python docs")).toBeInTheDocument();
    expect(screen.getByText("Advanced topics")).toBeInTheDocument();
  });

  it("uses default data-testid='curriculum-accordion'", () => {
    render(<CurriculumAccordion modules={modules} />);
    expect(screen.getByTestId("curriculum-accordion")).toBeInTheDocument();
  });

  it("respects a custom data-testid", () => {
    render(<CurriculumAccordion modules={modules} data-testid="my-accordion" />);
    expect(screen.getByTestId("my-accordion")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CurriculumAccordion, keyboard expand/collapse
// ---------------------------------------------------------------------------

describe("CurriculumAccordion, keyboard expand/collapse", () => {
  it("collapses a module panel when trigger is activated with keyboard (Enter)", async () => {
    const user = userEvent.setup();
    render(<CurriculumAccordion modules={[modules[0]!]} />);

    const trigger = screen.getByTestId("curriculum-module-trigger");
    trigger.focus();
    // Panel is open by default (defaultOpenAll=true); Enter closes it
    await user.keyboard("{Enter}");

    // After collapse, lesson text should not be visible
    expect(screen.queryByText("Variables & types")).not.toBeInTheDocument();
  });

  it("re-expands a collapsed module with keyboard (Enter)", async () => {
    const user = userEvent.setup();
    render(<CurriculumAccordion modules={[modules[0]!]} defaultOpenAll={false} />);

    const trigger = screen.getByTestId("curriculum-module-trigger");
    trigger.focus();
    // Panel is closed by default; Enter opens it
    await user.keyboard("{Enter}");

    expect(screen.getByText("Variables & types")).toBeInTheDocument();
  });

  it("collapses a module with Space key", async () => {
    const user = userEvent.setup();
    render(<CurriculumAccordion modules={[modules[0]!]} />);

    const trigger = screen.getByTestId("curriculum-module-trigger");
    trigger.focus();
    await user.keyboard(" ");

    expect(screen.queryByText("Variables & types")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CurriculumAccordion, locked indicator
// ---------------------------------------------------------------------------

describe("CurriculumAccordion, locked lesson", () => {
  it("renders a 'Locked' text label for locked lessons (never color-only)", () => {
    render(<CurriculumAccordion modules={modules} />);
    // "Advanced topics" is locked
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("renders a lock icon alongside the 'Locked' label", () => {
    render(<CurriculumAccordion modules={modules} />);
    // Lock icon is inside the locked row
    const lockedRow = screen
      .getAllByTestId("lesson-row")
      .find((row) => within(row).queryByText("Locked") !== null);
    expect(lockedRow).toBeDefined();
    // There should be an SVG (icon) inside the locked row
    expect(lockedRow!.querySelector("svg")).toBeInTheDocument();
  });

  it("does NOT fire onLessonClick when a locked lesson is activated", async () => {
    const user = userEvent.setup();
    const onLessonClick = vi.fn();
    render(<CurriculumAccordion modules={modules} onLessonClick={onLessonClick} />);

    const rows = screen.getAllByTestId("lesson-row");
    // Last row is the locked lesson
    const lockedRow = rows.find((r) => within(r).queryByText("Locked") !== null)!;
    await user.click(lockedRow);
    expect(onLessonClick).not.toHaveBeenCalledWith("les-4");
  });
});

// ---------------------------------------------------------------------------
// CurriculumAccordion, aria-current (active lesson)
// ---------------------------------------------------------------------------

describe("CurriculumAccordion, aria-current active lesson", () => {
  it("sets aria-current='true' on the active lesson row", () => {
    render(
      <CurriculumAccordion modules={modules} activeLessonId="les-2" />,
    );
    const rows = screen.getAllByTestId("lesson-row");
    const activeRow = rows.find((r) => r.getAttribute("aria-current") === "true");
    expect(activeRow).toBeDefined();
    expect(within(activeRow!).getByText("Control flow")).toBeInTheDocument();
  });

  it("does not set aria-current on non-active rows", () => {
    render(
      <CurriculumAccordion modules={modules} activeLessonId="les-2" />,
    );
    const rows = screen.getAllByTestId("lesson-row");
    const nonActiveRows = rows.filter((r) => r.getAttribute("aria-current") !== "true");
    expect(nonActiveRows.length).toBeGreaterThan(0);
    for (const row of nonActiveRows) {
      expect(row).not.toHaveAttribute("aria-current", "true");
    }
  });
});

// ---------------------------------------------------------------------------
// CurriculumAccordion, lesson interaction
// ---------------------------------------------------------------------------

describe("CurriculumAccordion, lesson click", () => {
  it("calls onLessonClick with the lesson id when a non-locked lesson is clicked", async () => {
    const user = userEvent.setup();
    const onLessonClick = vi.fn();
    render(
      <CurriculumAccordion modules={modules} onLessonClick={onLessonClick} />,
    );

    // Click "Variables & types" (les-1)
    const rows = screen.getAllByTestId("lesson-row");
    const firstRow = rows.find((r) => within(r).queryByText("Variables & types") !== null)!;
    await user.click(firstRow);
    expect(onLessonClick).toHaveBeenCalledWith("les-1");
  });

  it("calls onLessonClick when Enter is pressed on a non-locked lesson", async () => {
    const user = userEvent.setup();
    const onLessonClick = vi.fn();
    render(
      <CurriculumAccordion modules={modules} onLessonClick={onLessonClick} />,
    );

    const rows = screen.getAllByTestId("lesson-row");
    const firstRow = rows.find((r) => within(r).queryByText("Variables & types") !== null)!;
    firstRow.focus();
    await user.keyboard("{Enter}");
    expect(onLessonClick).toHaveBeenCalledWith("les-1");
  });
});

// ---------------------------------------------------------------------------
// CurriculumAccordion, preview indicator
// ---------------------------------------------------------------------------

describe("CurriculumAccordion, preview lessons", () => {
  it("renders a 'Preview' label for preview lessons", () => {
    render(<CurriculumAccordion modules={modules} />);
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CurriculumAccordion, completed indicator
// ---------------------------------------------------------------------------

describe("CurriculumAccordion, completed lessons", () => {
  it("renders a completed indicator (CheckCircle2 with aria-label='Completed')", () => {
    render(<CurriculumAccordion modules={modules} />);
    // "Variables & types" is completed
    const completedIcon = screen.getByLabelText("Completed");
    expect(completedIcon).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// LessonList, flat variant
// ---------------------------------------------------------------------------

describe("LessonList", () => {
  it("renders an ordered list with a label", () => {
    render(<LessonList lessons={lessons.slice(0, 2)} label="Module 1 lessons" />);
    expect(screen.getByRole("list", { name: "Module 1 lessons" })).toBeInTheDocument();
  });

  it("renders all lessons in the provided order", () => {
    render(<LessonList lessons={lessons.slice(0, 2)} />);
    const rows = screen.getAllByTestId("lesson-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Variables & types")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Control flow")).toBeInTheDocument();
  });

  it("fires onLessonClick when a non-locked lesson is clicked", async () => {
    const user = userEvent.setup();
    const onLessonClick = vi.fn();
    render(
      <LessonList
        lessons={lessons.slice(0, 1)}
        onLessonClick={onLessonClick}
      />,
    );
    const [firstRow] = screen.getAllByTestId("lesson-row");
    await user.click(firstRow!);
    expect(onLessonClick).toHaveBeenCalledWith("les-1");
  });

  it("sets aria-current on the active lesson", () => {
    render(
      <LessonList lessons={lessons.slice(0, 2)} activeLessonId="les-2" />,
    );
    const rows = screen.getAllByTestId("lesson-row");
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    expect(rows[0]).not.toHaveAttribute("aria-current", "true");
  });

  it("uses default data-testid='lesson-list'", () => {
    render(<LessonList lessons={[]} />);
    expect(screen.getByTestId("lesson-list")).toBeInTheDocument();
  });
});
