// Tests for PipelineWorkspace — the Pipeline page's tab shell.
//
// The two child screens are mocked: they have their own coverage, and what is worth
// asserting here is the shell's OWN logic, which is where the consequences are:
//   - a user without `content.view` must not be offered a tab that would 403, and must
//     not fire the count query that provokes the 403 either;
//   - the pipeline board must still be what loads first, since this page's primary job
//     is unchanged.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { PipelineWorkspace } from "./pipeline-workspace";

vi.mock("./pipeline-board", () => ({
  PipelineBoard: () => <div data-testid="mock-pipeline-board">pipeline board</div>,
}));
vi.mock("./contact-message-list", () => ({
  ContactMessageList: () => <div data-testid="mock-contact-message-list">contact messages</div>,
}));

const contactListMock = vi.fn();
vi.mock("../../hooks/use-content", () => ({
  useContactSubmissionsList: (...args: unknown[]) => contactListMock(...args),
}));

function meWith(permissionKeys: string[]): MeResponse {
  return {
    user: { id: "u1", name: "Priya", email: "priya@stimuliiq.com" },
    roles: ["counsellor"],
    permissions: permissionKeys.map((key) => ({ key, scope: "all" })),
  } as unknown as MeResponse;
}

function renderWorkspace(me: MeResponse) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <PipelineWorkspace me={me} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  contactListMock.mockReset();
  contactListMock.mockReturnValue({ data: { items: [], meta: { total: 0 } } });
});

describe("PipelineWorkspace", () => {
  it("shows both tabs and opens on the pipeline board", async () => {
    renderWorkspace(meWith(["leads.view", "content.view"]));

    expect(screen.getByTestId("leads-tab-pipeline")).toBeInTheDocument();
    expect(screen.getByTestId("leads-tab-contact-messages")).toBeInTheDocument();
    expect(screen.getByTestId("mock-pipeline-board")).toBeInTheDocument();
  });

  it("switches to contact messages without leaving the page", async () => {
    const user = userEvent.setup();
    renderWorkspace(meWith(["leads.view", "content.view"]));

    await user.click(screen.getByTestId("leads-tab-contact-messages"));

    expect(await screen.findByTestId("mock-contact-message-list")).toBeInTheDocument();
  });

  it("hides the tab strip entirely without content.view — and fires NO count query", async () => {
    renderWorkspace(meWith(["leads.view"]));

    expect(screen.getByTestId("mock-pipeline-board")).toBeInTheDocument();
    expect(screen.queryByTestId("leads-tab-contact-messages")).not.toBeInTheDocument();
    expect(screen.queryByTestId("leads-tab-pipeline")).not.toBeInTheDocument();
    // The guaranteed-403 request must never be issued. This is why the count lives in
    // its own component rather than being read before the permission branch.
    expect(contactListMock).not.toHaveBeenCalled();
  });

  it("badges the tab with the number of NEW messages", async () => {
    contactListMock.mockReturnValue({ data: { items: [], meta: { total: 3 } } });
    renderWorkspace(meWith(["leads.view", "content.view"]));

    expect(screen.getByTestId("leads-tab-contact-messages-count")).toHaveTextContent("3");
    // Only unhandled messages are counted, and only the total is fetched.
    expect(contactListMock).toHaveBeenCalledWith({ page: 1, pageSize: 1, status: "new" });
  });

  it("omits the badge when nothing is waiting", async () => {
    renderWorkspace(meWith(["leads.view", "content.view"]));
    expect(screen.queryByTestId("leads-tab-contact-messages-count")).not.toBeInTheDocument();
  });

  it("names the count in the tab's accessible name rather than leaving a bare number", async () => {
    contactListMock.mockReturnValue({ data: { items: [], meta: { total: 2 } } });
    renderWorkspace(meWith(["leads.view", "content.view"]));

    expect(screen.getByRole("tab", { name: /contact messages, 2 new/i })).toBeInTheDocument();
  });

  it("has no a11y violations", async () => {
    contactListMock.mockReturnValue({ data: { items: [], meta: { total: 4 } } });
    const { container } = renderWorkspace(meWith(["leads.view", "content.view"]));

    await waitFor(() => expect(screen.getByTestId("leads-tab-pipeline")).toBeInTheDocument());
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
