/**
 * Rasterise page 1 of a certificate PDF to PNG, so a render can actually be LOOKED at
 * next to the approved artwork in `docs/sample certificate/`.
 *
 * `check-certificate-render.cjs` already does this, but only for the fixed "Your Name"
 * specimen it measures against. This takes any PDF, which is what you want when checking
 * a real holder's name — a long name is a different width and can collide with the rule
 * under it in a way "Your Name" never would.
 *
 * USAGE (from the repo root):
 *   node scripts/raster-certificate.cjs <input.pdf> <output.png> [widthPx]
 */
const path = require("node:path");
const fs = require("node:fs");

// @playwright/test is a workspace dependency, not hoisted to the root, so resolve it the
// same way check-certificate-render.cjs does rather than assuming a flat node_modules.
function loadPlaywright() {
  for (const base of [
    path.join(__dirname, "..", "apps", "web"),
    path.join(__dirname, "..", "apps", "crm"),
    path.join(__dirname, "..", "apps", "lms"),
    path.join(__dirname, ".."),
  ]) {
    const p = path.join(base, "node_modules", "@playwright", "test");
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("@playwright/test not found — run `pnpm install` first.");
}

const [pdfPath, outPath, widthArg] = process.argv.slice(2);
if (!pdfPath || !outPath) {
  console.error("usage: node scripts/raster-certificate.cjs <input.pdf> <output.png> [widthPx]");
  process.exit(1);
}
const WIDTH = Number(widthArg) || 1536;

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.goto("about:blank");
    const b64 = fs.readFileSync(pdfPath).toString("base64");
    const result = await page.evaluate(
      async ([b64, width]) => {
        const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs";
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        const p1 = await doc.getPage(1);
        const base = p1.getViewport({ scale: 1 });
        const viewport = p1.getViewport({ scale: width / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await p1.render({ canvasContext: ctx, viewport }).promise;
        // Page count matters: @react-pdf silently pushes values onto a SECOND page when the
        // absolutely-positioned children are not inside a sized View, and a one-page check
        // that only looks at page 1 would call that render perfect.
        return { dataUrl: canvas.toDataURL("image/png"), pages: doc.numPages, w: canvas.width, h: canvas.height };
      },
      [b64, WIDTH],
    );
    fs.writeFileSync(outPath, Buffer.from(result.dataUrl.split(",")[1], "base64"));
    console.log(`wrote ${outPath} (${result.w}x${result.h}) — pdf pages: ${result.pages}`);
    if (result.pages !== 1) {
      console.error(`WARNING: ${result.pages} pages. A certificate must be ONE page.`);
    }
  } finally {
    await browser.close();
  }
})();
