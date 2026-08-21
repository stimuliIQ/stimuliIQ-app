import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TicketThread, type TicketMessage } from "./ticket-thread";

const MESSAGES: TicketMessage[] = [
  {
    id: "m1",
    authorId: "u1",
    authorDisplayName: "Priya Sharma",
    authorRole: "customer",
    body: "<p>My video isn't loading.</p>",
    createdAt: new Date("2026-07-01T10:00:00Z"),
  },
  {
    id: "m2",
    authorId: "u2",
    authorDisplayName: "Rahul (Support)",
    authorRole: "agent",
    body: "<p>Could you share the course name?</p>",
    createdAt: new Date("2026-07-01T10:05:00Z"),
  },
];

describe("TicketThread, message list", () => {
  it("renders all messages with author and role", () => {
    render(<TicketThread messages={MESSAGES} />);
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText("Rahul (Support)")).toBeInTheDocument();
    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("sanitizes message bodies through the render sink", () => {
    render(
      <TicketThread
        messages={[
          {
            id: "m3",
            authorId: "u1",
            authorDisplayName: "Attacker",
            authorRole: "customer",
            body: "<p>Hi</p><script>alert(1)</script>",
            createdAt: new Date(),
          },
        ]}
      />,
    );
    const body = screen.getByTestId("ticket-message-body-m3");
    expect(body.innerHTML).not.toContain("<script");
  });

  it("marks internal notes with a visible badge", () => {
    render(
      <TicketThread
        messages={[
          {
            id: "m4",
            authorId: "u2",
            authorDisplayName: "Rahul (Support)",
            authorRole: "agent",
            body: "<p>Internal only</p>",
            createdAt: new Date(),
            isInternalNote: true,
          },
        ]}
      />,
    );
    expect(screen.getByText("Internal note")).toBeInTheDocument();
  });

  it("shows an empty state with no messages", () => {
    render(<TicketThread messages={[]} />);
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    render(<TicketThread messages={[]} loading />);
    expect(screen.getByLabelText("Loading conversation")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    render(<TicketThread messages={[]} error="Failed to load ticket" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load ticket");
  });
});

describe("TicketThread, composer", () => {
  it("submits the composer body and clears the textarea", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<TicketThread messages={MESSAGES} onSend={onSend} />);

    const textarea = screen.getByTestId("ticket-composer-textarea");
    await user.type(textarea, "Sure, it's the React course.");
    await user.click(screen.getByTestId("ticket-composer-send"));

    expect(onSend).toHaveBeenCalledWith("Sure, it's the React course.", undefined);
    expect(textarea).toHaveValue("");
  });

  it("disables Send while the draft is empty", () => {
    render(<TicketThread messages={MESSAGES} onSend={vi.fn()} />);
    expect(screen.getByTestId("ticket-composer-send")).toBeDisabled();
  });

  it("passes internal=true when the internal-note toggle is checked", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<TicketThread messages={MESSAGES} onSend={onSend} allowInternalNotes />);

    await user.type(screen.getByTestId("ticket-composer-textarea"), "Escalating to L2.");
    await user.click(screen.getByTestId("ticket-internal-note-toggle"));
    await user.click(screen.getByTestId("ticket-composer-send"));

    expect(onSend).toHaveBeenCalledWith("Escalating to L2.", { internal: true });
  });

  it("inserts a canned response into the composer", async () => {
    const user = userEvent.setup();
    render(
      <TicketThread
        messages={MESSAGES}
        onSend={vi.fn()}
        cannedResponses={[{ id: "c1", label: "Ask for course name", body: "Which course is this about?" }]}
      />,
    );
    await user.click(screen.getByTestId("ticket-canned-response-select"));
    await user.click(await screen.findByRole("option", { name: "Ask for course name" }));
    expect(screen.getByTestId("ticket-composer-textarea")).toHaveValue("Which course is this about?");
  });

  it("shows a disabled message instead of a composer when disabled", () => {
    render(<TicketThread messages={MESSAGES} onSend={vi.fn()} disabled disabledReason="Ticket resolved." />);
    expect(screen.getByText("Ticket resolved.")).toBeInTheDocument();
    expect(screen.queryByTestId("ticket-composer-textarea")).not.toBeInTheDocument();
  });

  it("does not render a composer when onSend is not provided", () => {
    render(<TicketThread messages={MESSAGES} />);
    expect(screen.queryByTestId("ticket-composer")).not.toBeInTheDocument();
  });
});
