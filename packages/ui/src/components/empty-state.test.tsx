import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "./button";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders title, description, and an optional action", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="No students yet"
        description="Try adjusting your filters."
        action={<Button onClick={onClick}>Add student</Button>}
      />,
    );

    expect(screen.getByText("No students yet")).toBeInTheDocument();
    expect(screen.getByText("Try adjusting your filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add student" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("exposes a status role so loading/empty transitions are announced", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
