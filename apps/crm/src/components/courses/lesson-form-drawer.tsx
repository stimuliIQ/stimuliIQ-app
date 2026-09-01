// Lesson editor — title, type and the lesson body, in one drawer.
//
// Until now a lesson could only be renamed inline; its type and its body (`content`,
// the HTML a student reads on a reading/quiz/assignment lesson) were writable through
// the API and editable nowhere. The body is fetched per-lesson (GET .../lessons/:id)
// because the curriculum tree omits it on purpose.
//
// A VIDEO lesson has a body too. It used to be refused one — this drawer said "a video
// lesson's content is its video" and dropped `content` from the PATCH — which left a video
// lesson as a bare player with nothing written around it: no summary of what the video
// covers, no notes to read alongside it, nowhere to put the reading meant to follow it. The
// column and the API always accepted a body; only the two UIs refused. So the field is now
// offered for every type, worded per type, and the LMS renders it under the player. The
// camera-button note stays: attaching the video is still a different control, and the
// textarea must not look like where that goes.
import * as React from "react";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  Input,
  Select,
  SelectItem,
  Skeleton,
  Textarea,
  useToast,
} from "@repo/ui";
import type { LessonNode, LessonType } from "@repo/types";

import { useLesson, useUpdateLesson } from "../../hooks/use-courses";

const LESSON_TYPES: { value: LessonType; label: string }[] = [
  { value: "video", label: "Video" },
  { value: "reading", label: "Reading" },
  { value: "assignment", label: "Assignment" },
  { value: "quiz", label: "Quiz" },
];

export interface LessonFormDrawerProps {
  programId: string;
  moduleId: string | null;
  lesson: LessonNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LessonFormDrawer({ programId, moduleId, lesson, open, onOpenChange }: LessonFormDrawerProps): React.JSX.Element {
  const { data: detail, isLoading, isError, refetch } = useLesson(
    programId,
    open ? moduleId : null,
    open ? (lesson?.id ?? null) : null,
  );
  const updateLesson = useUpdateLesson(programId);
  const { toast } = useToast();

  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<LessonType>("video");
  const [content, setContent] = React.useState("");
  const [titleError, setTitleError] = React.useState<string | null>(null);

  // Seed the form from the fetched lesson, and again if a different lesson is opened.
  React.useEffect(() => {
    if (!detail) return;
    setTitle(detail.title);
    setType(detail.type);
    setContent(detail.content ?? "");
    setTitleError(null);
  }, [detail]);

  const handleSave = async () => {
    if (!lesson || !moduleId) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError("Enter a lesson title");
      return;
    }
    try {
      await updateLesson.mutateAsync({
        moduleId,
        lessonId: lesson.id,
        body: { title: trimmed, type, content },
      });
      toast({ title: "Lesson updated", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Couldn't update lesson",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Edit lesson" description={lesson?.title} size="lg" data-testid="lesson-form-drawer">
        <DrawerBody>
          {isLoading ? (
            <div className="flex flex-col gap-3" data-testid="lesson-form-loading">
              <Skeleton shape="line" />
              <Skeleton shape="line" />
              <Skeleton shape="block" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-start gap-2" data-testid="lesson-form-error">
              <p className="text-sm text-danger">Couldn&apos;t load this lesson.</p>
              <Button variant="secondary" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Input
                label="Title"
                required
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleError(null);
                }}
                error={titleError ?? undefined}
                data-testid="lesson-form-title"
              />
              <Select
                label="Type"
                required
                value={type}
                onValueChange={(value) => setType(value as LessonType)}
                data-testid="lesson-form-type"
              >
                {LESSON_TYPES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>
              {type === "video" ? (
                <p
                  className="rounded-md border border-border bg-surface p-3 text-sm text-fg-muted"
                  data-testid="lesson-form-video-note"
                >
                  The video itself is attached with the camera button on the lesson row. Write what goes
                  <em> around</em> it below.
                </p>
              ) : null}
              <Textarea
                label={type === "video" ? "Summary & notes" : "Content"}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={14}
                placeholder={
                  type === "video"
                    ? "What this video covers, key points, and anything to read or do after watching. HTML is allowed."
                    : type === "quiz"
                      ? "Questions and instructions students see on this lesson. HTML is allowed."
                      : type === "assignment"
                        ? "The brief students see on this lesson. HTML is allowed."
                        : "What students read on this lesson. HTML is allowed."
                }
                helperText={
                  type === "video"
                    ? "Shown to enrolled students underneath the player. Plain text or HTML."
                    : "Shown to enrolled students on the lesson page. Plain text or HTML."
                }
                data-testid="lesson-form-content"
              />
            </div>
          )}
        </DrawerBody>
        <DrawerFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={updateLesson.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            loading={updateLesson.isPending}
            disabled={isLoading || isError}
            data-testid="lesson-form-save"
          >
            Save lesson
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
