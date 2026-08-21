import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  NotificationPrefsMatrix,
  type NotificationTypeRow,
  type NotificationMatrix,
  type NotificationChannel,
} from "./notification-prefs-matrix";

const TYPES: NotificationTypeRow[] = [
  { type: "grade_ready", label: "Assignment graded", alwaysEnabled: ["in_app"] },
  { type: "forum_reply", label: "Forum reply" },
];

const CHANNELS: NotificationChannel[] = ["in_app", "email", "sms"];

const MATRIX: NotificationMatrix = {
  grade_ready: { in_app: true, email: true, sms: false },
  forum_reply: { in_app: true, email: false, sms: false },
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("NotificationPrefsMatrix, rendering", () => {
  it("renders with default data-testid='notification-prefs-matrix'", () => {
    render(
      <NotificationPrefsMatrix
        types={TYPES}
        channels={CHANNELS}
        matrix={MATRIX}
        onMatrixChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("notification-prefs-matrix")).toBeInTheDocument();
  });

  it("renders the type×channel grid as a table", () => {
    render(
      <NotificationPrefsMatrix
        types={TYPES}
        channels={CHANNELS}
        matrix={MATRIX}
        onMatrixChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("renders all notification type row headers", () => {
    render(
      <NotificationPrefsMatrix
        types={TYPES}
        channels={CHANNELS}
        matrix={MATRIX}
        onMatrixChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Assignment graded")).toBeInTheDocument();
    expect(screen.getByText("Forum reply")).toBeInTheDocument();
  });

  it("renders channel column headers", () => {
    render(
      <NotificationPrefsMatrix
        types={TYPES}
        channels={CHANNELS}
        matrix={MATRIX}
        onMatrixChange={vi.fn()}
      />,
    );
    expect(screen.getByText("In-app")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("SMS")).toBeInTheDocument();
  });

  it("has accessible table caption via sr-only text", () => {
    const { container } = render(
      <NotificationPrefsMatrix
        types={TYPES}
        channels={CHANNELS}
        matrix={MATRIX}
        onMatrixChange={vi.fn()}
      />,
    );
    expect(container.querySelector("caption")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// a11y
// ---------------------------------------------------------------------------

describe("NotificationPrefsMatrix, a11y", () => {
  it("each checkbox has an aria-label combining type and channel", () => {
    render(
      <NotificationPrefsMatrix
        types={TYPES}
        channels={CHANNELS}
        matrix={MATRIX}
        onMatrixChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Assignment graded, In-app" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Forum reply, Email" }),
    ).toBeInTheDocument();
  });

  it("alwaysEnabled channels have disabled checkboxes", () => {
    render(
      <NotificationPrefsMatrix
        types={TYPES}
        channels={CHANNELS}
        matrix={MATRIX}
        onMatrixChange={vi.fn()}
      />,
    );
    // in_app for grade_ready should be disabled because it's alwaysEnabled
    const checkbox = screen.getByRole("checkbox", { name: "Assignment graded, In-app" });
    expect(checkbox).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

describe("NotificationPrefsMatrix, interactions", () => {
  it("calls onMatrixChange when a toggle is clicked", async () => {
    const user = userEvent.setup();
    const onMatrixChange = vi.fn();
    render(
      <NotificationPrefsMatrix
        types={TYPES}
        channels={CHANNELS}
        matrix={MATRIX}
        onMatrixChange={onMatrixChange}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Forum reply, Email" }));
    expect(onMatrixChange).toHaveBeenCalledWith("forum_reply", "email", true);
  });
});

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

describe("NotificationPrefsMatrix, quiet hours", () => {
  it("renders quiet hours fieldset when showQuietHours=true", () => {
    render(
      <NotificationPrefsMatrix
        types={TYPES}
        channels={CHANNELS}
        matrix={MATRIX}
        onMatrixChange={vi.fn()}
        showQuietHours
      />,
    );
    expect(screen.getByRole("group", { name: "Quiet hours" })).toBeInTheDocument();
  });

  it("does not render quiet hours when showQuietHours=false", () => {
    render(
      <NotificationPrefsMatrix
        types={TYPES}
        channels={CHANNELS}
        matrix={MATRIX}
        onMatrixChange={vi.fn()}
        showQuietHours={false}
      />,
    );
    expect(screen.queryByRole("group", { name: "Quiet hours" })).not.toBeInTheDocument();
  });

  it("calls onQuietHoursChange when quiet hours is toggled on", async () => {
    const user = userEvent.setup();
    const onQuietHoursChange = vi.fn();
    render(
      <NotificationPrefsMatrix
        types={TYPES}
        channels={CHANNELS}
        matrix={MATRIX}
        onMatrixChange={vi.fn()}
        showQuietHours
        onQuietHoursChange={onQuietHoursChange}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Enable quiet hours" }));
    expect(onQuietHoursChange).toHaveBeenCalledWith({ start: "22:00", end: "08:00" });
  });
});
