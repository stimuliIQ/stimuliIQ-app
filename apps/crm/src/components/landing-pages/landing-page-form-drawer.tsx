// Landing page create/edit drawer — a single richtext content block edited
// as HTML with a RenderSink preview (the full typed content-block builder is
// out of scope for this pass; `content` is an array of `ContentBlock`
// records, and a single `{type:"richtext", data:{html}}` block is a valid,
// renderable member of that array). Phase 9 Completion T33/T40.
//
// GAP 1: there is no CRM controller implementing `/api/v1/crm/landing-pages`
// in apps/api yet (only the PUBLIC read side exists, under
// apps/api/src/modules/growth) — this form is wired against the real
// `@repo/api-client` SDK method and will work as soon as that controller
// ships; until then, submitting here 404s. Flagged in the final task report.
// GAP 2: `LandingPagesApi` has no `get(id)` — only list/create/update — and
// the list only returns `LandingPageSummary` (no `content`). Same fix as the
// KB article form: the content field is OPTIONAL when editing; leaving it
// blank omits `content` from the PATCH (UpdateLandingPageRequestSchema is
// `.partial()`), preserving the existing blocks server-side.
import * as React from "react";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, RenderSink, Select, SelectItem, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from "@repo/ui";
import type { ContentStatus, LandingPageSummary } from "@repo/types";

import { useCreateLandingPage, useUpdateLandingPage } from "../../hooks/use-landing-pages";
import { surfaceError } from "../../lib/surface-error";

const STATUS_OPTIONS: ContentStatus[] = ["draft", "published", "archived"];

interface LandingPageFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page?: LandingPageSummary | null;
}

export function LandingPageFormDrawer({ open, onOpenChange, page }: LandingPageFormDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const createPage = useCreateLandingPage();
  const updatePage = useUpdateLandingPage();
  const isEdit = Boolean(page);

  const [campaign, setCampaign] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [variant, setVariant] = React.useState("a");
  const [html, setHtml] = React.useState("");
  const [seoTitle, setSeoTitle] = React.useState("");
  const [seoDescription, setSeoDescription] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus>("draft");

  React.useEffect(() => {
    if (!open) return;
    setCampaign(page?.campaign ?? "");
    setSlug(page?.slug ?? "");
    setTitle(page?.title ?? "");
    setVariant(page?.variant ?? "a");
    setHtml("");
    setSeoTitle("");
    setSeoDescription("");
    setStatus(page?.status ?? "draft");
  }, [open, page]);

  const isPending = createPage.isPending || updatePage.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = html.trim() ? [{ type: "richtext", data: { html } }] : undefined;
    try {
      if (isEdit && page) {
        await updatePage.mutateAsync({
          id: page.id,
          body: {
            campaign: campaign || undefined,
            slug,
            title,
            variant,
            ...(content ? { content } : {}),
            seoTitle: seoTitle || undefined,
            seoDescription: seoDescription || undefined,
            status,
          },
        });
        toast({ title: "Landing page updated", variant: "success" });
      } else {
        await createPage.mutateAsync({
          campaign: campaign || undefined,
          slug,
          title,
          variant,
          content: content ?? [],
          seoTitle: seoTitle || undefined,
          seoDescription: seoDescription || undefined,
          status,
        });
        toast({ title: "Landing page created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this landing page");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center" title={isEdit ? "Edit landing page" : "New landing page"} size="lg" data-testid="landing-page-form-drawer">
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Title" required placeholder="e.g. Summer Campaign Landing" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="landing-page-title-input" />
            <div className="flex gap-3">
              <Input label="Web address" required placeholder="e.g. summer-campaign" value={slug} onChange={(e) => setSlug(e.target.value)} wrapperClassName="flex-1" data-testid="landing-page-slug-input" />
              <Input
                label="Version"
                placeholder="e.g. A"
                helperText="For A/B testing"
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                wrapperClassName="w-28"
                data-testid="landing-page-variant-input"
              />
            </div>
            <Input label="Campaign (optional)" placeholder="e.g. Summer 2026 Enrollment" value={campaign} onChange={(e) => setCampaign(e.target.value)} data-testid="landing-page-campaign-input" />

            <Tabs defaultValue="write">
              <TabsList aria-label="Content editor mode">
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="write">
                <Textarea
                  id="landing-page-html"
                  aria-label="Content (HTML)"
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  rows={10}
                  placeholder={isEdit ? "Leave blank to keep the existing content unchanged" : "<p>Landing page content (HTML)…</p>"}
                  data-testid="landing-page-html-input"
                />
              </TabsContent>
              <TabsContent value="preview">
                <RenderSink html={html} emptyTitle="Nothing to preview" data-testid="landing-page-preview" />
              </TabsContent>
            </Tabs>

            <Input label="SEO title" placeholder="e.g. Enroll in Our Summer B.Tech Internship Program" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} data-testid="landing-page-seo-title-input" />
            <Input label="SEO description" placeholder="e.g. Join our 6-month B.Tech internship program with hands-on projects" value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} data-testid="landing-page-seo-description-input" />

            <Select label="Status" value={status} onValueChange={(v) => setStatus(v as ContentStatus)} placeholder="Select status" data-testid="landing-page-status-select">
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </Select>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending} disabled={!title.trim() || !slug.trim()} data-testid="landing-page-form-submit">
              {isEdit ? "Save changes" : "Create"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
