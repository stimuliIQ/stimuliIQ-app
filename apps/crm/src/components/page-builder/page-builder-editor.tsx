// The page builder TEMPLATE FORM editor (Phase-11 locked templates, docs/plans/
// phase-11-locked-templates.md P4 — supersedes the free block-authoring editor). Every
// core marketing page has a FIXED, ORDERED set of sections (`getTemplateForSlug`,
// @repo/types page-templates.schemas.ts); staff edit only the field VALUES of those
// sections — there is no add/remove/reorder/block-picker any more. Each section owns its
// own react-hook-form instance (`template-section-card.tsx`); this component only reads
// their current values (`getValues()`) and validity at Save/Preview time, and always
// assembles the save payload in the template's fixed order — the server independently
// re-validates the exact same shape (`validatePageBodyAgainstTemplate`) and 422s on any
// drift, so this is defense in depth, not the only lock.
//
// KEPT from the free-block editor: save-is-live, server-resolved Preview, Version history
// + revert, the unsaved-changes guard, and the SEO disclosure (now also carrying a per-page
// OG/social image, reusing the same page-builder image upload/presign flow as block
// images).
import * as React from "react";
import { ArrowLeft, Eye, History, Save } from "lucide-react";
import {
  Button,
  CollapsibleSection,
  ConfirmDialog,
  Drawer,
  DrawerContent,
  DrawerBody,
  EmptyState,
  Input,
  Skeleton,
  StatusChip,
  useToast,
} from "@repo/ui";
import { ApiError } from "@repo/api-client";
import { isCoreTemplateSlug, type PageBuilderBlock, type ResolvedPageBuilderBlock } from "@repo/types";
import type { UseFormRegisterReturn } from "react-hook-form";

import {
  useContentPageDetail,
  useLatestContentPageVersion,
  usePreviewBuilderPage,
  useRevertContentPageVersion,
  useSaveBuilderPage,
} from "../../hooks/use-page-builder";
import { buildTemplateSections, type TemplateSectionSlot } from "../../lib/page-template-sections";
import { publicPageUrl } from "../../lib/public-urls";
import { surfaceError } from "../../lib/surface-error";
import { ImageKeyField } from "./block-forms/image-key-field";
import { PageBuilderPreview } from "./block-preview";
import { TemplateSectionCard, type TemplateSectionFormApi } from "./template-section-card";
import { VersionHistoryPanel } from "./version-history-panel";

export function PageBuilderEditor({ pageId, onBack }: { pageId: string; onBack: () => void }): React.JSX.Element {
  const { toast, dismiss } = useToast();
  const pageQuery = useContentPageDetail(pageId);
  const latestVersionQuery = useLatestContentPageVersion(pageId);
  const saveBuilderPage = useSaveBuilderPage();
  const previewBuilderPage = usePreviewBuilderPage();
  const revertVersion = useRevertContentPageVersion();

  const [sections, setSections] = React.useState<TemplateSectionSlot[]>([]);
  const [templateUnsupported, setTemplateUnsupported] = React.useState(false);
  const [slug, setSlug] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [seoTitle, setSeoTitle] = React.useState("");
  const [seoDescription, setSeoDescription] = React.useState("");
  const [seoImagePath, setSeoImagePath] = React.useState("");
  const [expectedVersion, setExpectedVersion] = React.useState(0);
  const [initialized, setInitialized] = React.useState(false);

  // Dirty tracking for the unsaved-changes guard on "Back to pages" — the initial
  // (last-saved) title/SEO values to diff the live state against, plus per-section dirty
  // flags reported by each section's own form. There is no more "structural" dirty flag —
  // the section list itself can never change shape.
  const initialMetaRef = React.useRef({ title: "", seoTitle: "", seoDescription: "", seoImagePath: "" });
  const [dirtySections, setDirtySections] = React.useState<Record<string, boolean>>({});

  const [validity, setValidity] = React.useState<Record<string, boolean>>({});
  const formApisRef = React.useRef<Map<string, TemplateSectionFormApi>>(new Map());
  const sectionRefs = React.useRef<Map<string, HTMLElement>>(new Map());

  // Collapsed-by-default: which section keys are explicitly expanded. A section whose OWN
  // validity is `false` is ALWAYS shown expanded regardless of this set (see `isOpenFor`
  // below).
  const [openKeys, setOpenKeys] = React.useState<Set<string>>(new Set());

  const [saveConfirmOpen, setSaveConfirmOpen] = React.useState(false);
  const [conflictOpen, setConflictOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [backConfirmOpen, setBackConfirmOpen] = React.useState(false);

  const initializeFrom = React.useCallback(
    (
      pSlug: string,
      body: PageBuilderBlock[],
      pageTitle: string,
      pSeoTitle: string | null,
      pSeoDescription: string | null,
      pSeoImagePath: string | null,
      version: number,
    ) => {
      formApisRef.current = new Map();
      setValidity({});
      setDirtySections({});
      setOpenKeys(new Set());

      if (!isCoreTemplateSlug(pSlug)) {
        setTemplateUnsupported(true);
        setSections([]);
        setInitialized(true);
        return;
      }
      setTemplateUnsupported(false);
      setSections(buildTemplateSections(pSlug, body));
      setSlug(pSlug);
      setTitle(pageTitle);
      setSeoTitle(pSeoTitle ?? "");
      setSeoDescription(pSeoDescription ?? "");
      setSeoImagePath(pSeoImagePath ?? "");
      setExpectedVersion(version);
      initialMetaRef.current = {
        title: pageTitle,
        seoTitle: pSeoTitle ?? "",
        seoDescription: pSeoDescription ?? "",
        seoImagePath: pSeoImagePath ?? "",
      };
      setInitialized(true);
    },
    [],
  );

  React.useEffect(() => {
    if (initialized) return;
    if (!pageQuery.data || latestVersionQuery.isLoading) return;
    const latestVersion = latestVersionQuery.data?.items[0]?.version ?? 0;
    // The generic detail GET types `body` as the loose `ContentBlock[]` envelope; this row
    // is `isBuilderManaged: true`, so it is guaranteed (server-validated on every prior
    // save) to already satisfy `PageBuilderBlockSchema` — see use-page-builder.ts comment.
    initializeFrom(
      pageQuery.data.slug,
      pageQuery.data.body as unknown as PageBuilderBlock[],
      pageQuery.data.title,
      pageQuery.data.seoTitle,
      pageQuery.data.seoDescription,
      pageQuery.data.seoImagePath,
      latestVersion,
    );
  }, [initialized, pageQuery.data, latestVersionQuery.data, latestVersionQuery.isLoading, initializeFrom]);

  const registerFormApi = React.useCallback((key: string, api: TemplateSectionFormApi | null) => {
    if (api) formApisRef.current.set(key, api);
    else formApisRef.current.delete(key);
  }, []);

  const onValidityChange = React.useCallback((key: string, valid: boolean) => {
    setValidity((prev) => (prev[key] === valid ? prev : { ...prev, [key]: valid }));
  }, []);

  const onDirtyChange = React.useCallback((key: string, dirty: boolean) => {
    setDirtySections((prev) => (prev[key] === dirty ? prev : { ...prev, [key]: dirty }));
  }, []);

  const allSectionsValid = sections.every(({ section }) => validity[section.key] !== false);
  const invalidKeysInOrder = sections.filter(({ section }) => validity[section.key] === false).map(({ section }) => section.key);

  const metaDirty =
    title !== initialMetaRef.current.title ||
    seoTitle !== initialMetaRef.current.seoTitle ||
    seoDescription !== initialMetaRef.current.seoDescription ||
    seoImagePath !== initialMetaRef.current.seoImagePath;
  const isDirty = metaDirty || Object.values(dirtySections).some(Boolean);

  function isOpenFor(key: string): boolean {
    return openKeys.has(key) || validity[key] === false;
  }

  function setOpenFor(key: string, open: boolean) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function scrollToSection(key: string) {
    setOpenFor(key, true);
    // Runs after the collapse-state update has had a chance to paint (the target section
    // must be expanded before `scrollIntoView` measures its position).
    requestAnimationFrame(() => {
      const el = sectionRefs.current.get(key);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const trigger = el.querySelector<HTMLElement>('[data-testid="collapsible-section-trigger"]');
      trigger?.focus();
    });
  }

  /** Always assembled in the template's fixed order — the section list itself can never be
   *  reordered/added/removed, so this is simply each section's own live form values. */
  function gatherBody(): PageBuilderBlock[] {
    return sections.map(({ section, data }) => ({
      type: section.blockType,
      data: formApisRef.current.get(section.key)?.getValues() ?? data,
    })) as PageBuilderBlock[];
  }

  /** Triggers validation on every section and returns which keys failed, IN PAGE ORDER —
   *  used to reliably find "the first invalid section" without waiting on the async
   *  `validity` state (which updates via each card's own effect, a render behind
   *  `trigger()`). */
  async function validateAllSectionsDetailed(): Promise<string[]> {
    const results = await Promise.all(
      sections.map(async ({ section }) => ({ key: section.key, valid: (await formApisRef.current.get(section.key)?.trigger()) ?? true })),
    );
    return results.filter((r) => !r.valid).map((r) => r.key);
  }

  const [previewBlocks, setPreviewBlocks] = React.useState<ResolvedPageBuilderBlock[]>([]);

  async function handlePreview() {
    const invalidKeys = await validateAllSectionsDetailed();
    if (invalidKeys.length > 0) {
      toast({ title: "Fix the highlighted sections first", description: "Every section must pass validation before it can be previewed.", variant: "destructive" });
      scrollToSection(invalidKeys[0] as string);
      return;
    }
    try {
      const result = await previewBuilderPage.mutateAsync({ id: pageId, body: { body: gatherBody() } });
      setPreviewBlocks(result.blocks);
      setPreviewOpen(true);
    } catch (error) {
      surfaceError(toast, error, "Couldn't build the preview");
    }
  }

  async function handleSaveClick() {
    const invalidKeys = await validateAllSectionsDetailed();
    if (invalidKeys.length > 0) {
      toast({ title: "Fix the highlighted sections first", description: "Every section must pass validation before saving.", variant: "destructive" });
      scrollToSection(invalidKeys[0] as string);
      return;
    }
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaveConfirmOpen(true);
  }

  async function handleConfirmSave() {
    try {
      const result = await saveBuilderPage.mutateAsync({
        id: pageId,
        body: {
          title: title.trim(),
          body: gatherBody(),
          seoTitle: seoTitle.trim() ? seoTitle.trim() : undefined,
          seoDescription: seoDescription.trim() ? seoDescription.trim() : undefined,
          seoImagePath: seoImagePath.trim() ? seoImagePath.trim() : undefined,
          expectedVersion,
        },
      });
      const savedVersion = result.currentVersion;
      initializeFrom(result.slug, result.body, result.title, result.seoTitle, result.seoDescription, result.seoImagePath, savedVersion);
      setSaveConfirmOpen(false);

      const liveUrl = publicPageUrl(result.slug);
      const toastId = toast({
        title: "Saved — live in ~5 minutes",
        variant: "success",
        duration: 10_000,
        description: (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <a href={liveUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-500 underline-offset-4 hover:underline">
              View live page
            </a>
            {savedVersion > 0 ? (
              <button
                type="button"
                className="font-medium text-brand-500 underline-offset-4 hover:underline"
                data-testid="page-builder-save-toast-undo"
                onClick={() => {
                  dismiss(toastId);
                  setUndoTarget(savedVersion);
                }}
              >
                Undo
              </button>
            ) : null}
          </div>
        ),
      });
    } catch (error) {
      setSaveConfirmOpen(false);
      if (error instanceof ApiError && error.status === 409) {
        setConflictOpen(true);
        return;
      }
      surfaceError(toast, error, "Couldn't save this page");
    }
  }

  // "Undo" on the save toast — reverts to the version the save itself just created
  // (save-before-apply: the version numbered `savedVersion` IS "what the page looked like
  // right before this save" — see version-history-panel.tsx header). One click from
  // mutating a live site, so it still goes through the same confirm dialog as any other
  // revert, never a silent one-click mutation.
  const [undoTarget, setUndoTarget] = React.useState<number | null>(null);

  async function handleConfirmUndo() {
    if (undoTarget === null) return;
    try {
      await revertVersion.mutateAsync({ id: pageId, version: undoTarget, body: { expectedVersion } });
      toast({ title: "Undone", description: "The page is back to how it looked before your last save.", variant: "success" });
      setUndoTarget(null);
      handleReload();
    } catch (error) {
      setUndoTarget(null);
      if (error instanceof ApiError && error.status === 409) {
        setConflictOpen(true);
        return;
      }
      surfaceError(toast, error, "Couldn't undo that save");
    }
  }

  function handleReload() {
    setConflictOpen(false);
    setInitialized(false);
    void pageQuery.refetch();
    void latestVersionQuery.refetch();
  }

  function handleBackClick() {
    if (isDirty) {
      setBackConfirmOpen(true);
      return;
    }
    onBack();
  }

  if (pageQuery.isLoading || !initialized) {
    return (
      <div className="flex flex-col gap-3" data-testid="page-builder-editor-loading">
        <Skeleton shape="block" className="h-10" />
        <Skeleton shape="block" className="h-40" />
        <Skeleton shape="block" className="h-40" />
      </div>
    );
  }

  if (pageQuery.isError) {
    return (
      <EmptyState
        title="Couldn't load this page"
        data-testid="page-builder-editor-error"
        action={
          <Button variant="secondary" onClick={() => pageQuery.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  if (templateUnsupported) {
    return (
      <EmptyState
        title="This page can't be edited here"
        description="It isn't one of the fixed marketing-page templates this editor manages."
        data-testid="page-builder-editor-unsupported-template"
        action={
          <Button variant="secondary" onClick={onBack} data-testid="page-builder-editor-unsupported-back">
            Back to pages
          </Button>
        }
      />
    );
  }

  // Bridges the plain `seoImagePath` state to `ImageKeyField`'s react-hook-form
  // `registered` prop shape — the page-details fields here (title/SEO) are plain state,
  // not an RHF instance, so there's no `register()` to spread; this is the minimal
  // adapter satisfying the same contract.
  const seoImageRegistered: UseFormRegisterReturn = {
    name: "seoImagePath",
    onChange: async (e) => {
      setSeoImagePath((e.target as HTMLInputElement).value);
    },
    onBlur: async () => undefined,
    ref: () => undefined,
  };

  return (
    <div className="flex flex-col gap-4" data-testid="page-builder-editor">
      <div className="sticky top-0 z-10 flex flex-col gap-2 bg-bg pb-2 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleBackClick} data-testid="page-builder-editor-back">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to pages
          </Button>
          <div className="flex items-center gap-3">
            <StatusChip
              tone="warning"
              label="Live site — saving publishes immediately"
              data-testid="page-builder-live-pill"
            />
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)} data-testid="page-builder-open-history">
                <History className="size-4" aria-hidden="true" />
                Version history
              </Button>
              <Button variant="secondary" size="sm" loading={previewBuilderPage.isPending} onClick={handlePreview} data-testid="page-builder-open-preview">
                <Eye className="size-4" aria-hidden="true" />
                Preview
              </Button>
            </div>
            <span aria-hidden="true" className="h-6 w-px bg-border" />
            <Button size="md" disabled={!allSectionsValid} onClick={handleSaveClick} data-testid="page-builder-save-button">
              <Save className="size-4" aria-hidden="true" />
              Save &amp; publish
            </Button>
          </div>
        </div>
        {!allSectionsValid ? (
          <button
            type="button"
            className="self-end text-xs font-medium text-danger underline-offset-2 hover:underline"
            onClick={() => scrollToSection(invalidKeysInOrder[0] as string)}
            data-testid="page-builder-invalid-caption"
          >
            {invalidKeysInOrder.length} section{invalidKeysInOrder.length === 1 ? "" : "s"} need attention before you can publish
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border border-l-4 border-l-brand-500 bg-surface p-4" data-testid="page-builder-page-details-card">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Page details</p>
          {slug ? (
            <a
              href={publicPageUrl(slug)}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-brand-500 underline-offset-4 hover:underline"
              data-testid="page-builder-view-live-link"
            >
              View live page
            </a>
          ) : null}
        </div>
        <Input label="Title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="page-builder-title-input" />
        <CollapsibleSection
          defaultOpen={false}
          data-testid="page-builder-seo-disclosure"
          header={
            <span className="flex flex-col">
              <span className="text-sm font-medium text-fg">Search engine listing (optional)</span>
              <span className="text-xs text-fg-muted">What Google (and social shares) show for this page. Leave blank to use the page/site defaults.</span>
            </span>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Title shown in Google (optional)"
                maxLength={70}
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                helperText={`${seoTitle.length}/70`}
                data-testid="page-builder-seo-title-input"
              />
              <Input
                label="Description shown in Google (optional)"
                maxLength={160}
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                helperText={`${seoDescription.length}/160`}
                data-testid="page-builder-seo-description-input"
              />
            </div>
            <ImageKeyField
              label="Social share image (optional)"
              helperText="Shown when this page is shared on social media. Falls back to the site default when empty."
              watchedValue={seoImagePath}
              registered={seoImageRegistered}
              testId="page-builder-seo-image-key"
              onUploadedKey={(key) => setSeoImagePath(key)}
            />
          </div>
        </CollapsibleSection>
      </div>

      <ul className="flex flex-col gap-3">
        {sections.map(({ section, data }, index) => (
          <li
            key={section.key}
            ref={(el) => {
              if (el) sectionRefs.current.set(section.key, el);
              else sectionRefs.current.delete(section.key);
            }}
          >
            <TemplateSectionCard
              section={section}
              data={data}
              index={index}
              open={isOpenFor(section.key)}
              onOpenChange={(open) => setOpenFor(section.key, open)}
              registerFormApi={registerFormApi}
              onValidityChange={onValidityChange}
              onDirtyChange={onDirtyChange}
            />
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={saveConfirmOpen}
        onOpenChange={setSaveConfirmOpen}
        title="Save and publish?"
        description="This publishes immediately to the live site — there is no draft or approval step. Visitors will see this exact content on their next page load. Your current version is kept as a backup you can restore."
        confirmLabel="Save & publish"
        onConfirm={handleConfirmSave}
        loading={saveBuilderPage.isPending}
        data-testid="confirm-save-page-builder-page"
      />

      <ConfirmDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        title="This page was changed by someone else"
        description="Someone else saved a change to this page since you opened it. Reload to see their change, then re-apply yours."
        confirmLabel="Reload"
        onConfirm={handleReload}
        data-testid="confirm-page-builder-version-conflict"
      />

      <ConfirmDialog
        open={undoTarget !== null}
        onOpenChange={(open) => !open && setUndoTarget(null)}
        title="Undo your last save?"
        description="This replaces the live page content immediately with how it looked before your last save — visitors will see this on their next request. Nothing is deleted; the version you just saved stays in your history too."
        confirmLabel="Undo save"
        tone="danger"
        onConfirm={handleConfirmUndo}
        loading={revertVersion.isPending}
        data-testid="confirm-undo-page-builder-save"
      />

      <ConfirmDialog
        open={backConfirmOpen}
        onOpenChange={setBackConfirmOpen}
        title="Leave without publishing?"
        description="Your edits haven't been saved yet — they'll be lost if you leave now."
        confirmLabel="Leave"
        tone="danger"
        onConfirm={() => {
          setBackConfirmOpen(false);
          onBack();
        }}
        data-testid="confirm-page-builder-unsaved-back"
      />

      <Drawer open={previewOpen} onOpenChange={setPreviewOpen}>
        <DrawerContent title="Preview" size="xl" data-testid="page-builder-preview-drawer">
          <DrawerBody>
            <PageBuilderPreview blocks={previewBlocks} />
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <VersionHistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} pageId={pageId} currentVersion={expectedVersion} onReverted={handleReload} />
    </div>
  );
}
