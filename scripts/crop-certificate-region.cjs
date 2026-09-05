/**
 * Crop the same region from several certificate images, stacked into one PNG.
 *
 * Comparing a render to the approved design by eye across two windows does not catch a
 * font that is close-but-wrong or a signature that is missing from one of them. Stacking
 * the identical region from each image puts them one above the other at the same scale,
 * which is the only way those show up.
 *
 * USAGE (from the repo root):
 *   node scripts/crop-certificate-region.cjs <out.png> <x> <y> <w> <h> <img1> [img2 ...]
 *
 * Coordinates are in the 1536x1024 space the approved artwork uses; each input is resized
 * to that before cropping, so sources of different pixel sizes stay comparable.
 */
const path = require("node:path");
const fs = require("node:fs");

// sharp arrives as a transitive dependency (Next.js image optimisation), not a direct one,
// so resolve it from the workspace store the way build-sample-certificates.cjs does.
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

const REF_W = 1536;
const REF_H = 1024;

async function main() {
  const sharp = loadSharp();
  const [out, xs, ys, ws, hs, ...images] = process.argv.slice(2);
  if (!out || images.length === 0) {
    console.error("usage: node scripts/crop-certificate-region.cjs <out.png> <x> <y> <w> <h> <img...>");
    process.exit(1);
  }
  const [x, y, w, h] = [xs, ys, ws, hs].map(Number);

  const crops = [];
  for (const img of images) {
    const buf = await sharp(img)
      .resize(REF_W, REF_H, { fit: "fill" })
      .extract({ left: x, top: y, width: w, height: h })
      .png()
      .toBuffer();
    crops.push(buf);
  }

  // Stack vertically with a thin separator, so it is obvious where one ends.
  const GAP = 6;
  const canvas = sharp({
    create: {
      width: w,
      height: h * crops.length + GAP * (crops.length - 1),
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  });
  await canvas
    .composite(crops.map((input, i) => ({ input, left: 0, top: i * (h + GAP) })))
    .png()
    .toFile(out);

  console.log(`wrote ${out} — ${crops.length} crops of ${w}x${h} at (${x},${y})`);
  images.forEach((img, i) => console.log(`  row ${i + 1}: ${path.basename(img)}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
