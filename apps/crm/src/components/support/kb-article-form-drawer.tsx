// KB article create/edit drawer with a RenderSink live preview.
//
// GAP: `KbArticlesApi` (packages/api-client/src/crm/support.api.ts) exposes
// list/create/update but NO get-by-id — the list only returns
// `KbArticleSummary` (no `body`). Editing therefore can't pre-fill the
// existing body. Rather than silently wiping content on save, the body
// field is OPTIONAL when editing: leaving it blank omits `body` from the
// PATCH payload entirely (UpdateKbArticleRequestSchema is `.partial()`),
// preserving the existing content server-side. Flagged as a follow-up:
// add `GET /api/v1/crm/kb-articles/:id` to fetch the full body for editing.
import * as React from "react";
import { Button, Checkbox, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, RenderSink, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from "@repo/ui";
import type { KbArticleSummary } from "@repo/types";

import { useCreateKbArticle, useUpdateKbArticle } from "../../hooks/use-tickets";
import { surfaceError } from "../../lib/surface-error";

interface KbArticleFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  article: KbArticleSummary | null;
}

export function KbArticleFormDrawer({ open, onOpenChange, article }: KbArticleFormDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const createArticle = useCreateKbArticle();
  const updateArticle = useUpdateKbArticle();
  const isEdit = Boolean(article);

  const [title, setTitle] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [body, setBody] = React.useState("");
  const [published, setPublished] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTitle(article?.title ?? "");
    setSlug(article?.slug ?? "");
    setCategory(article?.category ?? "");
    setBody("");
    setPublished(article?.published ?? false);
  }, [open, article]);

  const isPending = createArticle.isPending || updateArticle.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (isEdit && article) {
        await updateArticle.mutateAsync({
          id: article.id,
          body: {
            title: title || undefined,
            slug: slug || undefined,
            category: category || undefined,
            published,
            ...(body.trim() ? { body } : {}),
          },
        });
        toast({ title: "Article updated", variant: "success" });
      } else {
        await createArticle.mutateAsync({ title, slug, category: category || undefined, body, published });
        toast({ title: "Article created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this article");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center" title={isEdit ? "Edit article" : "New article"} size="lg" data-testid="kb-article-form-drawer">
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. How to reset your password" data-testid="kb-article-title-input" />
            <Input
              label="Slug"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. how-to-reset-password"
              helperText="Lowercase kebab-case, e.g. how-to-reset-password"
              data-testid="kb-article-slug-input"
            />
            <Input label="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Account & Billing" data-testid="kb-article-category-input" />

            <Tabs defaultValue="write">
              <TabsList aria-label="Body editor mode">
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="write">
                <Textarea
                  id="kb-article-body"
                  label="Body (HTML)"
                  // Only mandatory on create — an edit that leaves this blank keeps the
                  // existing body (see the submit gate below).
                  required={!isEdit}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  placeholder={isEdit ? "Leave blank to keep the existing body unchanged" : "<p>Article body (HTML)…</p>"}
                  data-testid="kb-article-body-input"
                />
              </TabsContent>
              <TabsContent value="preview">
                <RenderSink html={body} emptyTitle="Nothing to preview" data-testid="kb-article-body-preview" />
              </TabsContent>
            </Tabs>

            <label className="inline-flex items-center gap-2 text-sm text-fg">
              <Checkbox
                checked={published}
                onCheckedChange={(checked) => setPublished(checked === true)}
                data-testid="kb-article-published-checkbox"
              />
              Published
            </label>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending} disabled={!title.trim() || !slug.trim() || (!isEdit && !body.trim())} data-testid="kb-article-form-submit">
              {isEdit ? "Save changes" : "Create"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
