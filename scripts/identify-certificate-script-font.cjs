/**
 * Identify which script face the approved certificate artwork is set in.
 *
 * WHY THIS IS MEASURED AND NOT EYEBALLED. The renderer previously used Parisienne, chosen
 * "by measuring glyph aspect and single-glyph widths". Aspect ratio is not enough: several
 * script faces share it while differing in the thing a reader actually notices, which is
 * stroke CONTRAST — the ratio of thick downstroke to hairline upstroke. Parisienne is close
 * to monoline; the approved artwork is high-contrast. Side by side that reads as the wrong
 * font, which is what a reviewer reported.
 *
 * HOW IT WORKS. The specimen's own placeholder text is "Your Name", set in the real face.
 * Each candidate renders the same string, both are reduced to a normalised ink mask (crop
 * to the ink bounding box, scale to a common height, threshold), and the score is the
 * fraction of pixels that disagree. Normalising by bounding box removes size and position,
 * so what is left is letterform shape and weight distribution.
 *
 * USAGE (from the repo root):
 *   node scripts/identify-certificate-script-font.cjs <fontsDir> [outDir]
 *
 * `fontsDir` holds candidate .ttf files. Lower score is a better match; the report prints
 * them ranked, so a near-tie is visible rather than hidden behind a single "winner".
 */
const path = require("node:path");
const fs = require("node:fs");

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

function loadPlaywright() {
  for (const base of [
    path.join(__dirname, "..", "apps", "web"),
    path.join(__dirname, "..", "apps", "crm"),
    path.join(__dirname, ".."),
  ]) {
    const p = path.join(base, "node_modules", "@playwright", "test");
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("@playwright/test not found — run `pnpm install` first.");
}

const SPECIMEN = path.join(__dirname, "..", "docs", "sample certificate", "internship-certificate.png");
/** The name's ink box on the 1536x1024 specimen, from artwork-certificate.ts. */
const NAME_INK = { left: 576, top: 473, width: 363, height: 93 };
const SAMPLE_TEXT = "Your Name";
/** Common height every mask is scaled to before comparison. */
const NORM_H = 120;

/** Crop to ink, scale to NORM_H, threshold to a 1-bit mask. */
async function inkMask(sharp, input, { alreadyCropped = false } = {}) {
  let img = sharp(input);
  const meta = await img.metadata();
  const { data, info } = await img.clone().greyscale().raw().toBuffer({ resolveWithObject: true });

  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] < 160) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("no ink found in " + (typeof input === "string" ? input : "buffer"));

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const normW = Math.max(1, Math.round((w / h) * NORM_H));
  const out = await sharp(input)
    .extract({ left: minX, top: minY, width: w, height: h })
    .resize(normW, NORM_H, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mask = new Uint8Array(normW * NORM_H);
  for (let i = 0; i < mask.length; i += 1) mask[i] = out.data[i] < 160 ? 1 : 0;
  return { mask, width: normW, height: NORM_H, aspect: w / h, meta, alreadyCropped };
}

/** Fraction of disagreeing pixels once both masks are on a common width. */
function disagreement(a, b, sharp) {
  const width = Math.max(a.width, b.width);
  const sample = (m, x, y) => {
    const sx = Math.min(m.width - 1, Math.round((x / width) * m.width));
    return m.mask[y * m.width + sx];
  };
  let diff = 0;
  for (let y = 0; y < NORM_H; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (sample(a, x, y) !== sample(b, x, y)) diff += 1;
    }
  }
  return diff / (width * NORM_H);
}

async function main() {
  const sharp = loadSharp();
  const { chromium } = loadPlaywright();
  const fontsDir = process.argv[2];
  const outDir = process.argv[3];
  if (!fontsDir) {
    console.error("usage: node scripts/identify-certificate-script-font.cjs <fontsDir> [outDir]");
    process.exit(1);
  }
  if (outDir) fs.mkdirSync(outDir, { recursive: true });

  const specimenCrop = await sharp(SPECIMEN)
    .resize(1536, 1024, { fit: "fill" })
    .extract(NAME_INK)
    .png()
    .toBuffer();
  const target = await inkMask(sharp, specimenCrop);
  if (outDir) fs.writeFileSync(path.join(outDir, "_specimen-name.png"), specimenCrop);

  const candidates = fs.readdirSync(fontsDir).filter((f) => /\.(ttf|otf)$/i.test(f));
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const file of candidates) {
      const name = path.basename(file, path.extname(file));
      const b64 = fs.readFileSync(path.join(fontsDir, file)).toString("base64");
      const page = await browser.newPage({ viewport: { width: 1400, height: 400 } });
      await page.setContent(`<!doctype html><html><head><style>
        @font-face { font-family: "Cand"; src: url(data:font/ttf;base64,${b64}); }
        html,body { margin:0; background:#fff; }
        #t { font-family:"Cand"; font-size:200px; color:#000; white-space:nowrap;
             padding:60px; display:inline-block; }
      </style></head><body><span id="t">${SAMPLE_TEXT}</span></body></html>`);
      await page.evaluate(() => document.fonts.ready);
      const shot = await page.locator("#t").screenshot();
      await page.close();

      const mask = await inkMask(sharp, shot);
      const score = disagreement(target, mask, sharp);
      results.push({ name, score, aspect: mask.aspect });
      if (outDir) fs.writeFileSync(path.join(outDir, `${name}.png`), shot);
    }
  } finally {
    await browser.close();
  }

  results.sort((a, b) => a.score - b.score);
  console.log(`specimen "${SAMPLE_TEXT}" aspect ${target.aspect.toFixed(3)}\n`);
  console.log("rank  font                 mismatch   aspect   (lower mismatch = closer)");
  results.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${r.name.padEnd(20)} ${(r.score * 100).toFixed(2).padStart(6)}%  ${r.aspect.toFixed(3)}`,
    );
  });
  if (outDir) console.log(`\nrenders written to ${outDir} (compare against _specimen-name.png)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
