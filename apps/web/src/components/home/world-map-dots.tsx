/**
 * WorldMapDots — decorative dot-matrix world map used as the background of the
 * StatsBento "by the numbers" band.
 *
 * Continents are stylized polygons (not geographic path data — decorative at
 * this size, not a navigational map) used purely as an SVG clip-path; a tiled
 * <pattern> of small circles is clipped to that silhouette so dots exist only
 * over "land," matching the reference dot-map aesthetic. Colour comes from
 * `currentColor`, so the caller tints it via a text-color class (e.g.
 * `text-chart-3/[0.16]`) and it follows light/dark theme automatically.
 *
 * Purely decorative: aria-hidden, no text content, static (no animation to
 * neutralise for prefers-reduced-motion).
 */
export function WorldMapDots({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg aria-hidden="true" viewBox="0 0 1000 500" className={className} style={style}>
      <defs>
        <pattern id="world-map-dot-grid" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="1.3" fill="currentColor" />
        </pattern>
        <clipPath id="world-map-continents">
          <path d="M70,110 140,70 220,60 300,90 330,140 300,190 260,200 240,240 200,270 170,240 120,220 90,180 60,150 Z" />
          <path d="M350,50 390,40 410,70 380,100 350,80 Z" />
          <path d="M280,280 330,270 360,300 370,360 350,430 320,470 300,450 290,390 270,330 Z" />
          <path d="M470,90 520,70 550,90 540,120 500,136 476,120 Z" />
          <path d="M480,150 540,140 570,190 560,260 540,330 510,370 490,340 470,280 464,210 Z" />
          <path d="M560,70 660,50 780,60 860,90 910,130 900,180 840,210 780,200 730,230 680,220 640,250 600,220 570,180 550,120 Z" />
          <path d="M800,350 870,340 910,370 900,410 840,420 800,390 Z" />
          <path d="M910,150 924,140 936,160 920,180 Z" />
          <circle cx="442" cy="92" r="6" />
          <circle cx="780" cy="282" r="8" />
          <circle cx="812" cy="292" r="6" />
          <circle cx="832" cy="302" r="6" />
          <circle cx="572" cy="352" r="6" />
        </clipPath>
      </defs>
      <rect width="1000" height="500" fill="url(#world-map-dot-grid)" clipPath="url(#world-map-continents)" />
    </svg>
  );
}
