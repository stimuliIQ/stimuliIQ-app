// RBAC-gate tests for the Page Builder screen (docs/specs/phase-10-page-builder.md AC 8:
// "they see a forbidden state and no page/block data is fetched", still enforced
// identically under the Phase-11 locked-template editor, docs/plans/
// phase-11-locked-templates.md). Mirrors support/ticket-detail-drawer.test.tsx's pattern:
// mock the data hooks directly so we can assert they are never CALLED (not just that their
// result is hidden) when access is denied.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { MeResponse } from "@repo/types";
import { ToastProvider } from "@repo/ui";

import { PageBuilderPage } from "./page-builder-page";

// `EmptyState`'s "Try again" retry button lives inside `PageBuilderList`'s error branch,
// which (like the rest of the CRM's list screens) sits under a `ToastProvider` in the real
// app shell, every render here needs one too, same as ticket-detail-drawer.test.tsx.
function renderPage(me: MeResponse | undefined) {
  return render(
    <ToastProvider>
      <PageBuilderPage me={me} />
    </ToastProvider>,
  );
}

const useBuilderPagesListMock = vi.fn();

vi.mock("../../hooks/use-page-builder", () => ({
  useBuilderPagesList: (...args: unknown[]) => useBuilderPagesListMock(...args),
}));

const SUPER_ADMIN_ME: MeResponse = {
  user: { id: "u-super-1", email: "owner@stimuliiq.test", name: "Owner", phone: null, avatar: null, status: "active", mustChangePassword: false },
  tenantId: "t-1",
  roles: ["super_admin"],
  permissions: [{ key: "content.builder", scope: "all" }],
};

const MARKETING_ME: MeResponse = {
  ...SUPER_ADMIN_ME,
  user: { ...SUPER_ADMIN_ME.user, id: "u-marketing-1" },
  roles: ["marketing"],
  // Holds general content permissions but NOT content.builder, spec's explicit
  // narrowing ("even if I already have general content-editing permissions").
  permissions: [{ key: "content.edit", scope: "all" }, { key: "content.publish", scope: "all" }],
};

beforeEach(() => {
  useBuilderPagesListMock.mockReset();
  useBuilderPagesListMock.mockReturnValue({ data: { items: [] }, isLoading: false, isError: false, refetch: vi.fn() });
});

describe("PageBuilderPage, RBAC gate (AC 8/9)", () => {
  it("a user WITHOUT content.builder sees a forbidden state and the page list is never fetched", () => {
    renderPage(MARKETING_ME);

    expect(screen.getByTestId("page-builder-page-access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("page-builder-list")).not.toBeInTheDocument();
    // The list's own data hook must never even be CALLED, hiding the result isn't enough.
    expect(useBuilderPagesListMock).not.toHaveBeenCalled();
  });

  it("a user with no `me` yet (still loading /me) also sees the forbidden state, not a crash", () => {
    renderPage(undefined);
    expect(screen.getByTestId("page-builder-page-access-denied")).toBeInTheDocument();
  });

  it("a super_admin WITH content.builder sees the page list, and the list's data hook IS called", () => {
    renderPage(SUPER_ADMIN_ME);

    expect(screen.getByTestId("page-builder-list")).toBeInTheDocument();
    expect(screen.queryByTestId("page-builder-page-access-denied")).not.toBeInTheDocument();
    expect(useBuilderPagesListMock).toHaveBeenCalled();
  });

  it("the forbidden state has no detectable a11y violations", async () => {
    const { container } = renderPage(MARKETING_ME);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
