// Student directory — server-paginated DataTable wired to
// hooks/use-students.ts (TanStack Query), debounced search + status/course-type
// filters (docs/03 §7.2). Loading/empty/error states are explicit; RBAC-aware:
// Create action only shows if the user holds `students.create`.
//
// Phase 9 Completion T40 additions: bulk row-selection + bulk status update
// (`client.crm.bulk.updateStudentsStatus`, permission `bulk.students`) and
// own-scope saved filter views (`client.crm.savedViews`, module="students").
// One page replaces the old Directory/Admissions/Alumni sub-pages: a
// segmented status toggle (All / Admissions / Active / Alumni) filters the
// same list in place. `initialStatus` preselects the toggle (used by the
// legacy /students/admissions and /students/alumni redirects).
import * as React from "react";
import { Plus } from "lucide-react";
import {
  Button,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  Select,
  SelectItem,
  useToast,
} from "@repo/ui";
import type { CourseType, ListStudentsQuery, StudentDetail, StudentStatus, StudentSummary, MeResponse } from "@repo/types";

import { useStudentsList } from "../../hooks/use-students";
import { useBranchScope } from "../../app/branch-scope";
import { useBulkUpdateStudentsStatus, useCreateSavedView, useDeleteSavedView, useSavedViewsList } from "../../hooks/use-bulk-saved-views";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions, hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { LifecycleChip } from "../shared/lifecycle-chip";
import { StudentFormDrawer } from "./student-form-drawer";
import { RegisterStudentDialog } from "./register-student-dialog";
import { AddProgramDialog } from "./add-program-dialog";
import { StudentDetailDrawer } from "./student-detail-drawer";

const COURSE_TYPE_OPTIONS: { value: CourseType; label: string }[] = [
  { value: "btech", label: "B.Tech" },
  { value: "degree", label: "Degree" },
  { value: "diploma", label: "Diploma" },
  { value: "mca", label: "MCA" },
  { value: "mba", label: "MBA" },
  { value: "other", label: "Other" },
];

const STATUS_OPTIONS: { value: StudentStatus; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "active", label: "Active" },
  { value: "alumni", label: "Completed" },
];

/** In-page status toggle. "Admissions" = status "lead" (converted but not yet admitted). */
const STATUS_TABS: { value: StudentStatus | undefined; label: string; testId: string }[] = [
  { value: undefined, label: "All", testId: "students-tab-all" },
  { value: "lead", label: "Admissions", testId: "students-tab-admissions" },
  { value: "active", label: "Active", testId: "students-tab-active" },
  { value: "alumni", label: "Completed", testId: "students-tab-alumni" },
];

interface StudentDirectoryProps {
  me: MeResponse | undefined;
  /** Preselects the status toggle (used by the legacy admissions/alumni URL redirects). */
  initialStatus?: StudentStatus;
}

export function StudentDirectory({ me, initialStatus }: StudentDirectoryProps): React.JSX.Element {
  const permissions = getModulePermissions(me, "students");
  const canBulkEdit = hasPermission(me?.permissions, "bulk.students");
  const { toast } = useToast();

  // Follows the global branch scope set in the topbar — the students list has no
  // branch filter of its own, so it inherits whatever branch the CRM is scoped to.
  const { selectedBranchId } = useBranchScope();

  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<StudentStatus | undefined>(initialStatus);
  const [courseType, setCourseType] = React.useState<CourseType | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [sortBy, setSortBy] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const [createOpen, setCreateOpen] = React.useState(false);
  // Lifecycle chain (lifecycle-redesign): contact created → registration dialog →
  // program assignment. Each step hands the student to the next dialog.
  const [registerStudent, setRegisterStudent] = React.useState<StudentDetail | null>(null);
  const [addProgramStudentId, setAddProgramStudentId] = React.useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());
  const [activeViewId, setActiveViewId] = React.useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  const { data: savedViews } = useSavedViewsList({ module: "students" });
  const createSavedView = useCreateSavedView();
  const deleteSavedView = useDeleteSavedView();
  const bulkUpdateStatus = useBulkUpdateStudentsStatus();

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, courseType, selectedBranchId]);

  const query: ListStudentsQuery = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status,
    courseType,
    branchId: selectedBranchId,
    includeDeleted: false,
  };

  const { data, isLoading, isError, refetch, isFetching } = useStudentsList(query);

  const columns: Array<DataTableColumn<StudentSummary>> = [
    { id: "name", header: "Name", cell: (row) => row.name, sortable: true },
    { id: "email", header: "Email", cell: (row) => row.email },
    { id: "courseType", header: "Course", cell: (row) => row.courseType },
    { id: "college", header: "College", cell: (row) => row.college ?? "—" },
    {
      // The DERIVED lifecycle stage (lifecycle-redesign P1) — the single answer to
      // "where is this student in the journey?". The coarse `status` (lead/active/
      // alumni) still powers the toggle + filters above; this shows the fine-grained
      // stage the whole system now speaks in.
      id: "status",
      header: "Lifecycle",
      cell: (row) => <LifecycleChip stage={row.lifecycleStage} />,
    },
    {
      id: "createdAt",
      header: "Added",
      cell: (row) => new Date(row.createdAt).toLocaleDateString(),
      sortable: true,
      align: "right",
    },
  ];

  const handleSortChange = (columnId: string, direction: "asc" | "desc") => {
    setSortBy(columnId);
    setSortDir(direction);
    // Sort is applied client-side here as a presentation affordance; the
    // backend list endpoint doesn't yet take sort params (P1 scope — see
    // ListStudentsQuerySchema). Tracked as a P1 follow-up if server sort is
    // needed before P2.
  };

  const sortedItems = React.useMemo(() => {
    const items = data?.items ?? [];
    if (!sortBy) return items;
    const sorted = [...items].sort((a, b) => {
      const aValue = String(a[sortBy as keyof StudentSummary] ?? "");
      const bValue = String(b[sortBy as keyof StudentSummary] ?? "");
      return aValue.localeCompare(bValue);
    });
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [data?.items, sortBy, sortDir]);

  function applyView(viewId: string | null) {
    setActiveViewId(viewId);
    if (!viewId) return;
    const view = savedViews?.find((v) => v.id === viewId);
    if (!view) return;
    const filters = view.filters as Partial<{ search: string; status: StudentStatus; courseType: CourseType }>;
    setSearch(filters.search ?? "");
    setStatus(filters.status);
    setCourseType(filters.courseType);
  }

  async function handleSaveView(name: string) {
    try {
      await createSavedView.mutateAsync({ module: "students", name, filters: { search, status, courseType } });
      toast({ title: "View saved", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this view");
    }
  }

  async function handleBulkStatus(newStatus: StudentStatus) {
    try {
      const result = await bulkUpdateStatus.mutateAsync({ ids: Array.from(selectedIds), status: newStatus });
      toast({
        title: "Bulk update complete",
        description: `${result.successCount} of ${result.results.length} students updated.`,
        variant: result.failureCount === 0 ? "success" : "default",
      });
      setSelectedIds(new Set());
    } catch (error) {
      surfaceError(toast, error, "Couldn't bulk-update these students");
    }
  }

  if (isError) {
    return (
      <EmptyState
        data-testid="students-error"
        title="Couldn't load students"
        description="Something went wrong fetching the directory."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="students-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="students-directory">
      <PageHeader
        title="Students"
        description="One list for the whole lifecycle — use the toggle to see admissions in progress, active students, or those who completed their program."
        actions={
          <div className="flex items-center gap-2">
            {canBulkEdit && selectedIds.size > 0 ? (
              <Select
                placeholder={`Set status (${selectedIds.size} selected)`}
                onValueChange={(v) => handleBulkStatus(v as StudentStatus)}
                wrapperClassName="w-56"
                data-testid="students-bulk-status-select"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    Mark {opt.label}
                  </SelectItem>
                ))}
              </Select>
            ) : null}
            {permissions.canCreate ? (
              <Button onClick={() => setCreateOpen(true)} data-testid="students-create-button">
                <Plus className="size-4" aria-hidden="true" />
                Add student
              </Button>
            ) : null}
          </div>
        }
      />

      <div
        className="flex w-fit rounded-md border border-border p-0.5"
        role="group"
        aria-label="Filter students by status"
        data-testid="students-status-toggle"
      >
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            type="button"
            aria-pressed={status === tab.value}
            data-active={status === tab.value}
            onClick={() => setStatus(tab.value)}
            data-testid={tab.testId}
            className="inline-flex items-center rounded-sm px-3 py-1.5 text-sm font-medium text-fg-muted data-[active=true]:bg-card data-[active=true]:text-fg data-[active=true]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Name, email, or phone"
        savedViews={savedViews?.map((v) => ({ id: v.id, name: v.name }))}
        activeViewId={activeViewId}
        onSelectView={applyView}
        onSaveView={handleSaveView}
        onDeleteView={(id) => deleteSavedView.mutate(id)}
        data-testid="students-filter-bar"
      >
        <Select
          label="Course type"
          placeholder="All courses"
          value={courseType}
          onValueChange={(value) => setCourseType(value === "__all__" ? undefined : (value as CourseType))}
          wrapperClassName="w-44"
          data-testid="students-course-type-filter"
        >
          <SelectItem value="__all__">All courses</SelectItem>
          {COURSE_TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={sortedItems}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedStudentId(row.id)}
        sort={{ sortBy, sortDir, onSortChange: handleSortChange }}
        selection={canBulkEdit ? { selectedIds, onSelectionChange: setSelectedIds, getRowId: (row) => row.id } : undefined}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No students yet",
          description: "Try adjusting your filters, or add the first student.",
        }}
        caption="Student directory"
        data-testid="students-table"
      />

      <StudentFormDrawer open={createOpen} onOpenChange={setCreateOpen} onCreated={setRegisterStudent} />
      <RegisterStudentDialog
        student={registerStudent}
        open={registerStudent !== null}
        onOpenChange={(open) => !open && setRegisterStudent(null)}
        onRegistered={(s) => setAddProgramStudentId(s.id)}
      />
      {addProgramStudentId ? (
        <AddProgramDialog
          studentId={addProgramStudentId}
          open
          onOpenChange={(open) => !open && setAddProgramStudentId(null)}
        />
      ) : null}
      <StudentDetailDrawer studentId={selectedStudentId} onOpenChange={(open) => !open && setSelectedStudentId(null)} me={me} />
    </div>
  );
}
