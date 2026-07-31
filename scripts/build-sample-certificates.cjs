/**
 * Build the PUBLIC certificate specimens shown on the marketing site.
 *
 * Reads the approved artwork in `docs/sample certificate/`, burns a large diagonal
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
 * image is right-click-saved, protects nothing. It is deliberately large enough to be
 * destructive to reuse and drawn at partial opacity so the specimen still reads.
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
 * Two bands rather than one: a single central "SAMPLE" can be cropped out by taking the
 * top or bottom half of the image, which is exactly what someone reusing it would do.
 * The stroke outline keeps the word legible over both the white body and the dark green
 * ribbon — a flat fill disappears into one or the other.
 */
function watermarkSvg(width, height) {
  const size = Math.round(width * 0.155);
  const bands = [height * 0.34, height * 0.72];
  const words = bands
    .map(
      (y) => `
    <text x="${width / 2}" y="${y}" font-family="Helvetica, Arial, sans-serif"
          font-size="${size}" font-weight="700" letter-spacing="${size * 0.14}"
          text-anchor="middle" dominant-baseline="middle"
          fill="#14563C" fill-opacity="0.17"
          stroke="#FFFFFF" stroke-opacity="0.30" stroke-width="${Math.max(2, size * 0.02)}"
          transform="rotate(-24 ${width / 2} ${y})">SAMPLE</text>`,
    )
    .join("");

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${words}</svg>`,
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
