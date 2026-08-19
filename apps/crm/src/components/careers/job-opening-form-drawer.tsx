// Create / edit a job opening (ADR-0066). Plain-useState form bound to
// CreateJobOpeningRequest / UpdateJobOpeningRequest (@repo/types), mirroring
// college-form-drawer.tsx's flat-scalar-fields convention.
//
// THE AUTHOR IS WRITING A PUBLIC ADVERT, and the form says so throughout: the live URL is
// shown as they type the title, and publishing is a deliberate choice on a field labelled
// for what it does to the website rather than a generic "status".
//
// Responsibilities and requirements are edited as one textarea each, one bullet per line,
// and split on save. A repeating add-a-row editor is the right control when rows have
// structure; these are single strings, and typing five lines into a textarea beats clicking
// "Add" five times.
import * as React from "react";
import {
  Alert,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  Input,
  Select,
  SelectItem,
  Textarea,
  useToast,
} from "@repo/ui";
import type { CreateJobOpeningRequest, JobOpening, JobOpeningStatus, JobOpeningWorkMode } from "@repo/types";
import { slugifyJobOpeningTitle } from "@repo/types";

import { useCreateJobOpening, useUpdateJobOpening } from "../../hooks/use-careers";
import { surfaceError } from "../../lib/surface-error";
import { jobOpeningDisplayUrl } from "../../lib/public-urls";

const STATUS_OPTIONS: Array<{ value: JobOpeningStatus; label: string; hint: string }> = [
  { value: "draft", label: "Draft — not on the website", hint: "Write it now, publish when you are ready." },
  { value: "published", label: "Published — live on the website", hint: "Visible on /careers and accepting applications." },
  { value: "closed", label: "Closed — taken down", hint: "Off the website. Its applications are kept." },
];

const WORK_MODE_OPTIONS: Array<{ value: JobOpeningWorkMode; label: string }> = [
  { value: "onsite", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
];

/** One bullet per line; blank lines dropped. The inverse of `linesToText`. */
function textToLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

function linesToText(lines: string[]): string {
  return lines.join("\n");
}

export interface JobOpeningFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opening: JobOpening | null;
}

export function JobOpeningFormDrawer({ open, onOpenChange, opening }: JobOpeningFormDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const createOpening = useCreateJobOpening();
  const updateOpening = useUpdateJobOpening();
  const isEdit = Boolean(opening);

  const [title, setTitle] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [employmentType, setEmploymentType] = React.useState("Full-time");
  const [location, setLocation] = React.useState("");
  const [workMode, setWorkMode] = React.useState<JobOpeningWorkMode | "">("");
  const [experienceLevel, setExperienceLevel] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [responsibilities, setResponsibilities] = React.useState("");
  const [requirements, setRequirements] = React.useState("");
  const [compensationNote, setCompensationNote] = React.useState("");
  const [status, setStatus] = React.useState<JobOpeningStatus>("draft");
  const [order, setOrder] = React.useState(0);
  const [openingsCount, setOpeningsCount] = React.useState(1);
  const [closesOn, setClosesOn] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setTitle(opening?.title ?? "");
    setSlug(opening?.slug ?? "");
    setDepartment(opening?.department ?? "");
    setEmploymentType(opening?.employmentType ?? "Full-time");
    setLocation(opening?.location ?? "");
    setWorkMode(opening?.workMode ?? "");
    setExperienceLevel(opening?.experienceLevel ?? "");
    setSummary(opening?.summary ?? "");
    setDescription(opening?.description ?? "");
    setResponsibilities(linesToText(opening?.responsibilities ?? []));
    setRequirements(linesToText(opening?.requirements ?? []));
    setCompensationNote(opening?.compensationNote ?? "");
    setStatus(opening?.status ?? "draft");
    setOrder(opening?.order ?? 0);
    setOpeningsCount(opening?.openingsCount ?? 1);
    setClosesOn(opening?.closesOn ?? "");
  }, [open, opening]);

  const isPending = createOpening.isPending || updateOpening.isPending;

  // What the URL will actually be. Shown live so the author sees the public link before
  // publishing rather than discovering it afterwards.
  const effectiveSlug = slug.trim() || slugifyJobOpeningTitle(title);
  const canSubmit =
    title.trim().length > 0 && employmentType.trim().length > 0 && location.trim().length > 0 && summary.trim().length > 0;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;

    const body: CreateJobOpeningRequest = {
      title: title.trim(),
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      department: department.trim() || null,
      employmentType: employmentType.trim(),
      location: location.trim(),
      workMode: workMode || null,
      experienceLevel: experienceLevel.trim() || null,
      summary: summary.trim(),
      description: description.trim() || null,
      responsibilities: textToLines(responsibilities),
      requirements: textToLines(requirements),
      compensationNote: compensationNote.trim() || null,
      status,
      order,
      openingsCount,
      closesOn: closesOn.trim() || null,
    };

    try {
      if (opening) {
        await updateOpening.mutateAsync({ id: opening.id, body });
        toast({ title: "Opening updated", variant: "success" });
      } else {
        await createOpening.mutateAsync(body);
        toast({ title: status === "published" ? "Opening published" : "Opening saved as a draft", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, isEdit ? "Couldn't update this opening" : "Couldn't create this opening");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={isEdit ? "Edit opening" : "New opening"}
        description={
          isEdit
            ? "Changes appear on the website as soon as you save, if this opening is published."
            : "Write the advert here. Nothing is public until you set it to Published."
        }
        size="lg"
        data-testid="job-opening-form-drawer"
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DrawerBody className="space-y-5">
            <Input
              label="Role title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Senior Clinical Research Instructor"
              data-testid="opening-title"
            />

            <Input
              label="URL slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={slugifyJobOpeningTitle(title) || "derived-from-the-title"}
              helperText={
                effectiveSlug
                  ? `Candidates can link straight to this role: ${jobOpeningDisplayUrl(effectiveSlug)}`
                  : "Leave blank to derive it from the title."
              }
              data-testid="opening-slug"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Employment type"
                required
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value)}
                placeholder="Full-time"
                data-testid="opening-employment-type"
              />
              <Input
                label="Location"
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Visakhapatnam"
                data-testid="opening-location"
              />
              <Select
                label="Work mode"
                value={workMode}
                onValueChange={(value) => setWorkMode((value as JobOpeningWorkMode) || "")}
                data-testid="opening-work-mode"
              >
                <SelectItem value="">Not specified</SelectItem>
                {WORK_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </Select>
              <Input
                label="Department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Academics"
                data-testid="opening-department"
              />
              <Input
                label="Experience level"
                value={experienceLevel}
                onChange={(e) => setExperienceLevel(e.target.value)}
                placeholder="2–4 years"
                data-testid="opening-experience"
              />
              <Input
                label="Positions open"
                type="number"
                min={1}
                value={openingsCount}
                onChange={(e) => setOpeningsCount(Math.max(1, Number(e.target.value) || 1))}
                data-testid="opening-count"
              />
            </div>

            <Textarea
              label="Summary"
              required
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              helperText="One or two sentences. This is the line candidates read on the careers page before they expand the role."
              data-testid="opening-summary"
            />

            <Textarea
              label="Full description"
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              helperText="Optional. Leave a blank line between paragraphs."
              data-testid="opening-description"
            />

            <Textarea
              label="What they'll do"
              rows={5}
              value={responsibilities}
              onChange={(e) => setResponsibilities(e.target.value)}
              helperText="One per line — each line becomes a bullet point."
              data-testid="opening-responsibilities"
            />

            <Textarea
              label="What we're looking for"
              rows={5}
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              helperText="One per line — each line becomes a bullet point."
              data-testid="opening-requirements"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Compensation note"
                value={compensationNote}
                onChange={(e) => setCompensationNote(e.target.value)}
                placeholder="₹4–6 LPA, based on experience"
                helperText="Optional, and shown publicly. Leave blank rather than writing 'negotiable'."
                data-testid="opening-compensation"
              />
              <Input
                label="Applications close on"
                type="date"
                value={closesOn}
                onChange={(e) => setClosesOn(e.target.value)}
                helperText="Optional. The role comes off the site by itself after this date — no need to remember."
                data-testid="opening-closes-on"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Visibility"
                value={status}
                onValueChange={(value) => setStatus(value as JobOpeningStatus)}
                helperText={STATUS_OPTIONS.find((option) => option.value === status)?.hint}
                data-testid="opening-status"
              >
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </Select>
              <Input
                label="Display order"
                type="number"
                min={0}
                value={order}
                onChange={(e) => setOrder(Math.max(0, Number(e.target.value) || 0))}
                helperText="Lower numbers appear first on the careers page."
                data-testid="opening-order"
              />
            </div>

            {status === "published" ? (
              <Alert tone="info" title="This will be live on the website">
                Once you save, anyone visiting {jobOpeningDisplayUrl(effectiveSlug)} can read this advert and apply to it.
              </Alert>
            ) : null}
          </DrawerBody>

          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending} disabled={!canSubmit} data-testid="opening-submit">
              {isEdit ? "Save changes" : status === "published" ? "Publish opening" : "Save draft"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
