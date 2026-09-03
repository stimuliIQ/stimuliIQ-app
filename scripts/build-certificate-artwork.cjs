/**
 * Build the BLANK certificate artwork the PDF renderer prints full-bleed.
 *
 * Reads the approved specimens in `docs/sample certificate/`, erases the four values that
 * differ per student, and writes the results into the API's private asset directory as
 * `apps/api/assets/certificate/{training,internship}-certificate-blank.png`.
 *
 * WHY THE BLANKS ARE BUILT RATHER THAN HAND-EDITED
 * ------------------------------------------------
 * The renderer has two modes. It can DRAW the certificate in code — frame, ribbon, seal,
 * headings, ornaments — which is a copy, and a copy is never the approved design: the
 * typeface, the ornament geometry and the spacing all drift, and every visual tweak costs
 * a TypeScript edit. Or it can PRINT the approved export and place only the per-student
 * values on it, which is exact by construction. The second needs a version of the artwork
 * with those values removed, and that file is derived from the specimen, so deriving it
 * with a script keeps it honest: re-approve a design, re-run this, and the blank follows.
 * A hand-erased PNG committed once drifts from the specimen the first time the specimen
 * changes, silently, in a file nobody diffs.
 *
 * WHAT IS ERASED (and nothing else)
 * ---------------------------------
 *   1. the holder name          2. the body paragraph
 *   3. the certificate id value 4. the issue date value
 *
 * Their LABELS stay ("CERTIFICATE ID", "Date of Issue:"), as does every static mark —
 * frame, corner ornaments, ribbon, seal, wordmark, ISO/MSME lockups, signature block and
 * the "Verify this certificate at" line — so all of that is pixel-exact in the output.
 *
 * The body paragraph is erased rather than kept because the programme name and the date
 * sit mid-sentence: a baked sentence with a gap in it cannot fit both "AI" and "Clinical
 * Neurology Fellowship" without one of them looking wrong.
 *
 * HOW THE ERASE WORKS
 * -------------------
 * Not a filled rectangle. The specimen carries a faint decorative wave across the left of
 * the page that runs BEHIND the first words of the body paragraph, and a rectangle would
 * take that with it — leaving a clean patch exactly where the eye follows the ornament.
 * Instead each region is reduced to a mask of its dark ink, grown enough to swallow both
 * the antialiasing halo and the compression ringing just outside it, and every masked
 * pixel takes the AVERAGE OF THE UNMASKED PAPER AROUND IT. Whatever the ink sat on closes
 * back over it, because the average follows the local level rather than a fixed colour.
 *
 * The grown mask is what makes this invisible, and it was not obvious: a 3 px halo left
 * the letters legible as mottling — the paper is flat to about ±1 level, so diffusing a
 * ringing artefact inward writes a ghost that is only two or three levels off and still
 * perfectly readable as the old word. Sampling from BEYOND the artefact, and dithering the
 * fill by the paper's own ±1, is what makes the erased area indistinguishable from paper.
 *
 * USAGE (from the repo root):
 *   node scripts/build-certificate-artwork.cjs [--check]
 *
 * `--check` rebuilds into memory and fails if the committed blanks differ — the guard for
 * "somebody replaced the specimen and forgot the blank".
 *
 * The output is committed, so the API does not build these at deploy time.
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
const OUT_DIR = path.join(ROOT, "apps", "api", "assets", "certificate");

/**
 * The four value regions, in specimen pixels (both specimens are 1536 × 1024).
 *
 * These are BOUNDS, not the erase itself — the mask inside them is what gets filled. They
 * exist to stop the mask reaching a neighbour: the ornamental rule 6 pt under the name, the
 * "CERTIFICATE ID" label above its value, the column separators either side of it. Each was
 * measured off the specimen (see the ink-band profile in the commit that added this file),
 * and the two artworks differ by a few pixels of vertical placement, which is why they are
 * listed separately rather than shared.
 */
const REGIONS = {
  "training-certificate.png": {
    out: "training-certificate-blank.png",
    // name ink y473-558, rule below at y569; body ink y614-733, separators below at y780;
    // id value ink y838-852, label above ends y818, rule below starts y867;
    // date value ink y950-964, bottom border at y1005.
    regions: [
      { name: "holderName", x0: 400, x1: 1195, y0: 450, y1: 564 },
      { name: "body", x0: 320, x1: 1195, y0: 598, y1: 750 },
      { name: "certificateId", x0: 405, x1: 675, y0: 822, y1: 862 },
      { name: "issuedAt", x0: 1040, x1: 1215, y0: 942, y1: 978 },
    ],
  },
  "internship-certificate.png": {
    out: "internship-certificate-blank.png",
    // Same marks, sitting ~5 px lower than the training layout.
    regions: [
      { name: "holderName", x0: 400, x1: 1195, y0: 462, y1: 574 },
      { name: "body", x0: 320, x1: 1195, y0: 608, y1: 758 },
      { name: "certificateId", x0: 405, x1: 672, y0: 822, y1: 862 },
      { name: "issuedAt", x0: 1040, x1: 1215, y0: 946, y1: 982 },
    ],
  },
};

/** Ink threshold. Above the paper (≈248) and below the faint wave ornament (≈220-244). */
const INK_LUMA = 215;
/**
 * Pixels to grow the ink mask by.
 *
 * Six, not two or three. The specimen has been through a lossy encoder at some point, so
 * every glyph carries a ring of over-shot pixels a few levels off the paper. Sampling the
 * replacement from inside that ring reproduces the word as a faint mottle — legible, and
 * exactly the "close but not the design" failure artwork mode exists to end.
 */
const DILATE = 6;
/** Radius of the paper sampled around a masked pixel. Grown when a window comes up empty. */
const SAMPLE_RADIUS = 9;

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Erase one region: mask its ink, grow the mask, replace each masked pixel with the paper
 * around it.
 *
 * The replacement is a LOCAL average rather than one flat colour so that whatever the ink
 * sat on — the paper's own level, and on the left of the page the faint wave ornament —
 * carries through instead of being replaced by a patch of the region's mean.
 *
 * `dither` re-adds the ±1 the paper actually varies by. Without it the fill is perfectly
 * uniform, and a perfectly uniform patch on slightly noisy paper is visible as a shape
 * even when its colour is right.
 */
function eraseRegion(data, W, C, region, dither) {
  const { x0, x1, y0, y1 } = region;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const at = (x, y) => ((y0 + y) * W + (x0 + x)) * C;

  let mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      if (luma(data[i], data[i + 1], data[i + 2]) < INK_LUMA) mask[y * w + x] = 1;
    }
  }
  const inkPixels = mask.reduce((a, v) => a + v, 0);
  if (inkPixels === 0) return 0;

  for (let pass = 0; pass < DILATE; pass++) {
    const next = Uint8Array.from(mask);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) continue;
        for (let dy = -1; dy <= 1 && !next[y * w + x]; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
            if (mask[yy * w + xx]) { next[y * w + x] = 1; break; }
          }
        }
      }
    }
    mask = next;
  }

  // Read every replacement out of the ORIGINAL pixels, so a filled pixel can never become
  // the sample for the next one — that is what smears a fill across a wide mask.
  const source = Buffer.from(data);
  const fills = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let radius = SAMPLE_RADIUS; n === 0 && radius <= 64; radius *= 2) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= h || xx >= w || mask[yy * w + xx]) continue;
            const i = at(xx, yy);
            r += source[i]; g += source[i + 1]; b += source[i + 2]; n++;
          }
        }
      }
      if (n) fills.push([x, y, r / n, g / n, b / n]);
    }
  }

  for (const [x, y, r, g, b] of fills) {
    const i = at(x, y);
    const noise = dither();
    data[i] = Math.max(0, Math.min(255, Math.round(r + noise)));
    data[i + 1] = Math.max(0, Math.min(255, Math.round(g + noise)));
    data[i + 2] = Math.max(0, Math.min(255, Math.round(b + noise)));
  }
  return inkPixels;
}

/**
 * A deterministic ±1 dither.
 *
 * Deterministic because the built files are committed and `--check` compares them byte for
 * byte: a random dither would report the artwork as stale on every run.
 */
function makeDither() {
  let seed = 0x9e3779b9;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed % 3) - 1;
  };
}

async function build(srcName) {
  const spec = REGIONS[srcName];
  const src = path.join(SRC_DIR, srcName);
  const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(data);

  const dither = makeDither();
  const erased = spec.regions.map(
    (r) => `${r.name}=${eraseRegion(pixels, info.width, info.channels, r, dither)}px`,
  );

  const png = await sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { out: spec.out, png, erased, size: `${info.width}x${info.height}` };
}

async function main() {
  const check = process.argv.includes("--check");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let stale = false;

  for (const srcName of Object.keys(REGIONS)) {
    const { out, png, erased, size } = await build(srcName);
    const dest = path.join(OUT_DIR, out);

    if (check) {
      const current = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
      const same = current && current.equals(png);
      console.log(`[check] ${out.padEnd(34)} ${same ? "up to date" : "STALE — re-run without --check"}`);
      if (!same) stale = true;
      continue;
    }

    fs.writeFileSync(dest, png);
    console.log(`[artwork] ${out.padEnd(34)} ${size}  ${(png.length / 1024).toFixed(0)} KB  erased ${erased.join(" ")}`);
  }

  if (stale) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
