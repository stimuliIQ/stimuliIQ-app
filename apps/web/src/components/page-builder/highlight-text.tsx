/**
 * HighlightText — wraps the first occurrence of `highlight` (a literal substring of
 * `text`, per docs/specs/phase-10-page-builder.md "Shared conventions") in the brand
 * accent span, reproducing every audited page's "colored word inside an otherwise plain
 * heading" pattern (e.g. `How It <span className="text-chart-3">Works</span>`) without
 * allowing embedded HTML — `highlight` is validated server-side (`HeadingWithEyebrowSchema`
 * et al.) to actually be a substring of `text`, but this renders defensively (no match →
 * the plain text, unhighlighted) in case a stale/reverted version predates that guarantee.
 */
export function HighlightText({
  text,
  highlight,
}: {
  text: string;
  highlight?: string | null;
}): React.JSX.Element {
  if (!highlight) return <>{text}</>;
  const index = text.indexOf(highlight);
  if (index === -1) return <>{text}</>;
  const before = text.slice(0, index);
  const after = text.slice(index + highlight.length);
  return (
    <>
      {before}
      <span className="text-chart-3">{highlight}</span>
      {after}
    </>
  );
}
