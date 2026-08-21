// Courses access gating.
//
// Faculty hold `courses.view` at scope `assigned`, "programmes this faculty authors", but
// `programs` has no author column, so courses.service.ts rejects any scope other than `all`
// with 403 `courses.scope_unresolvable` rather than widening it to the whole catalogue.
//
// Holding the key is therefore NOT the same as being able to use it. Before this gate, a
// faculty login rendered the Courses screen, fired two doomed requests, and showed a
// "Couldn't load programs, try again" state that blamed the network for an RBAC decision
// no amount of retrying would change.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import type { MeResponse, PermissionScope } from "@repo/types";

import { ProgramDirectory } from "./program-directory";

const programsListMock = vi.fn();

// Declared INSIDE the factory: vi.mock is hoisted above any top-level const, so a helper
// defined outside is not yet initialised when the factory runs.
vi.mock("../../hooks/use-courses", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  const query = () => ({ data: undefined, isLoading: false, isError: false });
  return {
    useProgramsList: (...args: unknown[]) => programsListMock(...args),
    useProgram: query,
    useCurriculum: query,
    useReorderPrograms: mutation,
    useCreateProgram: mutation,
    useUpdateProgram: mutation,
    usePublishProgram: mutation,
    useUnpublishProgram: mutation,
    useSetProgramVisibility: mutation,
    useCreateModule: mutation,
    useUpdateModule: mutation,
    useReorderModules: mutation,
    useCreateLesson: mutation,
    useUpdateLesson: mutation,
    useReorderLessons: mutation,
  };
});

function me(scope: PermissionScope): MeResponse {
  return {
    user: {
      id: "me-1",
      email: "faculty@stimuliiq.test",
      name: "Faculty",
      phone: null,
      avatar: null,
      status: "active",
      mustChangePassword: false,
    },
    tenantId: "t-1",
    roles: ["faculty"],
    permissions: [
      { key: "courses.view", scope },
      { key: "courses.create", scope },
      { key: "courses.edit", scope },
    ],
  } as MeResponse;
}

function renderDirectory(scope: PermissionScope) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ProgramDirectory me={me(scope)} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  programsListMock.mockReset().mockReturnValue({
    data: { items: [], meta: { page: 1, pageSize: 20, total: 0, hasMore: false } },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
});

describe("ProgramDirectory, scope gating", () => {
  it("shows a no-access state for a scope the API cannot serve", () => {
    renderDirectory("assigned");
    expect(screen.getByTestId("programs-no-access")).toBeInTheDocument();
  });

  // The whole point: no doomed requests. Every useProgramsList call must be disabled, or
  // the screen still produces the 403s this gate exists to prevent.
  it("fires no requests at all when access is impossible", () => {
    renderDirectory("assigned");
    for (const call of programsListMock.mock.calls) {
      expect(call[1]).toMatchObject({ enabled: false });
    }
  });

  // "Couldn't load, try again" invites a retry that can never succeed.
  it("does not offer a retry for what is a permission decision", () => {
    renderDirectory("assigned");
    expect(screen.queryByTestId("programs-retry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("programs-error")).not.toBeInTheDocument();
  });

  it("renders the catalogue normally at scope all", () => {
    renderDirectory("all");
    expect(screen.queryByTestId("programs-no-access")).not.toBeInTheDocument();
    expect(programsListMock.mock.calls[0]?.[1]?.enabled).not.toBe(false);
  });

  // PageQuerySchema caps pageSize at 200. This asked for 500, so every reorder fetch came
  // back 400 and the ordered list silently never loaded.
  it("never requests a page larger than the server's 200 limit", () => {
    renderDirectory("all");
    for (const call of programsListMock.mock.calls) {
      const query = call[0] as { pageSize?: number } | undefined;
      if (query?.pageSize !== undefined) expect(query.pageSize).toBeLessThanOrEqual(200);
    }
  });
});
