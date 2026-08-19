// Approximate, read-only visual preview of resolved page-builder blocks (docs/specs/
// phase-10-page-builder.md AC 4). Deliberately NOT a pixel-match of the `web` renderer —
// a clean typographic approximation (headings, stat numbers, card grids) so a super_admin
// can sanity-check unsaved edits before Save. `live_collection_ref` blocks render the
// server-RESOLVED `resolvedItems` (never anything typed into the builder itself — this
// block never copies data, see live-collection-ref-fields.tsx header).
import * as React from "react";
import { EmptyState } from "@repo/ui";
import type { ResolvedPageBuilderBlock } from "@repo/types";

function Highlighted({ text, highlight }: { text: string; highlight?: string }): React.JSX.Element {
  if (!highlight || !text.includes(highlight)) return <>{text}</>;
  const index = text.indexOf(highlight);
  return (
    <>
      {text.slice(0, index)}
      <span className="text-chart-3">{highlight}</span>
      {text.slice(index + highlight.length)}
    </>
  );
}

function SectionHeading({
  eyebrow,
  title,
  titleHighlight,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  titleHighlight?: string;
  subtitle?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {eyebrow ? <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{eyebrow}</p> : null}
      <h3 className="text-lg font-semibold text-fg">
        <Highlighted text={title} highlight={titleHighlight} />
      </h3>
      {subtitle ? <p className="text-sm text-fg-muted">{subtitle}</p> : null}
    </div>
  );
}

function BlockPreview({ block, index }: { block: ResolvedPageBuilderBlock; index: number }): React.JSX.Element {
  switch (block.type) {
    case "hero": {
      const d = block.data;
      return (
        <div className="flex flex-col items-center gap-2 rounded-md bg-surface p-6 text-center">
          {d.eyebrow ? <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{d.eyebrow}</p> : null}
          <h2 className="text-2xl font-bold text-fg">
            <Highlighted text={d.headline} highlight={d.headlineHighlight} />
          </h2>
          {d.subheadline ? <p className="max-w-lg text-sm text-fg-muted">{d.subheadline}</p> : null}
          {d.ctas.length > 0 ? (
            <div className="mt-2 flex gap-2">
              {d.ctas.map((cta, i) => (
                <span key={i} className={`rounded-md px-3 py-1.5 text-xs font-medium ${cta.style === "primary" ? "bg-brand-500 text-brand-foreground" : "border border-border text-fg"}`}>
                  {cta.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      );
    }
    case "content_split": {
      const d = block.data;
      return (
        <div className="flex flex-col gap-2 rounded-md bg-surface p-4">
          {d.eyebrow ? <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{d.eyebrow}</p> : null}
          <h3 className="text-lg font-semibold text-fg">
            <Highlighted text={d.heading} highlight={d.headingHighlight} />
          </h3>
          {d.body.map((p, i) => (
            <p key={i} className="text-sm text-fg-muted">
              {p}
            </p>
          ))}
        </div>
      );
    }
    case "stat_group": {
      const d = block.data;
      return (
        <div className="flex flex-col gap-2 rounded-md bg-surface p-4">
          {d.heading ? <SectionHeading {...d.heading} /> : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {d.items.map((item, i) => (
              <div key={i} className="rounded-md border border-border p-3 text-center">
                <p className="text-xl font-bold text-fg">{item.value}</p>
                <p className="text-xs text-fg-muted">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "feature_grid": {
      const d = block.data;
      return (
        <div className="flex flex-col gap-2 rounded-md bg-surface p-4">
          {d.heading ? <SectionHeading {...d.heading} /> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {d.items.map((item, i) => (
              <div key={i} className="rounded-md border border-border p-3">
                <p className="text-sm font-medium text-fg">{item.title}</p>
                <p className="text-xs text-fg-muted">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "numbered_steps": {
      const d = block.data;
      return (
        <div className="flex flex-col gap-2 rounded-md bg-surface p-4">
          {d.heading ? <SectionHeading {...d.heading} /> : null}
          <ol className="flex flex-col gap-2">
            {d.items.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-brand-foreground">{i + 1}</span>
                <span>
                  <span className="font-medium text-fg">{item.title}</span> — <span className="text-fg-muted">{item.description}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      );
    }
    case "faq": {
      const d = block.data;
      return (
        <div className="flex flex-col gap-2 rounded-md bg-surface p-4">
          {d.heading ? <h3 className="text-lg font-semibold text-fg">{d.heading.title}</h3> : null}
          {d.items.map((item, i) => (
            <div key={i} className="border-b border-border pb-2">
              <p className="text-sm font-medium text-fg">{item.question}</p>
              <p className="text-xs text-fg-muted">{item.answer}</p>
            </div>
          ))}
        </div>
      );
    }
    case "cta_band": {
      const d = block.data;
      return (
        <div className={`flex flex-col items-center gap-2 rounded-md p-6 text-center ${d.background === "brand" ? "bg-brand-500 text-brand-foreground" : d.background === "surface" ? "bg-surface" : ""}`}>
          <h3 className="text-lg font-semibold">
            <Highlighted text={d.heading} highlight={d.headingHighlight} />
          </h3>
          {d.subheading ? <p className="text-sm opacity-80">{d.subheading}</p> : null}
          {d.buttons.length > 0 ? (
            <div className="flex gap-2">
              {d.buttons.map((btn, i) => (
                <span key={i} className="rounded-md border border-current px-3 py-1.5 text-xs font-medium">
                  {btn.label}
                </span>
              ))}
            </div>
          ) : null}
          {d.leadForm ? <p className="text-xs italic opacity-70">[Inline lead form: {d.leadForm.heading}]</p> : null}
        </div>
      );
    }
    case "media_gallery": {
      const d = block.data;
      return (
        <div className="flex flex-col gap-2 rounded-md bg-surface p-4">
          {d.heading ? <h3 className="text-lg font-semibold text-fg">{d.heading.title}</h3> : null}
          <div className={`grid gap-2 ${d.columns === "2" ? "grid-cols-2" : "grid-cols-3"}`}>
            {d.items.map((item, i) => (
              <div key={i} className="flex aspect-video items-center justify-center rounded-md border border-dashed border-border text-center text-[10px] text-fg-subtle">
                {item.caption ?? item.alt}
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "job_openings": {
      // A REFERENCE block (ADR-0066): the roles are live CRM rows, not page content, so
      // there is nothing stored here to preview. Showing the legacy `items` would preview
      // data the published page does not render — a preview that disagrees with the page is
      // worse than one that admits it has nothing to show.
      const d = block.data;
      return (
        <div className="flex flex-col gap-2 rounded-md bg-surface p-4">
          {d.heading ? <h3 className="text-lg font-semibold text-fg">{d.heading.title}</h3> : null}
          <p className="text-sm text-fg-muted">
            The open roles are pulled live from Careers ▸ Openings when this page is viewed.
          </p>
          <p className="text-xs text-fg-subtle">When nothing is open: &ldquo;{d.emptyStateMessage}&rdquo;</p>
        </div>
      );
    }
    case "live_collection_ref": {
      const d = block.data;
      const items = d.resolvedItems;
      if (items.length === 0) {
        // Edge case #2: 0 resolved items hides the whole block (incl. heading) on the
        // public site — the preview surfaces that explicitly rather than silently
        // rendering nothing, so the author knows why.
        return (
          <p className="rounded-md border border-dashed border-border p-3 text-xs text-fg-muted" data-testid={`page-builder-preview-block-${index}-hidden`}>
            Live collection ({d.collection}) resolved to 0 items — this block will be hidden on the public page.
          </p>
        );
      }
      return (
        <div className="flex flex-col gap-2 rounded-md bg-surface p-4">
          {d.heading ? <h3 className="text-lg font-semibold text-fg">{d.heading.title}</h3> : null}
          <div className={`grid gap-2 ${d.layout === "logo-wall" ? "grid-cols-4" : d.layout === "grid-4" ? "grid-cols-4" : "grid-cols-3"}`}>
            {/* Narrowed via a switch (not `d.collection === "x" && items.map(...)`) so TS
                narrows `d.resolvedItems`'s element type per branch — `items` alone (hoisted
                above) is the UNION of all 4 shapes and doesn't narrow from a sibling check. */}
            {(() => {
              switch (d.collection) {
                case "testimonials":
                  return d.resolvedItems.map((item) => (
                    <div key={item.id} className="rounded-md border border-border p-2 text-xs">
                      <p className="font-medium text-fg">{item.studentName}</p>
                      <p className="text-fg-muted">&ldquo;{item.quote}&rdquo;</p>
                    </div>
                  ));
                case "partners":
                  return d.resolvedItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-center rounded-md border border-border p-2 text-xs text-fg">
                      {item.name}
                    </div>
                  ));
                case "programs":
                  return d.resolvedItems.map((item) => (
                    <div key={item.id} className="rounded-md border border-border p-2 text-xs">
                      <p className="font-medium text-fg">{item.title}</p>
                      <p className="text-fg-muted">{item.domain}</p>
                    </div>
                  ));
                case "mentors":
                  return d.resolvedItems.map((item) => (
                    <div key={item.id} className="rounded-md border border-border p-2 text-xs">
                      <p className="font-medium text-fg">{item.fullName}</p>
                      <p className="text-fg-muted">{item.externalInstitute}</p>
                    </div>
                  ));
                default:
                  return null;
              }
            })()}
          </div>
        </div>
      );
    }
    case "brain_showcase":
      return (
        <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-border text-xs text-fg-subtle">
          [Brand showcase — fixed asset]
        </div>
      );
    default:
      return (
        <p role="alert" className="text-xs text-danger">
          Unsupported block type.
        </p>
      );
  }
}

export function PageBuilderPreview({ blocks }: { blocks: ResolvedPageBuilderBlock[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3" data-testid="page-builder-preview">
      <p className="rounded-md bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted">
        Preview (approximate) — a clean typographic rendering, not a pixel match of the live site.
      </p>
      {blocks.length === 0 ? (
        <EmptyState title="No sections yet" description="Add a block to see it previewed here." data-testid="page-builder-preview-empty" />
      ) : (
        blocks.map((block, index) => <BlockPreview key={index} block={block} index={index} />)
      )}
    </div>
  );
}
