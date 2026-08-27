// Component tests for Admin ▸ Course types (docs/specs/course-types.md, ADR-0068).
// Data hooks are mocked (CLAUDE.md §3: no business logic in components) — these cover the
// screen's three deliberate behaviours: the student count is visible, hiding is offered
// instead of deleting, and an in-use option's delete dialog says why it will not work.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CourseTypeOption, MeResponse } from "@repo/types";
import { ToastProvider } from "@repo/ui";

import { CourseTypesManager } from "./course-types-manager";

const useCourseTypesListMock = vi.fn();
const useCreateCourseTypeMock = vi.fn();
const useUpdateCourseTypeMock = vi.fn();
const useDeleteCourseTypeMock = vi.fn();

vi.mock("../../hooks/use-course-types", () => ({
  useCourseTypesList: (...args: unknown[]) => useCourseTypesListMock(...args),
  useCreateCourseType: (...args: unknown[]) => useCreateCourseTypeMock(...args),
  useUpdateCourseType: (...args: unknown[]) => useUpdateCourseTypeMock(...args),
  useDeleteCourseType: (...args: unknown[]) => useDeleteCourseTypeMock(...args),
}));

const ADMIN_ME: MeResponse = {
  user: { id: "u-1", email: "admin@stimuliiq.test", name: "Admin", phone: null, avatar: null, status: "active", mustChangePassword: false },
  tenantId: "t-1",
  roles: ["super_admin"],
  permissions: [{ key: "course_types.manage", scope: "all" }],
};

const COUNSELLOR_ME: MeResponse = { ...ADMIN_ME, roles: ["counsellor"], permissions: [{ key: "students.view", scope: "branch" }] };

const OPTIONS: CourseTypeOption[] = [
  { id: "ct-1", key: "b_sc_nursing", label: "B.Sc Nursing", sortOrder: 1, active: true, studentCount: 3, createdAt: "2026-08-01T00:00:00.000Z" },
  { id: "ct-2", key: "mbbs", label: "MBBS", sortOrder: 2, active: false, studentCount: 0, createdAt: "2026-08-01T00:00:00.000Z" },
];

function renderManager(me: MeResponse = ADMIN_ME) {
  return render(
    <ToastProvider>
      <CourseTypesManager me={me} />
    </ToastProvider>,
  );
}

describe("CourseTypesManager", () => {
  const mutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useCourseTypesListMock.mockReturnValue({ data: { items: OPTIONS, meta: {} }, isLoading: false, isError: false, refetch: vi.fn() });
    useCreateCourseTypeMock.mockReturnValue({ mutate, isPending: false });
    useUpdateCourseTypeMock.mockReturnValue({ mutate, isPending: false });
    useDeleteCourseTypeMock.mockReturnValue({ mutate, isPending: false });
  });

  it("shows how many students hold each option — the fact that makes hiding a decision", () => {
    renderManager();
    expect(screen.getByText("B.Sc Nursing")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("marks a hidden option as hidden rather than dropping it from the screen", () => {
    renderManager();
    expect(screen.getByText("MBBS")).toBeInTheDocument();
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("offers Hide on a shown option and Show on a hidden one", () => {
    renderManager();
    expect(screen.getByTestId("toggle-course-type-ct-1")).toHaveTextContent("Hide");
    expect(screen.getByTestId("toggle-course-type-ct-2")).toHaveTextContent("Show");
  });

  it("hiding sends active:false and never touches the key", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId("toggle-course-type-ct-1"));

    expect(mutate).toHaveBeenCalledWith({ id: "ct-1", body: { active: false } }, expect.anything());
  });

  it("says renaming is safe, because the screen is the only place that promise is made", () => {
    renderManager();
    expect(screen.getByTestId("course-types-rename-note")).toHaveTextContent(/does not\s+change which students are in it/i);
  });

  it("explains in the delete dialog why an in-use option cannot be deleted", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId("delete-course-type-ct-1"));

    expect(screen.getByText(/3 students are recorded as/i)).toBeInTheDocument();
    expect(screen.getByText(/Hide it instead/i)).toBeInTheDocument();
  });

  it("hides every write control from a role without course_types.manage", () => {
    renderManager(COUNSELLOR_ME);
    expect(screen.queryByTestId("course-type-create-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("toggle-course-type-ct-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-course-type-ct-1")).not.toBeInTheDocument();
  });

  it("previews the key a new option will be stored as, since it can never be changed later", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId("course-type-create-button"));
    await user.type(screen.getByTestId("course-type-form-label"), "B.Sc Nursing");

    expect(screen.getByText(/Will be stored as .b_sc_nursing./)).toBeInTheDocument();
  });
});
