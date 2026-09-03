/**
 * Verify the rendered certificate lands its values exactly where the approved design puts
 * them.
 *
 * Artwork mode makes everything static about a certificate pixel-exact by printing the
 * approved export as the page. The four values drawn ON TOP are the part that can still be
 * wrong, and wrong in a way no test catches: a name two points too large or a paragraph
 * three pixels high still renders, still passes `expect(bytes).toStartWith("%PDF")`, and
 * still looks like a certificate. The only way to know is to rasterise the output and
 * compare it with the specimen it is meant to reproduce.
 *
 * WHAT IT DOES
 *   1. renders both awards through the real adapter (no database — same path as
 *      `scripts/render-sample-certificate.ts`), with the specimen's own placeholder values
 *      so the output should land on the specimen's own ink;
 *   2. rasterises page 1 to the specimen's 1536 × 1024 with pdf.js in a headless browser;
 *   3. measures the ink box of each drawn value and reports its offset from the specimen's.
 *
 * A value is REPORTED, not asserted, unless --strict is passed: the tolerance that matters
 * is a designer's eye, and a name is a different string from "Your Name" so its width will
 * never match. Left/top/height are the numbers to watch; width only for the body paragraph,
 * whose text is fixed apart from the programme name.
 *
 * USAGE (from the repo root):
 *   node scripts/check-certificate-render.cjs [--strict] [--out <dir>]
 *
 * --out also writes the rasterised renders and a diff against the specimen, which is the
 * fastest way to see what moved.
 */
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const API = path.join(ROOT, "apps", "api");
const SPEC_DIR = path.join(ROOT, "docs", "sample certificate");

function loadSharp() {
  try {
    return require("sharp");
  } catch {
    const store = path.join(ROOT, "node_modules", ".pnpm");
    const dir = fs.readdirSync(store).find((d) => /^sharp@/.test(d));
    if (!dir) throw new Error("sharp not found — run `pnpm install` first.");
    return require(path.join(store, dir, "node_modules", "sharp"));
  }
}
function loadPlaywright() {
  for (const base of [ROOT, path.join(ROOT, "apps", "web"), path.join(ROOT, "apps", "crm")]) {
    const p = path.join(base, "node_modules", "@playwright", "test");
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("@playwright/test not found — run `pnpm install` first.");
}
const sharp = loadSharp();

/**
 * The specimen's own ink boxes, in specimen pixels — the target the render must hit.
 *
 * Measured from `docs/sample certificate/*.png` by thresholding at luma 175 over a window
 * around each value; the same numbers the erase regions in `build-certificate-artwork.cjs`
 * were cut from, which is why the two files must be read together.
 */
const EXPECTED = {
  training: {
    holderName: { x0: 576, x1: 939, y0: 473, y1: 558 },
    body: { x0: 363, x1: 1112, y0: 614, y1: 733 },
    certificateId: { x0: 453, x1: 631, y0: 838, y1: 852 },
    issuedAt: { x0: 1060, x1: 1190, y0: 950, y1: 964 },
  },
  internship: {
    holderName: { x0: 562, x1: 922, y0: 478, y1: 566 },
    body: { x0: 346, x1: 1126, y0: 624, y1: 739 },
    certificateId: { x0: 452, x1: 629, y0: 837, y1: 852 },
    issuedAt: { x0: 1060, x1: 1188, y0: 954, y1: 968 },
  },
};

/**
 * Where to look for each value in the render.
 *
 * Deliberately generous, because what is measured inside them is the DIFFERENCE between the
 * render and the blank artwork, not the render's own ink. Thresholding the render directly
 * measures whatever static mark the window happens to overlap — the ornamental rule six
 * pixels under the name, the "CERTIFICATE ID" label above its value — and reports it as the
 * drawn value having moved. Diffing leaves only the pixels this renderer put there, so the
 * windows can be loose enough to catch a field that drifted badly.
 */
const WINDOWS = {
  holderName: { x0: 330, x1: 1200, y0: 440, y1: 600, anchor: "centre" },
  body: { x0: 300, x1: 1210, y0: 596, y1: 770, anchor: "centre" },
  certificateId: { x0: 400, x1: 678, y0: 815, y1: 866, anchor: "centre" },
  issuedAt: { x0: 1036, x1: 1220, y0: 932, y1: 992, anchor: "left" },
};

/** The specimen's placeholder values, so the render should land on the specimen's own ink. */
const SAMPLE = { name: "Your Name", program: "Domain", serial: "STIQ-2026-000001", issued: "2026-07-25" };

function renderPdfs(outDir) {
  // Run through the API workspace so ts-node, the path aliases and the private asset
  // directory all resolve exactly as they do in the running service.
  execFileSync(
    "node",
    [
      "-r", "ts-node/register",
      "-r", "tsconfig-paths/register",
      path.join("scripts", "render-sample-certificate.ts"),
      "--name", SAMPLE.name,
      "--program", SAMPLE.program,
      "--serial", SAMPLE.serial,
      "--issued", SAMPLE.issued,
      "--out", outDir,
    ],
    { cwd: API, stdio: "inherit", env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" } },
  );
}

/** Rasterise page 1 at the specimen's size, using pdf.js inside a headless browser. */
async function rasterise(browser, pdfPath, width, height) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.goto("about:blank");
  await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs", type: "module" });
  const b64 = fs.readFileSync(pdfPath).toString("base64");
  const dataUrl = await page.evaluate(
    async ([b64, width, height]) => {
      const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      const pdfPage = await doc.getPage(1);
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: width / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL("image/png");
    },
    [b64, width, height],
  );
  await page.close();
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/**
 * The box of pixels this render ADDED to the blank artwork, inside `win`.
 *
 * The threshold is on the difference, not on darkness, so the ornaments and labels the
 * artwork already carries contribute nothing however close they sit. 40 levels is well
 * above the few levels of rescaling noise between a rasterised page and the source PNG, and
 * well below the ~200 that dark text on pale paper produces.
 */
function drawnBox(render, blank, W, C, win, threshold = 40) {
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = win.y0; y <= win.y1; y++) {
    for (let x = win.x0; x <= win.x1; x++) {
      const i = (y * W + x) * C;
      const lr = 0.299 * render[i] + 0.587 * render[i + 1] + 0.114 * render[i + 2];
      const lb = 0.299 * blank[i] + 0.587 * blank[i + 1] + 0.114 * blank[i + 2];
      if (lb - lr > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, x1, y0, y1 };
}

async function main() {
  const strict = process.argv.includes("--strict");
  const outIdx = process.argv.indexOf("--out");
  const keepDir = outIdx > -1 ? path.resolve(process.argv[outIdx + 1]) : null;
  const workDir = keepDir ?? fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cert-check-"));
  fs.mkdirSync(workDir, { recursive: true });

  renderPdfs(workDir);

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  let worst = 0;

  for (const kind of ["training", "internship"]) {
    const specimen = path.join(SPEC_DIR, `${kind}-certificate.png`);
    const blankPath = path.join(ROOT, "apps", "api", "assets", "certificate", `${kind}-certificate-blank.png`);
    const { width, height } = await sharp(specimen).metadata();
    const pdf = path.join(workDir, `your-name-${kind}-certificate.pdf`);
    const png = await rasterise(browser, pdf, width, height);
    if (keepDir) fs.writeFileSync(path.join(keepDir, `${kind}-rendered.png`), png);

    // Both dropped to three channels: the rasteriser hands back RGBA and the artwork is RGB,
    // and comparing them at different strides silently reads the wrong pixel.
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const blank = await sharp(blankPath).removeAlpha().resize(width, height).raw().toBuffer();
    console.log(`\n== ${kind} ==`);
    console.log("  field          anchor    top     width   height   (Δ vs approved design, px)");

    for (const field of Object.keys(WINDOWS)) {
      const got = drawnBox(data, blank, info.width, info.channels, WINDOWS[field]);
      const want = EXPECTED[kind][field];
      if (!got) {
        console.log(`  ${field.padEnd(15)} NOT DRAWN`);
        worst = Infinity;
        continue;
      }
      // Horizontal is measured at the anchor the field is ALIGNED to. A centred value's
      // left edge moves whenever its text does — the body paragraph reflows the moment the
      // programme name or the date changes length — so comparing left edges reports a
      // correctly centred paragraph as badly placed. Its centre is the thing the design
      // fixes, and the thing that must not move.
      const centre = (b) => Math.round((b.x0 + b.x1) / 2);
      const d = {
        x: WINDOWS[field].anchor === "centre" ? centre(got) - centre(want) : got.x0 - want.x0,
        top: got.y0 - want.y0,
        width: got.x1 - got.x0 - (want.x1 - want.x0),
        height: got.y1 - got.y0 - (want.y1 - want.y0),
      };
      // Width is reported but not tracked: the rendered sentence carries a real date where
      // the specimen carries the word DATE, so it wraps differently and always will.
      const track = Math.max(Math.abs(d.x), Math.abs(d.top), Math.abs(d.height));
      worst = Math.max(worst, track);
      const fmt = (n) => String(n > 0 ? `+${n}` : n).padStart(7);
      console.log(`  ${field.padEnd(15)}${fmt(d.x)}${fmt(d.top)}${fmt(d.width)}${fmt(d.height)}`);
    }
  }

  await browser.close();
  console.log(`\nworst placement offset: ${worst} px (of 1536 wide)`);
  if (keepDir) console.log(`renders written to ${keepDir}`);
  if (strict && worst > 4) {
    console.error("FAIL — a drawn value is more than 4 px off the approved design.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
