/**
 * PageBlocks — the `web`-side generic block-registry renderer (docs/specs/phase-10-
 * page-builder.md "Dependencies" — `frontend-builder` owns "the `web`-side generic
 * block-registry renderer (`block.type` -> component)").
 *
 * Maps each of the 11 resolved `PageBuilderBlock` types (`ResolvedPageBuilderBlockSchema`,
 * `@repo/types`) to its rendering component. Server Component — every block renderer
 * underneath is itself server-safe (the only client islands are inside `LeadFormConnected`
 * and `CareersRoleList`, both pre-existing).
 *
 * Edge cases handled here (spec "Edge cases & error states"):
 *   #1  Empty block list  -> a minimal shell (not a crash, not a visible break).
 *   #4  A single malformed/broken block -> wrapped in `BlockErrorBoundary`, never 500s
 *       the whole page.
 *   #9  Unknown block `type` (e.g. a reverted-to version referencing a since-removed
 *       type) -> renders nothing in production; `console.error`s loudly in dev only
 *       (the CRM builder — not this renderer — is where the spec wants the persistent
 *       "unsupported type" warning surfaced to authors).
 */
import type { ResolvedPageBuilderBlock } from "@repo/types";
import { BlockErrorBoundary } from "./block-error-boundary";
import { HeroBlock } from "./blocks/hero-block";
import { ContentSplitBlock } from "./blocks/content-split-block";
import { StatGroupBlock } from "./blocks/stat-group-block";
import { FeatureGridBlock } from "./blocks/feature-grid-block";
import { NumberedStepsBlock } from "./blocks/numbered-steps-block";
import { FaqBlock } from "./blocks/faq-block";
import { CtaBandBlock } from "./blocks/cta-band-block";
import { MediaGalleryBlock } from "./blocks/media-gallery-block";
import { JobOpeningsBlock } from "./blocks/job-openings-block";
import { LiveCollectionRefBlock } from "./blocks/live-collection-ref-block";
import { BrainShowcaseBlock } from "./blocks/brain-showcase-block";
import { BrandMarkBand, heroMotifForSlug, showsBrandMarkBand, type HeroMotifKind } from "./hero-motif";

/**
 * The two REFERENCE block types (`job_openings`, `live_collection_ref`) carry a
 * server-resolved `resolvedItems` array that their renderers index into. Guarantee it
 * exists before any of them runs.
 *
 * WHY THIS IS NEEDED even though the type says it is always there: the page components feed
 * this renderer `page.body as ResolvedPageBuilderBlock[]` — a CAST of untyped API JSON, not
 * a parse. So the compiler's guarantee is only as good as the payload, and the payload can
 * legitimately lack the field:
 *   - `web` deployed ahead of the API, so the resolver adding `resolvedItems` is not live yet;
 *   - a stale Next.js fetch cache holding a response from before that resolver existed.
 *
 * Either case used to take the WHOLE page down with "Cannot read properties of undefined
 * (reading 'length')" — and it did, breaking the production build of /careers.
 * `BlockErrorBoundary` does not help here: it is a client error boundary, and this throws
 * during server render / static prerender, which it cannot catch.
 *
 * An absent resolution is the same thing as an empty one, and that is what the server-side
 * resolver already does with a failed lookup — degrade the section, never the page.
 */
function withResolvedItems(block: ResolvedPageBuilderBlock): ResolvedPageBuilderBlock {
  if (block.type !== "job_openings" && block.type !== "live_collection_ref") return block;
  if (Array.isArray((block.data as { resolvedItems?: unknown }).resolvedItems)) return block;
  return { ...block, data: { ...block.data, resolvedItems: [] } } as ResolvedPageBuilderBlock;
}

function renderBlock(
  rawBlock: ResolvedPageBuilderBlock,
  motif: HeroMotifKind | undefined,
): React.ReactNode {
  const block = withResolvedItems(rawBlock);
  switch (block.type) {
    case "hero":
      return <HeroBlock data={block.data} motif={motif} />;
    case "content_split":
      return <ContentSplitBlock data={block.data} />;
    case "stat_group":
      return <StatGroupBlock data={block.data} />;
    case "feature_grid":
      return <FeatureGridBlock data={block.data} />;
    case "numbered_steps":
      return <NumberedStepsBlock data={block.data} />;
    case "faq":
      return <FaqBlock data={block.data} />;
    case "cta_band":
      return <CtaBandBlock data={block.data} />;
    case "media_gallery":
      return <MediaGalleryBlock data={block.data} />;
    case "job_openings":
      return <JobOpeningsBlock data={block.data} />;
    case "live_collection_ref":
      return <LiveCollectionRefBlock data={block.data} />;
    case "brain_showcase":
      return <BrainShowcaseBlock />;
    default: {
      // Unknown type (Edge case #9) — `block` is `never` per the closed union, so a
      // real unknown-type payload only reaches here if it slipped past the zod parse
      // upstream (e.g. a caller passed raw, unvalidated JSON). Fail loud in dev,
      // silent in production.
      if (process.env.NODE_ENV !== "production") {
        console.error(`[page-builder] unknown block type "${(block as { type: string }).type}", skipped.`);
      }
      return null;
    }
  }
}

export interface PageBlocksProps {
  blocks: ResolvedPageBuilderBlock[];
  /**
   * Slug of the page being rendered. Used only to pick the decorative hero motif
   * (`hero-motif.tsx`) for pages whose hero carries no background image — see
   * `heroMotifForSlug`. Omitted, heroes render exactly as before.
   */
  pageSlug?: string;
}

export function PageBlocks({ blocks, pageSlug }: PageBlocksProps): React.JSX.Element {
  const heroMotif = heroMotifForSlug(pageSlug);

  // Edge case #1 / AC 13: an empty page is valid — render a minimal shell, not a crash.
  if (!blocks || blocks.length === 0) {
    return <div data-testid="page-builder-empty-shell" className="py-4" />;
  }

  return (
    <>
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no stable id on the wire (same envelope as the legacy ContentBlockRenderer)
        <BlockErrorBoundary key={index} blockType={block.type} blockIndex={index}>
          {/* On /about the logo gets a band of its own ABOVE the hero copy, rather than
              sitting behind it as a watermark (see `hero-motif.tsx`). Decorative, so the
              renderer injects it — it is not an editable block. */}
          {block.type === "hero" && showsBrandMarkBand(pageSlug) ? <BrandMarkBand /> : null}
          {renderBlock(block, heroMotif)}
        </BlockErrorBoundary>
      ))}
    </>
  );
}
