// Tests for BatchFormDrawer's schedule + status behaviour.
//
// The two properties under test are the ones that changed shape:
//   - a batch can be given SEVERAL weekly days at once, emitted as one block per day
//     (BatchScheduleSchema has always been an array; the old UI only ever sent one);
//   - a new batch opens in Active rather than Planned.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import type { BatchDetail } from "@repo/types";

import { BatchFormDrawer } from "./batch-form-drawer";

// Radix's Select is driven by pointer events jsdom does not implement, so the required
// program/branch/mode pickers can't be filled through the real component, and this form
// won't submit until they are. Swap ONLY those two exports for native equivalents; every
// other @repo/ui component (Drawer, Checkbox, Input, Button) stays real, so what's under
// test here is still the actual form.
vi.mock("@repo/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/ui")>();
  return {
    ...actual,
    Select: ({
      label,
      value,
      onValueChange,
      children,
      "data-testid": testId,
    }: {
      label?: string;
      value?: string;
      onValueChange?: (value: string) => void;
      children?: React.ReactNode;
      "data-testid"?: string;
    }) => (
      <label>
        {label}
        <select data-testid={testId} value={value ?? ""} onChange={(e) => onValueChange?.(e.target.value)}>
          <option value="" />
          {children}
        </select>
      </label>
    ),
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

const createBatchMock = vi.fn();
const updateBatchMock = vi.fn();

vi.mock("../../hooks/use-batches", () => ({
  useCreateBatch: () => ({ mutateAsync: createBatchMock, isPending: false }),
  useUpdateBatch: () => ({ mutateAsync: updateBatchMock, isPending: false }),
}));

const PROGRAM = { id: "11111111-1111-4111-8111-111111111111", name: "Neurology", mode: "live" };
const BRANCH = { id: "22222222-2222-4222-8222-222222222222", name: "Vizag" };

vi.mock("../../hooks/use-courses", () => ({
  useProgramsList: () => ({ data: { items: [PROGRAM] } }),
}));
vi.mock("../../hooks/use-branches", () => ({
  // Paginated envelope, matching what the real hook resolves to.
  useAllBranches: () => ({ data: { items: [BRANCH] } }),
}));
vi.mock("../../hooks/use-faculty", () => ({
  useFacultyList: () => ({ data: { items: [] } }),
}));

function renderDrawer(batch?: BatchDetail) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BatchFormDrawer open onOpenChange={() => {}} batch={batch} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createBatchMock.mockReset().mockResolvedValue({});
  updateBatchMock.mockReset().mockResolvedValue({});
});

/** Everything the schema requires, so submit reaches the mutation rather than failing validation. */
async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>, name = "Neuro Batch AUG") {
  await user.type(screen.getByTestId("batch-form-name"), name);
  await user.selectOptions(screen.getByTestId("batch-form-program"), PROGRAM.id);
  await user.selectOptions(screen.getByTestId("batch-form-branch"), BRANCH.id);
  await user.type(screen.getByTestId("batch-form-start-date"), "2026-09-01");
  await user.type(screen.getByTestId("batch-form-capacity"), "30");
  await user.selectOptions(screen.getByTestId("batch-form-mode"), "live");
}

describe("BatchFormDrawer, weekly schedule", () => {
  it("offers every weekday as an independent checkbox, not a single-value dropdown", () => {
    renderDrawer();
    for (const day of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
      expect(screen.getByTestId(`batch-form-schedule-day-${day}`)).toBeInTheDocument();
    }
  });

  it("emits ONE block per selected day, all sharing the chosen time range", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await fillRequiredFields(user);

    await user.click(screen.getByTestId("batch-form-schedule-day-mon"));
    await user.click(screen.getByTestId("batch-form-schedule-day-wed"));
    await user.click(screen.getByTestId("batch-form-schedule-day-fri"));
    await user.type(screen.getByTestId("batch-form-schedule-start"), "18:00");
    await user.type(screen.getByTestId("batch-form-schedule-end"), "20:00");

    await user.click(screen.getByTestId("batch-form-submit"));

    await waitFor(() => expect(createBatchMock).toHaveBeenCalled());
    expect(createBatchMock.mock.calls[0]![0].schedule).toEqual([
      { day: "mon", startTime: "18:00", endTime: "20:00" },
      { day: "wed", startTime: "18:00", endTime: "20:00" },
      { day: "fri", startTime: "18:00", endTime: "20:00" },
    ]);
  });

  it("orders blocks Monday-first regardless of the order they were ticked", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await fillRequiredFields(user, "Weekend Batch");

    // Ticked out of order on purpose.
    await user.click(screen.getByTestId("batch-form-schedule-day-sat"));
    await user.click(screen.getByTestId("batch-form-schedule-day-tue"));
    await user.type(screen.getByTestId("batch-form-schedule-start"), "10:00");
    await user.type(screen.getByTestId("batch-form-schedule-end"), "12:00");

    await user.click(screen.getByTestId("batch-form-submit"));

    await waitFor(() => expect(createBatchMock).toHaveBeenCalled());
    expect(createBatchMock.mock.calls[0]![0].schedule.map((b: { day: string }) => b.day)).toEqual(["tue", "sat"]);
  });

  it("sends an empty schedule when no day is ticked (an unscheduled batch stays valid)", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await fillRequiredFields(user, "Self-paced");
    await user.click(screen.getByTestId("batch-form-submit"));

    await waitFor(() => expect(createBatchMock).toHaveBeenCalled());
    expect(createBatchMock.mock.calls[0]![0].schedule).toEqual([]);
  });

  it("unticking a day removes only that day", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await fillRequiredFields(user, "Neuro");
    await user.click(screen.getByTestId("batch-form-schedule-day-mon"));
    await user.click(screen.getByTestId("batch-form-schedule-day-tue"));
    await user.click(screen.getByTestId("batch-form-schedule-day-mon")); // untick
    await user.type(screen.getByTestId("batch-form-schedule-start"), "18:00");
    await user.type(screen.getByTestId("batch-form-schedule-end"), "20:00");

    await user.click(screen.getByTestId("batch-form-submit"));

    await waitFor(() => expect(createBatchMock).toHaveBeenCalled());
    expect(createBatchMock.mock.calls[0]![0].schedule.map((b: { day: string }) => b.day)).toEqual(["tue"]);
  });
});

describe("BatchFormDrawer, default status", () => {
  it("opens a NEW batch in Active", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await fillRequiredFields(user);
    await user.click(screen.getByTestId("batch-form-submit"));

    await waitFor(() => expect(createBatchMock).toHaveBeenCalled());
    expect(createBatchMock.mock.calls[0]![0].status).toBe("active");
  });
});
