// Page-builder block registry metadata — originally Phase-10 (docs/specs/
// phase-10-page-builder.md "Block registry"), now the per-block-type display metadata the
// Phase-11 locked-template editor reuses (docs/plans/phase-11-locked-templates.md P4:
// "reuse the existing per-block field UIs ... keep those field renderers, drop the block
// chrome"). Single source of truth for: (a) each type's friendly label/description/icon/
// categorical accent color (used by `template-section-card.tsx`'s collapsed section header
// and the collapsed-summary content excerpt), and (b) `blockContentExcerpt` — never
// re-derived per call site. The free block-builder's "add a block" picker and its
// `PAGE_BUILDER_BLOCK_TYPES`/`defaultBlockData`/per-type-schema-map metadata were removed
// with it (Phase-11 locks every core page to a fixed, registry-pinned section list — see
// `getTemplateForSlug`/`defaultBodyForSlug`, @repo/types page-templates.schemas.ts — so a
// section's `dataSchema` now comes straight from the template registry, never re-looked-up
// by type here).
import type { LucideIcon } from "lucide-react";
import {
  PanelTop,
  Columns2,
  Hash,
  LayoutGrid,
  ListOrdered,
  CircleHelp,
  MousePointerClick,
  Images,
  Briefcase,
  Rss,
  Sparkles,
} from "lucide-react";
import type { CollapsibleSectionAccentTone } from "@repo/ui";
import { type PageBuilderBlockType, IconKeySchema } from "@repo/types";

export interface BlockTypeMeta {
  type: PageBuilderBlockType;
  label: string;
  description: string;
  category: "Content" | "List" | "Reference" | "Decorative";
  /** lucide icon shown in the collapsed row / block-card header / block picker (§2.2). Always
   *  rendered `aria-hidden` alongside the visible text label — never the sole signal. */
  icon: LucideIcon;
}

/** Category → categorical chart-token accent (docs/specs/phase-10-ui-polish-visual-audit.md
 *  §2.2 table) — reused as `CollapsibleSection`'s `accentTone` prop. */
export const BLOCK_CATEGORY_ACCENT_TONE: Record<BlockTypeMeta["category"], CollapsibleSectionAccentTone> = {
  Content: "chart-1",
  List: "chart-2",
  Reference: "chart-3",
  Decorative: "chart-6",
};

export const BLOCK_TYPE_META: Record<PageBuilderBlockType, BlockTypeMeta> = {
  hero: {
    type: "hero",
    label: "Hero",
    description: "Top-of-page headline, subheadline, optional trust badge/photos and CTAs.",
    category: "Content",
    icon: PanelTop,
  },
  content_split: {
    type: "content_split",
    label: "Content + image split",
    description: "Heading and body paragraphs beside a photo — e.g. an About-style story section.",
    category: "Content",
    icon: Columns2,
  },
  stat_group: {
    type: "stat_group",
    label: "Stat group",
    description: "A row/grid of numbers with labels — e.g. \"15,000+ Students placed\".",
    category: "Content",
    icon: Hash,
  },
  feature_grid: {
    type: "feature_grid",
    label: "Feature grid",
    description: "Icon + title + description cards in a grid or strip — e.g. \"Why choose us\".",
    category: "Content",
    icon: LayoutGrid,
  },
  numbered_steps: {
    type: "numbered_steps",
    label: "Numbered steps",
    description: "A numbered process/journey list — e.g. \"How it works\".",
    category: "Content",
    icon: ListOrdered,
  },
  faq: {
    type: "faq",
    label: "FAQ accordion",
    description: "A collapsible list of question/answer pairs.",
    category: "Content",
    icon: CircleHelp,
  },
  cta_band: {
    type: "cta_band",
    label: "Button banner",
    description: "A colored strip with a heading and buttons — optionally with an inline lead form.",
    category: "Content",
    icon: MousePointerClick,
  },
  media_gallery: {
    type: "media_gallery",
    label: "Media gallery",
    description: "A grid of photos with captions — e.g. the campus gallery page.",
    category: "List",
    icon: Images,
  },
  job_openings: {
    type: "job_openings",
    label: "Job openings",
    description: "A list of open roles (title, type, location, description) — e.g. the Careers page.",
    category: "List",
    icon: Briefcase,
  },
  live_collection_ref: {
    type: "live_collection_ref",
    label: "Automatic section",
    description:
      "Shows your latest reviews, partner logos, programs, or mentors automatically. Edit the items themselves on their own screens — never copies data into the page.",
    category: "Reference",
    icon: Rss,
  },
  brain_showcase: {
    type: "brain_showcase",
    label: "Brand showcase (decorative)",
    description: "The fixed 3D/shader brand moment. No editable fields — position it, nothing else.",
    category: "Decorative",
    icon: Sparkles,
  },
};

/** Icon options for the closed `iconKey` enum (design-system-owned set). */
export const ICON_KEY_OPTIONS: { value: string; label: string }[] = IconKeySchema.options.map((value) => ({
  value,
  label: value
    .split("-")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" "),
}));

// ---------------------------------------------------------------------------------------
// Collapsed-block content excerpt (docs/specs/phase-10-ui-polish-visual-audit.md §2.3).
// Computed from the block's OWN live form values (`watch()` inside `KnownBlockCard`) — not
// a second data source — so the excerpt updates live as the author types, per the UX
// audit's golden path ("the excerpt in the section header updates as she types"). An
// untouched required field renders as the italic placeholder rather than an empty string,
// so the collapsed row is never blank.
// ---------------------------------------------------------------------------------------

export interface BlockExcerpt {
  text: string;
  /** True when nothing meaningful has been entered yet — render `text` in italic/muted. */
  placeholder: boolean;
}

const EMPTY_EXCERPT: BlockExcerpt = { text: "Not filled in yet", placeholder: true };

function truncate(value: string, max = 60): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function fromText(value: unknown): BlockExcerpt {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? { text: truncate(text), placeholder: false } : EMPTY_EXCERPT;
}

function countExcerpt(items: unknown, singular: string, plural: string = `${singular}s`): BlockExcerpt {
  const length = Array.isArray(items) ? items.length : 0;
  if (length === 0) return EMPTY_EXCERPT;
  return { text: `${length} ${length === 1 ? singular : plural}`, placeholder: false };
}

/** Per-type excerpt logic (docs/specs/phase-10-ui-polish-visual-audit.md §2.3 table). */
export function blockContentExcerpt(type: PageBuilderBlockType, data: Record<string, unknown>): BlockExcerpt {
  switch (type) {
    case "hero":
      return fromText(data.headline);
    case "content_split":
      return fromText(data.heading);
    case "stat_group": {
      const items = Array.isArray(data.items) ? (data.items as { label?: string; value?: string }[]) : [];
      const first = items[0];
      if (!first || (!first.label?.trim() && !first.value?.trim())) return EMPTY_EXCERPT;
      const text = `${first.value ?? ""} ${first.label ?? ""}`.trim();
      return {
        text: items.length > 1 ? truncate(`${text} + ${items.length - 1} more`) : truncate(text),
        placeholder: false,
      };
    }
    case "feature_grid":
      return countExcerpt(data.items, "feature");
    case "numbered_steps":
      return countExcerpt(data.items, "step");
    case "faq":
      return countExcerpt(data.items, "question");
    case "cta_band":
      return fromText(data.heading);
    case "media_gallery":
      return countExcerpt(data.items, "photo");
    case "job_openings": {
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length > 0) return { text: `${items.length} open role${items.length === 1 ? "" : "s"}`, placeholder: false };
      const emptyMessage = typeof data.emptyStateMessage === "string" ? data.emptyStateMessage.trim() : "";
      return emptyMessage ? { text: truncate(emptyMessage), placeholder: false } : EMPTY_EXCERPT;
    }
    case "live_collection_ref": {
      const collection = typeof data.collection === "string" ? data.collection : "";
      const layout = typeof data.layout === "string" ? data.layout : "";
      if (!collection) return EMPTY_EXCERPT;
      return { text: `Live: ${collection}${layout ? ` · ${layout}` : ""}`, placeholder: false };
    }
    case "brain_showcase":
      return { text: "Decorative — no fields", placeholder: false };
    default:
      return EMPTY_EXCERPT;
  }
}
