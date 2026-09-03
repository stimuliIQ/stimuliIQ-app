// Unit tests for artwork mode's two lookup tables and the asset loader that feeds them.
//
// What is worth pinning here is narrow but load-bearing: which placement wins when three
// sources disagree, that the assets the renderer defaults to are actually on disk, and that
// the artwork's intrinsic size — which SETS THE PAGE SIZE — is read correctly. Everything
// else about artwork mode is visual, and is checked by rasterising a real render against
// the approved design (scripts/check-certificate-render.cjs).

import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_ARTWORK_FIELDS,
  DEFAULT_ARTWORK_FONTS,
  resolveArtworkFields,
} from "./artwork-certificate";
import { loadCertificateArtwork, resolveCertificateFontPath } from "./certificate-assets";

const ASSET_DIR = join(__dirname, "..", "..", "..", "..", "..", "assets", "certificate");

describe("resolveArtworkFields", () => {
  it("gives the two approved artworks different name and paragraph positions", () => {
    // Not a shared layout with a different ribbon: the internship export's upper block sits
    // ~13 px left of the training one's at 1536 px wide, and the name is centred on an
    // ornamental rule the artwork itself draws. One shared centre puts the name visibly off
    // that rule on both certificates.
    const training = resolveArtworkFields("training", undefined);
    const internship = resolveArtworkFields("internship", undefined);

    expect(training.holderName.x).not.toEqual(internship.holderName.x);
    expect(training.body.y).not.toEqual(internship.body.y);
  });

  it("keeps the shared values for everything the two artworks agree on", () => {
    const training = resolveArtworkFields("training", undefined);
    const internship = resolveArtworkFields("internship", undefined);

    expect(training.certificateId).toEqual(internship.certificateId);
    expect(training.issuedAt).toEqual(internship.issuedAt);
    expect(training.body.size).toBe(DEFAULT_ARTWORK_FIELDS.body.size);
  });

  it("lets a template override win over both the shared table and the artwork's own nudge", () => {
    const resolved = resolveArtworkFields("training", { holderName: { x: 10, y: 20, size: 8 } });

    expect(resolved.holderName.x).toBe(10);
    expect(resolved.holderName.y).toBe(20);
    expect(resolved.holderName.size).toBe(8);
    // Only the keys the override names are replaced; the rest of that placement survives.
    expect(resolved.holderName.font).toBe("script");
  });

  it("falls back to the shared table for a kind with no approved artwork", () => {
    expect(resolveArtworkFields("course", undefined)).toEqual(DEFAULT_ARTWORK_FIELDS);
  });
});

describe("the assets artwork mode defaults to", () => {
  it("ships both approved blanks", async () => {
    // Built from the specimens by scripts/build-certificate-artwork.cjs and committed. If
    // one is missing the renderer silently falls back to drawing its own reproduction.
    for (const name of ["training-certificate-blank.png", "internship-certificate-blank.png"]) {
      const artwork = await loadCertificateArtwork(name);
      expect(artwork).toBeDefined();
      expect(artwork!.widthPx).toBe(1536);
      expect(artwork!.heightPx).toBe(1024);
      expect(artwork!.src.startsWith("data:image/png;base64,")).toBe(true);
    }
  });

  it("ships every font it names, so nothing degrades to Helvetica", async () => {
    for (const fileName of Object.values(DEFAULT_ARTWORK_FONTS)) {
      expect(await resolveCertificateFontPath(fileName)).toBeDefined();
    }
  });

  it("refuses a web font, which @react-pdf embeds and then renders as blank space", async () => {
    // .woff2 is not on the allowlist ON PURPOSE: @react-pdf accepts one without complaint,
    // embeds it, names the right face in the PDF's font table, and draws nothing. Refusing
    // the extension turns an invisible failure into the documented fallback.
    expect(await resolveCertificateFontPath("Outfit-Medium.woff2")).toBeUndefined();
    // And nobody has quietly dropped one in expecting it to work.
    expect(readdirSync(ASSET_DIR).filter((f) => /\.woff2?$/i.test(f))).toEqual([]);
  });

  it("cannot be pointed outside the asset directory by a CRM-editable name", async () => {
    // `design` is a CRM-editable JSON column, so every file name here is untrusted input.
    expect(await loadCertificateArtwork("../../../../etc/passwd")).toBeUndefined();
    expect(await loadCertificateArtwork("../.env")).toBeUndefined();
    expect(await resolveCertificateFontPath("../../../../etc/passwd")).toBeUndefined();
  });
});
