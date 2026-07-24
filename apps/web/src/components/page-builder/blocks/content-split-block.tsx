/**
 * ContentSplitBlock — page-builder block #2 (docs/specs/phase-10-page-builder.md
 * §"2. content_split"). Adapted from About's "Story" section — a heading + multi-
 * paragraph body on one side, a media image with an optional floating badge on the other.
 */
import Image from "next/image";
import type { ContentSplitBlockData } from "@repo/types";
import { resolveAssetUrl } from "../../../lib/media";
import { BlockIcon } from "../icon-registry";
import { HighlightText } from "../highlight-text";

export function ContentSplitBlock({ data }: { data: ContentSplitBlockData }): React.JSX.Element | null {
  const mediaSrc = resolveAssetUrl(data.mediaImageKey);
  const mediaFirst = data.mediaPosition === "left";

  return (
    <section aria-label={data.heading} data-testid="page-builder-content-split" className="border-t border-border py-16 lg:py-24">
      <div className="mx-auto grid max-w-screen-xl grid-cols-1 items-center gap-12 px-4 md:px-6 lg:grid-cols-2">
        <div className={mediaFirst ? "lg:order-2" : undefined}>
          {data.eyebrow ? <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fg-muted">{data.eyebrow}</p> : null}
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            <HighlightText text={data.heading} highlight={data.headingHighlight} />
          </h2>
          <div className="mt-6 flex flex-col gap-5 text-base leading-relaxed text-fg-muted">
            {data.body.map((paragraph, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: body is an ordered, non-reorderable paragraph list
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </div>

        {mediaSrc ? (
          <div className={`relative mx-auto w-full max-w-md ${mediaFirst ? "lg:order-1" : ""}`}>
            <Image src={mediaSrc} alt="" aria-hidden="true" width={448} height={520} className="h-[420px] w-full rounded-2xl object-cover shadow-md lg:h-[520px]" />
            {data.badge ? (
              <div className="absolute -left-4 bottom-8 flex items-center gap-3 rounded-xl border border-border bg-card p-3 pr-5 shadow-md">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-fg">
                  <BlockIcon iconKey={data.badge.iconKey} className="h-5 w-5" />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-base font-bold text-fg">{data.badge.title}</span>
                  <span className="text-sm text-fg-muted">{data.badge.subtitle}</span>
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
