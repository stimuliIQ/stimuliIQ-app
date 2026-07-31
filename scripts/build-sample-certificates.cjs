/**
 * Build the PUBLIC certificate specimens shown on the marketing site.
 *
 * Reads the approved artwork in `docs/sample certificate/`, burns a tiled diagonal
 * **SAMPLE** watermark across each one, and writes WebP copies into
 * `apps/web/public/images/`.
 *
 * WHY THE WATERMARK IS NOT OPTIONAL
 * ---------------------------------
 * These two files are the only images of a Stimuli IQ certificate that anyone can fetch
 * over HTTP. Everything else about the document is protected — the signature is read from
 * a private server directory and never gets a URL, the serial is registered, the cert_uid
 * is signed — but a clean, high-resolution picture of the blank certificate is a
 * forger's starting point, and we would be publishing it ourselves.
 *
 * The watermark is composited into the pixels, not laid over the image with CSS: an
 * overlay a visitor can delete in devtools, or that simply does not come along when the
 * image is right-click-saved, protects nothing. It repeats across the whole document so
 * no single edit removes it, and is drawn at partial opacity so the specimen still reads.
 *
 * The artwork itself already carries placeholder values ("Your Name", "DOMAIN",
 * `STIQ-2026-000001`) and no signature, so nothing here depicts a real award.
 *
 * USAGE (from the repo root):
 *   node scripts/build-sample-certificates.cjs
 *
 * Re-run it whenever the artwork in `docs/sample certificate/` changes. The output is
 * committed, so the site does not build these at deploy time.
 */
const path = require("node:path");
const fs = require("node:fs");

// sharp arrives as a transitive dependency (Next.js image optimisation) rather than a
// direct one, so resolve it from the workspace root instead of assuming it is hoisted.
function loadSharp() {
  try {
    return require("sharp");
  } catch {
    const store = path.join(__dirname, "..", "node_modules", ".pnpm");
    const dir = fs.readdirSync(store).find((d) => /^sharp@/.test(d));
    if (!dir) throw new Error("sharp not found — run `pnpm install` first.");
    return require(path.join(store, dir, "node_modules", "sharp"));
  }
}

const sharp = loadSharp();
const ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT, "docs", "sample certificate");
const OUT_DIR = path.join(ROOT, "apps", "web", "public", "images");

const SPECIMENS = [
  { src: "internship-certificate.png", out: "sample-certificate-internship.webp" },
  { src: "training-certificate.png", out: "sample-certificate-training.webp" },
];

/**
 * The watermark, as an SVG the same size as the artwork.
 *
 * A TILED GRID of small marks, not one or two large ones. A big word is easy to attack:
 * it is a single object, so cloning a clean patch of background over it, cropping to the
 * half of the document it misses, or content-aware-filling one shape all remove it in a
 * couple of minutes. Repeating a small mark every few centimetres means the word sits on
 * top of the name, the programme line, the ID, the seal and the signature block at once —
 * removing it is removing the parts of the document a forger actually wants to keep.
 * Small also keeps the specimen readable, which the large version was starting to cost us.
 *
 * The grid is laid out in a rotated frame and drawn past every edge, so the marks run off
 * the sides at -24° with no bare corners for someone to crop back to. The stroke outline
 * keeps each word legible over both the white body and the dark green ribbon — a flat fill
 * disappears into one or the other.
 */
function watermarkSvg(width, height) {
  const size = Math.round(width * 0.042);
  const tracking = size * 0.14;
  // "SAMPLE" in bold Helvetica runs ~4.2em, plus the tracking added after each of 6 glyphs.
  const wordWidth = size * 4.2 + tracking * 6;
  const stepX = wordWidth * 1.4;
  const stepY = size * 3.1;

  // Cover the full diagonal in both axes: after rotating the grid by -24°, anything laid
  // out only over width × height would leave two empty corners.
  const span = Math.sqrt(width * width + height * height);
  const cols = Math.ceil(span / stepX) + 1;
  const rows = Math.ceil(span / stepY) + 1;
  const cx = width / 2;
  const cy = height / 2;

  const words = [];
  for (let row = -Math.ceil(rows / 2); row <= Math.ceil(rows / 2); row += 1) {
    // Offset every other row by half a step so the marks interlock instead of forming
    // clean vertical lanes that could be masked out column by column.
    const rowOffset = (Math.abs(row) % 2) * (stepX / 2);
    for (let col = -Math.ceil(cols / 2); col <= Math.ceil(cols / 2); col += 1) {
      const x = cx + col * stepX + rowOffset;
      const y = cy + row * stepY;
      words.push(`
    <text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Helvetica, Arial, sans-serif"
          font-size="${size}" font-weight="700" letter-spacing="${tracking.toFixed(2)}"
          text-anchor="middle" dominant-baseline="middle">SAMPLE</text>`);
    }
  }

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <g fill="#14563C" fill-opacity="0.16"
         stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="${Math.max(1, size * 0.03).toFixed(2)}"
         transform="rotate(-24 ${cx} ${cy})">${words.join("")}
      </g>
    </svg>`,
  );
}

async function build({ src, out }) {
  const srcPath = path.join(SRC_DIR, src);
  const outPath = path.join(OUT_DIR, out);

  const { width, height } = await sharp(srcPath).metadata();
  if (!width || !height) throw new Error(`could not read dimensions of ${src}`);

  await sharp(srcPath)
    .composite([{ input: watermarkSvg(width, height), top: 0, left: 0 }])
    .webp({ quality: 82 })
    .toFile(outPath);

  const bytes = fs.statSync(outPath).size;
  // eslint-disable-next-line no-console
  console.log(`[specimen] ${src} → ${path.relative(ROOT, outPath)} (${(bytes / 1024).toFixed(0)} KB)`);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const spec of SPECIMENS) await build(spec);
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
