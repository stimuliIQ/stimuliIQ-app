// Component tests for the Blog CMS "Simple pages" tab, regression coverage for the
// UX audit's B1 finding ("the Pages tab is a trap"): builder-managed rows must never
// expose the generic edit/delete affordances (they've always 403'd server-side), and
// must instead show a link back to Page Builder. Data hooks are mocked directly (same
// convention as ticket-detail-drawer.test.tsx).
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ContentPageSummary, MeResponse } from "@repo/types";
import { ToastProvider } from "@repo/ui";

import { ContentPagesManager, isContentPageRowEditable } from "./content-pages-manager";

// `Link` requires a `<RouterProvider>` ancestor at runtime (real app has one); this
// component test renders in isolation, so stub it as a plain anchor, same pattern as
// overview-dashboard.test.tsx.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const useContentPagesListMock = vi.fn();
const useCreateContentPageMock = vi.fn();
const useUpdateContentPageMock = vi.fn();
const useDeleteContentPageMock = vi.fn();

vi.mock("../../hooks/use-content", () => ({
  useContentPagesList: (...args: unknown[]) => useContentPagesListMock(...args),
  useCreateContentPage: (...args: unknown[]) => useCreateContentPageMock(...args),
  useUpdateContentPage: (...args: unknown[]) => useUpdateContentPageMock(...args),
  useDeleteContentPage: (...args: unknown[]) => useDeleteContentPageMock(...args),
}));

const ADMIN_ME: MeResponse = {
  user: { id: "u-1", email: "admin@stimuliiq.test", name: "Admin", phone: null, avatar: null, status: "active", mustChangePassword: false },
  tenantId: "t-1",
  roles: ["super_admin"],
  permissions: [
    { key: "content.create", scope: "all" },
    { key: "content.edit", scope: "all" },
    { key: "content.delete", scope: "all" },
  ],
};

const BUILDER_ROW: ContentPageSummary = {
  id: "page-about",
  slug: "about",
  title: "About Us",
  status: "published",
  publishedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  isBuilderManaged: true,
};

const SIMPLE_ROW: ContentPageSummary = {
  id: "page-privacy",
  slug: "legal/privacy-policy",
  title: "Privacy Policy",
  status: "draft",
  publishedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  isBuilderManaged: false,
};

function renderManager(me: MeResponse | undefined = ADMIN_ME) {
  return render(
    <ToastProvider>
      <ContentPagesManager me={me} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  useContentPagesListMock.mockReset();
  useCreateContentPageMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useUpdateContentPageMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useDeleteContentPageMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe("isContentPageRowEditable, pure gating helper", () => {
  it("is false for a builder-managed row (its generic edit/delete always 403s)", () => {
    expect(isContentPageRowEditable({ isBuilderManaged: true })).toBe(false);
  });

  it("is true for a plain/simple page row", () => {
    expect(isContentPageRowEditable({ isBuilderManaged: false })).toBe(true);
  });
});

describe("ContentPagesManager, Blog CMS 'Simple pages' tab, builder-row gating", () => {
  it("shows an 'Edited in Page Builder' badge and no delete button for a builder-managed row", () => {
    useContentPagesListMock.mockReturnValue({ data: { items: [BUILDER_ROW] }, isLoading: false, isError: false, refetch: vi.fn() });
    renderManager();

    expect(screen.getByTestId(`content-page-builder-managed-badge-${BUILDER_ROW.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`delete-content-page-${BUILDER_ROW.id}`)).not.toBeInTheDocument();
  });

  it("shows a delete button and no Page Builder badge for a plain (non-builder) row", () => {
    useContentPagesListMock.mockReturnValue({ data: { items: [SIMPLE_ROW] }, isLoading: false, isError: false, refetch: vi.fn() });
    renderManager();

    expect(screen.getByTestId(`delete-content-page-${SIMPLE_ROW.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`content-page-builder-managed-badge-${SIMPLE_ROW.id}`)).not.toBeInTheDocument();
  });

  it("clicking a builder-managed row does not open the generic edit drawer", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useContentPagesListMock.mockReturnValue({ data: { items: [BUILDER_ROW] }, isLoading: false, isError: false, refetch: vi.fn() });
    renderManager();

    await user.click(screen.getByText("About Us"));
    expect(screen.queryByTestId("content-page-form-drawer")).not.toBeInTheDocument();
  });

  it("clicking a plain row opens the generic edit drawer", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useContentPagesListMock.mockReturnValue({ data: { items: [SIMPLE_ROW] }, isLoading: false, isError: false, refetch: vi.fn() });
    renderManager();

    await user.click(screen.getByText("Privacy Policy"));
    expect(await screen.findByTestId("content-page-form-drawer")).toBeInTheDocument();
  });

  it("has no detectable a11y violations with a mix of builder and plain rows", async () => {
    useContentPagesListMock.mockReturnValue({ data: { items: [BUILDER_ROW, SIMPLE_ROW] }, isLoading: false, isError: false, refetch: vi.fn() });
    const { container } = renderManager();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
