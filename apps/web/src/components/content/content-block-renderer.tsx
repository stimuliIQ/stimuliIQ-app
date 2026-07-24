/**
 * ContentBlockRenderer — renders a `ContentBlock[]` array (headless CMS / landing-page
 * content, T33, docs/plans/phase-9-completion.md) into layout markup.
 *
 * Block shape is intentionally open (`{ type: string; data: Record<string, unknown> }`
 * — see @repo/types content/pages.schemas.ts). This renderer supports the documented
 * `type: 'richtext'` block (rendered through `RenderSink`, which applies DOMPurify at
 * the sink per ADR-0045) plus a small set of common marketing block types. Unknown
 * block types are skipped rather than crashing the page — CRM-authored content should
 * never be able to break a public route.
 *
 * Server-safe: no client-only APIs (RenderSink itself has no "use client" directive).
 */
import { RenderSink } from "@repo/ui";
import type { ContentBlock } from "@repo/types";
import { safeHref as safeHrefShared } from "../../lib/safe-href";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * SECURITY (Wave 6 L2): CRM-authored hero/CTA `href` values render into a public `<a>`.
 * Without a scheme check a content author could set `href: "javascript:..."` (or
 * `data:`/`vbscript:`) and land stored XSS on a marketing route. Delegates to the shared
 * `lib/safe-href.ts` allow-list (also used by the Phase-10 page-builder block renderers)
 * so the two surfaces never drift.
 */
function safeHref(value: unknown): string | undefined {
  return safeHrefShared(asString(value));
}

function RichTextBlock({ data }: { data: Record<string, unknown> }) {
  const html = asString(data.html);
  return (
    <div className="prose prose-lg max-w-none text-fg prose-headings:text-fg prose-a:text-brand-500">
      <RenderSink html={html} />
    </div>
  );
}

function HeadingBlock({ data }: { data: Record<string, unknown> }) {
  const text = asString(data.text);
  if (!text) return null;
  const level = data.level === 3 ? 3 : data.level === 4 ? 4 : 2;
  const className = "font-bold text-fg " + (level === 2 ? "text-2xl sm:text-3xl" : level === 3 ? "text-xl sm:text-2xl" : "text-lg");
  if (level === 3) return <h3 className={className}>{text}</h3>;
  if (level === 4) return <h4 className={className}>{text}</h4>;
  return <h2 className={className}>{text}</h2>;
}

function HeroBlock({ data }: { data: Record<string, unknown> }) {
  const heading = asString(data.heading);
  const subheading = asString(data.subheading);
  const ctaLabel = asString(data.ctaLabel);
  const ctaHref = safeHref(data.ctaHref);
  const imageUrl = asString(data.imageUrl);

  return (
    <section className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center sm:p-12">
      {imageUrl ? (
        <img src={imageUrl} alt="" aria-hidden="true" className="mb-2 max-h-40 w-auto object-contain" loading="eager" />
      ) : null}
      {heading ? <h1 className="text-3xl font-bold text-fg sm:text-4xl">{heading}</h1> : null}
      {subheading ? <p className="max-w-2xl text-lg text-fg-muted">{subheading}</p> : null}
      {ctaLabel && ctaHref ? (
        <a
          href={ctaHref}
          className="mt-2 inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand-500 px-8 text-base font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {ctaLabel}
        </a>
      ) : null}
    </section>
  );
}

function ImageBlock({ data }: { data: Record<string, unknown> }) {
  const url = asString(data.url);
  const alt = asString(data.alt) ?? "";
  if (!url) return null;
  return <img src={url} alt={alt} className="w-full rounded-xl object-cover" loading="lazy" />;
}

function CtaBlock({ data }: { data: Record<string, unknown> }) {
  const label = asString(data.label);
  const href = safeHref(data.href);
  if (!label || !href) return null;
  return (
    <div className="flex justify-center">
      <a
        href={href}
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand-500 px-8 text-base font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {label}
      </a>
    </div>
  );
}

function BlockSwitch({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "richtext":
      return <RichTextBlock data={block.data} />;
    case "heading":
      return <HeadingBlock data={block.data} />;
    case "hero":
      return <HeroBlock data={block.data} />;
    case "image":
      return <ImageBlock data={block.data} />;
    case "cta":
      return <CtaBlock data={block.data} />;
    default:
      // Unknown block type: skip rather than crash the page (CRM content should
      // never be able to break a public route).
      return null;
  }
}

export interface ContentBlockRendererProps {
  blocks: ContentBlock[];
}

export function ContentBlockRenderer({ blocks }: ContentBlockRendererProps) {
  return (
    <div className="flex flex-col gap-8" data-testid="content-block-renderer">
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no stable id in the DTO
        <div key={index}>
          <BlockSwitch block={block} />
        </div>
      ))}
    </div>
  );
}

ContentBlockRenderer.displayName = "ContentBlockRenderer";
