/**
 * MediaGalleryBlock — page-builder block #8 (docs/specs/phase-10-page-builder.md
 * §"8. media_gallery"). Net-new: swaps the Gallery page's placeholder `<div>` for a real
 * `next/image` grid (per that page's own "replaced with next/image ... in production"
 * code comment).
 */
import Image from "next/image";
import type { MediaGalleryBlockData } from "@repo/types";
import { resolveAssetUrl } from "../../../lib/media";

const COLS_CLASS: Record<string, string> = {
  "2": "sm:grid-cols-2",
  "3": "sm:grid-cols-2 md:grid-cols-3",
};

export function MediaGalleryBlock({ data }: { data: MediaGalleryBlockData }): React.JSX.Element {
  const cols = COLS_CLASS[data.columns] ?? COLS_CLASS["3"];
  const items = data.items.map((item) => ({ ...item, src: resolveAssetUrl(item.imageKey) })).filter((item) => item.src);

  return (
    <section aria-label={data.heading?.title ?? "Gallery"} data-testid="page-builder-media-gallery" className="py-12 lg:py-16">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        {data.heading ? (
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold text-fg md:text-4xl">{data.heading.title}</h2>
            {data.heading.subtitle ? <p className="mt-3 text-lg text-fg-muted">{data.heading.subtitle}</p> : null}
          </div>
        ) : null}

        {items.length === 0 ? (
          <p role="status" className="py-10 text-center text-sm text-fg-muted">
            No photos yet — check back soon.
          </p>
        ) : (
          <ul role="list" data-testid="gallery-list" className={`grid grid-cols-1 gap-4 ${cols}`}>
            {items.map((item, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: gallery items have no stable id in the block schema
              <li key={i}>
                <figure className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="relative h-48 w-full bg-surface">
                    <Image src={item.src!} alt={item.alt} fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                  </div>
                  {item.caption ? <figcaption className="px-4 py-3 text-sm text-fg-muted">{item.caption}</figcaption> : null}
                </figure>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
