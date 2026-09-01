// Curriculum builder — program -> modules -> lessons tree (docs/03 §7.4).
// Reorder approach: up/down buttons calling the `reorder` endpoints (full
// ordered-id-list semantics per @repo/types ReorderModulesRequest/
// ReorderLessonsRequest), NOT drag-and-drop — the task explicitly avoids
// adding a DnD dependency, and up/down buttons are simpler and more
// accessible (keyboard-operable out of the box, no pointer-only interaction).
import * as React from "react";
import { ChevronDown, ChevronUp, Eye, Lock, Paperclip, Pencil, Plus, Trash2, Video } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, Input, Select, SelectItem, Skeleton, StatusChip, useToast } from "@repo/ui";
import type { LessonNode, LessonType, ModuleNode, VideoAsset } from "@repo/types";

import {
  useCreateLesson,
  useCreateModule,
  useCurriculum,
  useDeleteLesson,
  useDeleteModule,
  useReorderLessons,
  useReorderModules,
  useUpdateLesson,
  useUpdateModule,
} from "../../hooks/use-courses";
import { useVideoLibraryList } from "../../hooks/use-video-library";
import { VideoIngestDrawer } from "../video-library/video-ingest-drawer";
import { LessonResourcesDrawer } from "./lesson-resources-drawer";
import { LessonFormDrawer } from "./lesson-form-drawer";
import { queryErrorMessage } from "../../lib/surface-error";

// Video status → StatusChip tone + author-facing label. `errored` is surfaced
// (not hidden) so a stuck transcode is visible right where the author works.
const VIDEO_STATUS_CHIP: Record<VideoAsset["status"], { tone: "success" | "warning" | "danger"; label: string }> = {
  ready: { tone: "success", label: "Video ready" },
  processing: { tone: "warning", label: "Video processing" },
  errored: { tone: "danger", label: "Video error" },
};

const LESSON_TYPES: { value: LessonType; label: string }[] = [
  { value: "video", label: "Video" },
  { value: "reading", label: "Reading" },
  { value: "assignment", label: "Assignment" },
  { value: "quiz", label: "Quiz" },
];

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved as T);
  return next;
}

interface CurriculumBuilderProps {
  programId: string;
  canEdit: boolean;
  /** Holds `videolib.view` — may see each video lesson's attached-video status. */
  canViewVideos: boolean;
  /** Holds `videolib.upload` — may attach/replace a lesson's video in place. */
  canManageVideos: boolean;
}

export function CurriculumBuilder({
  programId,
  canEdit,
  canViewVideos,
  canManageVideos,
}: CurriculumBuilderProps): React.JSX.Element {
  const { data: curriculum, isLoading, isError, error, refetch } = useCurriculum(programId);
  const { toast } = useToast();

  // Video assets are keyed by lesson (videos.lesson_id is 1:1), so one page of
  // the library is enough to annotate every video lesson with its status. Only
  // fetched when the user can view the library — otherwise the request 403s.
  const { data: videosPage } = useVideoLibraryList(
    { page: 1, pageSize: 200 },
    { enabled: canViewVideos },
  );
  const videoByLessonId = React.useMemo(() => {
    const map = new Map<string, VideoAsset>();
    for (const asset of videosPage?.items ?? []) map.set(asset.lessonId, asset);
    return map;
  }, [videosPage]);

  // Lesson whose video attach/replace drawer is open. "attach" seeds a lessonId;
  // "replace" carries the existing VideoAsset so the drawer locks to its lesson.
  const [videoDrawer, setVideoDrawer] = React.useState<
    { mode: "attach"; lessonId: string; lessonTitle: string } | { mode: "replace"; video: VideoAsset } | null
  >(null);

  const createModule = useCreateModule(programId);
  const updateModule = useUpdateModule(programId);
  const reorderModules = useReorderModules(programId);
  const createLesson = useCreateLesson(programId);
  const updateLesson = useUpdateLesson(programId);
  const reorderLessons = useReorderLessons(programId);
  const deleteLesson = useDeleteLesson(programId);
  const deleteModule = useDeleteModule(programId);

  // Lesson editor (title / type / body) — replaces the old inline rename.
  const [editingLessonNode, setEditingLessonNode] = React.useState<{ moduleId: string; lesson: LessonNode } | null>(null);
  // One confirm for both kinds of delete; the copy names what is about to go.
  const [deleteTarget, setDeleteTarget] = React.useState<
    | { kind: "lesson"; moduleId: string; lessonId: string; title: string }
    | { kind: "module"; moduleId: string; title: string; lessonCount: number }
    | null
  >(null);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === "lesson") {
        await deleteLesson.mutateAsync({ moduleId: deleteTarget.moduleId, lessonId: deleteTarget.lessonId });
        toast({ title: "Lesson deleted", description: "Enrolled students' progress has been recalculated.", variant: "success" });
      } else {
        await deleteModule.mutateAsync(deleteTarget.moduleId);
        toast({ title: "Module deleted", description: "Its lessons were removed and students' progress recalculated.", variant: "success" });
      }
      setDeleteTarget(null);
    } catch (error) {
      toast({
        title: deleteTarget.kind === "lesson" ? "Couldn't delete lesson" : "Couldn't delete module",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const [newModuleTitle, setNewModuleTitle] = React.useState("");
  const [editingModuleId, setEditingModuleId] = React.useState<string | null>(null);
  const [editingModuleTitle, setEditingModuleTitle] = React.useState("");
  const [addingLessonForModule, setAddingLessonForModule] = React.useState<string | null>(null);
  const [newLessonTitle, setNewLessonTitle] = React.useState("");
  const [newLessonType, setNewLessonType] = React.useState<LessonType>("video");
  // Lesson whose attachments drawer is open (PDF/slides/datasets).
  const [resourcesFor, setResourcesFor] = React.useState<
    { id: string; title: string; moduleId: string } | null
  >(null);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" data-testid="curriculum-loading">
        <Skeleton shape="block" />
        <Skeleton shape="block" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        data-testid="curriculum-error"
        title="Couldn't load curriculum"
        description={queryErrorMessage(error, "Something went wrong fetching the modules and lessons.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="curriculum-retry">
            Try again
          </Button>
        }
      />
    );
  }

  const modules = curriculum?.modules ?? [];

  const handleAddModule = async () => {
    if (!newModuleTitle.trim()) return;
    try {
      await createModule.mutateAsync({ title: newModuleTitle.trim(), order: modules.length });
      setNewModuleTitle("");
      toast({ title: "Module added", variant: "success" });
    } catch (error) {
      toast({ title: "Couldn't add module", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleSaveModuleTitle = async (moduleId: string) => {
    if (!editingModuleTitle.trim()) return;
    try {
      await updateModule.mutateAsync({ moduleId, body: { title: editingModuleTitle.trim() } });
      setEditingModuleId(null);
      toast({ title: "Module updated", variant: "success" });
    } catch (error) {
      toast({ title: "Couldn't update module", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleMoveModule = async (index: number, direction: -1 | 1) => {
    const reordered = moveItem(modules, index, direction);
    if (reordered === modules) return;
    try {
      await reorderModules.mutateAsync({ moduleIds: reordered.map((m) => m.id) });
    } catch (error) {
      toast({ title: "Couldn't reorder modules", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleAddLesson = async (moduleNode: ModuleNode) => {
    if (!newLessonTitle.trim()) return;
    try {
      await createLesson.mutateAsync({
        moduleId: moduleNode.id,
        body: { title: newLessonTitle.trim(), type: newLessonType, order: moduleNode.lessons.length, isPreview: false },
      });
      setNewLessonTitle("");
      setAddingLessonForModule(null);
      toast({ title: "Lesson added", variant: "success" });
    } catch (error) {
      toast({ title: "Couldn't add lesson", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  /**
   * Flips a lesson's `is_preview` flag — the single control over what a prospect can
   * watch for free on the marketing site before enrolling. Toast names the effect in
   * marketing terms, not schema terms.
   */
  const handleTogglePreview = async (moduleId: string, lessonId: string, current: boolean) => {
    try {
      await updateLesson.mutateAsync({ moduleId, lessonId, body: { isPreview: !current } });
      toast({
        title: current ? "Preview turned off" : "Free preview turned on",
        description: current
          ? "Visitors now see this lesson locked on the website."
          : "Visitors can watch this lesson on the website before enrolling.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Couldn't update the preview setting",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleMoveLesson = async (moduleNode: ModuleNode, index: number, direction: -1 | 1) => {
    const reordered = moveItem(moduleNode.lessons, index, direction);
    if (reordered === moduleNode.lessons) return;
    try {
      await reorderLessons.mutateAsync({ moduleId: moduleNode.id, body: { lessonIds: reordered.map((l) => l.id) } });
    } catch (error) {
      toast({ title: "Couldn't reorder lessons", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="curriculum-builder">
      {modules.length === 0 ? (
        <EmptyState
          data-testid="curriculum-empty"
          title="No modules yet"
          description="Add the first module to start building this program's curriculum."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {modules.map((moduleNode, moduleIndex) => (
            <li key={moduleNode.id} className="rounded-md border border-border" data-testid="curriculum-module">
              <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
                {editingModuleId === moduleNode.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      aria-label="Module title"
                      value={editingModuleTitle}
                      onChange={(event) => setEditingModuleTitle(event.target.value)}
                      placeholder="e.g. Introduction to React"
                      data-testid="module-edit-input"
                    />
                    <Button size="sm" onClick={() => handleSaveModuleTitle(moduleNode.id)} data-testid="module-save-button">
                      Save
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditingModuleId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <span className="font-medium text-fg" data-testid="module-title">
                    {moduleIndex + 1}. {moduleNode.title}
                  </span>
                )}
                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move module up"
                      disabled={moduleIndex === 0 || reorderModules.isPending}
                      onClick={() => handleMoveModule(moduleIndex, -1)}
                      data-testid="module-move-up"
                    >
                      <ChevronUp className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move module down"
                      disabled={moduleIndex === modules.length - 1 || reorderModules.isPending}
                      onClick={() => handleMoveModule(moduleIndex, 1)}
                      data-testid="module-move-down"
                    >
                      <ChevronDown className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit module ${moduleNode.title}`}
                      onClick={() => {
                        setEditingModuleId(moduleNode.id);
                        setEditingModuleTitle(moduleNode.title);
                      }}
                      data-testid="module-edit-button"
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete module ${moduleNode.title}`}
                      title="Delete module"
                      onClick={() =>
                        setDeleteTarget({
                          kind: "module",
                          moduleId: moduleNode.id,
                          title: moduleNode.title,
                          lessonCount: moduleNode.lessons.length,
                        })
                      }
                      data-testid="module-delete-button"
                    >
                      <Trash2 className="size-4 text-danger" aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="p-3">
                {moduleNode.lessons.length === 0 ? (
                  <p className="text-sm text-fg-muted" data-testid="module-lessons-empty">
                    No lessons in this module yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {moduleNode.lessons.map((lesson, lessonIndex) => {
                      const video = lesson.type === "video" ? videoByLessonId.get(lesson.id) : undefined;
                      return (
                      <li
                        key={lesson.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5"
                        data-testid="curriculum-lesson"
                      >
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid="lesson-title">
                            <span className="text-fg">
                              {lessonIndex + 1}. {lesson.title}{" "}
                              <span className="text-fg-subtle">({lesson.type})</span>
                            </span>
                            {/* Attached-video status — only for video lessons, only when
                                the user may see the library. "No video" is a gentle nudge,
                                not an error, so it stays neutral. */}
                            {lesson.type === "video" && canViewVideos ? (
                              video ? (
                                <StatusChip
                                  size="sm"
                                  tone={VIDEO_STATUS_CHIP[video.status].tone}
                                  label={VIDEO_STATUS_CHIP[video.status].label}
                                  data-testid="lesson-video-status"
                                />
                              ) : (
                                <StatusChip
                                  size="sm"
                                  tone="neutral"
                                  label="No video"
                                  data-testid="lesson-video-status"
                                />
                              )
                            ) : null}
                            {/* Free-preview badge — mirrors what the public site shows. */}
                            {lesson.isPreview ? (
                              <StatusChip
                                size="sm"
                                tone="success"
                                label="Free preview"
                                icon={<Eye className="size-3" aria-hidden="true" />}
                                data-testid="lesson-preview-badge"
                              />
                            ) : null}
                          </span>

                        {canEdit ? (
                          <div className="flex items-center gap-1">
                            {/*
                              FREE-PREVIEW TOGGLE. `is_preview` is what the marketing site
                              uses to decide which lessons a prospect may watch before
                              enrolling — everything else renders with a lock. The server is
                              the gate (public preview endpoint + LMS enrollment gate both
                              re-check this flag); this button only flips the flag.
                            */}
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={
                                lesson.isPreview
                                  ? `Stop offering ${lesson.title} as a free preview`
                                  : `Offer ${lesson.title} as a free preview on the website`
                              }
                              title={lesson.isPreview ? "Free preview, visible on the website" : "Locked, enrol to watch"}
                              aria-pressed={lesson.isPreview}
                              disabled={updateLesson.isPending}
                              onClick={() => handleTogglePreview(moduleNode.id, lesson.id, lesson.isPreview)}
                              data-testid="lesson-preview-toggle"
                            >
                              {lesson.isPreview ? (
                                <Eye className="size-4 text-success" aria-hidden="true" />
                              ) : (
                                <Lock className="size-4" aria-hidden="true" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Move lesson up"
                              disabled={lessonIndex === 0 || reorderLessons.isPending}
                              onClick={() => handleMoveLesson(moduleNode, lessonIndex, -1)}
                              data-testid="lesson-move-up"
                            >
                              <ChevronUp className="size-4" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Move lesson down"
                              disabled={lessonIndex === moduleNode.lessons.length - 1 || reorderLessons.isPending}
                              onClick={() => handleMoveLesson(moduleNode, lessonIndex, 1)}
                              data-testid="lesson-move-down"
                            >
                              <ChevronDown className="size-4" aria-hidden="true" />
                            </Button>
                            {/* Attach/replace the lesson's video in place — the same
                                1:1 "ingest == attach" endpoint the Video Library uses,
                                surfaced here so authors don't have to leave the
                                curriculum and re-pick the program + lesson. Video-type
                                lessons only. */}
                            {lesson.type === "video" && canManageVideos ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={video ? `Replace video for ${lesson.title}` : `Add video to ${lesson.title}`}
                                title={video ? "Replace video" : "Add video"}
                                onClick={() =>
                                  setVideoDrawer(
                                    video
                                      ? { mode: "replace", video }
                                      : { mode: "attach", lessonId: lesson.id, lessonTitle: lesson.title },
                                  )
                                }
                                data-testid="lesson-video-button"
                              >
                                <Video className="size-4" aria-hidden="true" />
                              </Button>
                            ) : null}
                            {/* The lesson's summary + its attachments — kept distinct from the
                                video action above; this is the paperclip. */}
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit summary and resources for ${lesson.title}`}
                              title="Summary and resources"
                              onClick={() =>
                                setResourcesFor({ id: lesson.id, title: lesson.title, moduleId: moduleNode.id })
                              }
                              data-testid="lesson-resources-button"
                            >
                              <Paperclip className="size-4" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit lesson ${lesson.title}`}
                              title="Edit title, type and content"
                              onClick={() => setEditingLessonNode({ moduleId: moduleNode.id, lesson })}
                              data-testid="lesson-edit-button"
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete lesson ${lesson.title}`}
                              title="Delete lesson"
                              onClick={() =>
                                setDeleteTarget({ kind: "lesson", moduleId: moduleNode.id, lessonId: lesson.id, title: lesson.title })
                              }
                              data-testid="lesson-delete-button"
                            >
                              <Trash2 className="size-4 text-danger" aria-hidden="true" />
                            </Button>
                          </div>
                        ) : null}
                      </li>
                      );
                    })}
                  </ul>
                )}

                {canEdit ? (
                  addingLessonForModule === moduleNode.id ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <Input
                        label="Lesson title"
                        required
                        value={newLessonTitle}
                        onChange={(event) => setNewLessonTitle(event.target.value)}
                        placeholder="e.g. Setting up your dev environment"
                        wrapperClassName="w-56"
                        data-testid="lesson-new-title"
                      />
                      <Select
                        label="Type"
                        required
                        placeholder="Select type"
                        value={newLessonType}
                        onValueChange={(value) => setNewLessonType(value as LessonType)}
                        wrapperClassName="w-36"
                        data-testid="lesson-new-type"
                      >
                        {LESSON_TYPES.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </Select>
                      <Button onClick={() => handleAddLesson(moduleNode)} loading={createLesson.isPending} data-testid="lesson-add-confirm">
                        Add
                      </Button>
                      <Button variant="secondary" onClick={() => setAddingLessonForModule(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      onClick={() => setAddingLessonForModule(moduleNode.id)}
                      data-testid="lesson-add-button"
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      Add lesson
                    </Button>
                  )
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="flex items-end gap-2 rounded-md border border-dashed border-border p-3">
          <Input
            label="New module title"
            required
            value={newModuleTitle}
            onChange={(event) => setNewModuleTitle(event.target.value)}
            placeholder="e.g. Introduction to React"
            wrapperClassName="w-64"
            data-testid="module-new-title"
          />
          <Button onClick={handleAddModule} loading={createModule.isPending} data-testid="module-add-button">
            <Plus className="size-4" aria-hidden="true" />
            Add module
          </Button>
        </div>
      ) : null}

      {/* The selected lesson's summary + its attachments. */}
      <LessonResourcesDrawer
        programId={programId}
        moduleId={resourcesFor?.moduleId ?? null}
        lessonId={resourcesFor?.id ?? null}
        lessonTitle={resourcesFor?.title ?? ""}
        open={Boolean(resourcesFor)}
        onOpenChange={(open) => !open && setResourcesFor(null)}
        canEdit={canEdit}
      />

      {/* Title / type / body editor for the selected lesson. */}
      <LessonFormDrawer
        programId={programId}
        moduleId={editingLessonNode?.moduleId ?? null}
        lesson={editingLessonNode?.lesson ?? null}
        open={Boolean(editingLessonNode)}
        onOpenChange={(open) => !open && setEditingLessonNode(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={
          deleteTarget?.kind === "module"
            ? `Delete module "${deleteTarget.title}"?`
            : `Delete lesson "${deleteTarget?.title ?? ""}"?`
        }
        description={
          deleteTarget?.kind === "module"
            ? deleteTarget.lessonCount > 0
              ? `This removes the module and its ${deleteTarget.lessonCount} lesson${deleteTarget.lessonCount === 1 ? "" : "s"} from the course. Enrolled students will no longer see them, and their progress will be recalculated.`
              : "This removes the empty module from the course."
            : "Enrolled students will no longer see this lesson, and their progress will be recalculated. Its video and attachments are kept."
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleConfirmDelete}
        loading={deleteLesson.isPending || deleteModule.isPending}
        data-testid="confirm-delete-curriculum"
      />

      {/* Attach/replace a lesson's video without leaving the curriculum. */}
      <VideoIngestDrawer
        open={Boolean(videoDrawer)}
        onOpenChange={(open) => !open && setVideoDrawer(null)}
        replaceFor={videoDrawer?.mode === "replace" ? videoDrawer.video : null}
        attachFor={
          videoDrawer?.mode === "attach"
            ? { lessonId: videoDrawer.lessonId, lessonTitle: videoDrawer.lessonTitle }
            : null
        }
      />
    </div>
  );
}
