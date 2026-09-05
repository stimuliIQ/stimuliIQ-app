// apps/api/src/modules/certificates/providers/pdf/artwork-certificate.ts
//
// ARTWORK MODE — print the approved certificate design, draw only the values onto it.
//
// `sync-certificate-pdf.adapter.ts` REPRODUCES the approved certificate in code: frame,
// corner brackets, ribbon, seal, headings, body copy. It is a careful copy, and a copy is
// the problem — the typeface, the ornament geometry and the spacing are all drawn by that
// file, so they can never be identical to the artwork they imitate, and every visual tweak
// means editing TypeScript.
//
// This module inverts it. The approved export IS the page, printed full-bleed, and only the
// values that differ per student are drawn on top. The certificate is then exact by
// construction, and re-approving a new design means replacing one image file.
//
// WHAT THE BLANK ARTWORK MUST OMIT: the holder name, the body paragraph, the certificate id
// value and the issue date. Everything static — frame, ribbon, seal, headings, logos,
// signature block, the "Verify this certificate at" line — stays in the image and is
// therefore pixel-exact.
//
// The body paragraph is DRAWN rather than baked because the programme name and the dates sit
// mid-sentence: a baked sentence with a gap left in it cannot fit both "AI" and "Clinical
// Neurology Fellowship" without one of them looking wrong.
//
// SECURITY: same posture as the rest of this directory — the artwork and font names come
// from the CRM-editable `design` JSON and are reduced by `safeAssetName()` /
// `resolveCertificateFontPath()` before touching the filesystem; nothing here is served over
// HTTP, and `certUid` is never logged.

import { createElement as h, type ReactElement } from "react";
import { Document, Page, Text, Image, View, Font, type DocumentProps } from "@react-pdf/renderer";

import type {
  ArtworkFieldKey,
  ArtworkFieldPlacement,
  CertificateDesign,
  CertificateKind,
  CertificateRenderFields,
} from "./certificate-pdf-port.interface";
import { resolveCertificateFontPath } from "./certificate-assets";

/**
 * Field placements measured off the approved specimens in `docs/sample certificate/`
 * (both 1536 × 1024), as PERCENTAGES so the same numbers hold at any export size.
 *
 * A template that names artwork and nothing else already lands its values in the right
 * places; `design.artworkFields` overrides any single entry.
 *
 * `y` is the TOP OF THE LINE BOX, not the top of the ink, so these numbers are not the ink
 * boxes measured from the specimen — they are those boxes back-solved through the font's
 * ascent and the line height. They were tuned against a rasterised render until every drawn
 * value landed on the specimen's own ink to within a pixel; see
 * `scripts/check-certificate-render.cjs`, which is the loop that produced them and the one
 * that catches it if a font or a page size changes underneath them.
 *
 * These are the shared values; `ARTWORK_FIELD_OVERRIDES` carries the handful the two
 * approved exports disagree about.
 */
export const DEFAULT_ARTWORK_FIELDS: Record<ArtworkFieldKey, ArtworkFieldPlacement> = {
  /** The script line under "THIS IS TO CERTIFY THAT". Specimen ink: x 576-939, y 473-566. */
  holderName: {
    // #011E06, not the design system's #14563C. Sampled from the specimen's own ink (the
    // modal colour of the glyph interiors, so antialiased edges do not skew it): the
    // artwork's script is a near-black forest green, and the brand green read visibly
    // brighter and lighter beside it on the same page.
    x: 48.9, y: 45.4, width: 56, size: 52, align: "center", font: "script", color: "#011E06",
  },
  /**
   * The paragraph beneath the name's ornamental rule. Specimen ink: y 614-739, widest line
   * 750 px of 1536.
   *
   * `width` is the load-bearing number and it is NOT the box the text needs — it is the
   * measure the design wraps at. Set it wider and the sentence still fits and still centres,
   * in three long lines where the design has four; the paragraph is then a different shape
   * in the middle of an otherwise exact page. 49% is the specimen's own widest line.
   */
  body: {
    // #101010: the specimen's body copy is BLACK, not the UI's slate #1F2933. On paper
    // beside true black the slate reads as a faded grey, which is what made the drawn
    // values look like a different pass than the artwork's own type.
    x: 47.9, y: 59.8, width: 49, size: 10.2, align: "center", font: "body", color: "#101010",
    lineHeight: 1.9, letterSpacing: 0.62,
  },
  /** Under the "CERTIFICATE ID" label in the footer band. Specimen ink: x 453-631, y 838-852. */
  certificateId: {
    // Black, like the body copy above and for the same reason.
    x: 35.3, y: 81.2, width: 20, size: 11.5, align: "center", font: "bodyBold", color: "#101010",
  },
  /** After the "Date of Issue:" label on the bottom rule. Specimen ink: x 1060-1190, y 950-968. */
  issuedAt: {
    // #021D05 on the specimen — the date is GREEN, unlike the certificate id beside it,
    // which is black. They were both being drawn slate, so the date lost its colour
    // entirely and the two footer values stopped telling themselves apart.
    x: 69.0, y: 92.4, width: 20, size: 11.5, align: "left", font: "bodyBold", color: "#021D05",
  },
  /** Off unless a template positions it — the artwork carries the static verify address. */
  verifyUrl: { x: 50, y: 96, width: 40, size: 8, align: "center", font: "body", color: "#6B7280" },
};

/**
 * The authorised signature, drawn ABOVE the artwork's signature rule.
 *
 * The approved artwork carries the rule, "Chandra Sekhar" and "Founder" — but no signature.
 * It was never missing from the render; it was never in the design. `ceo-signature.png`
 * has shipped in the private asset directory all along and the CODE-DRAWN layout has always
 * placed it, so artwork mode was the one path that dropped it, which is why a certificate
 * that was otherwise pixel-exact arrived unsigned.
 *
 * Measured, not guessed: the rule is a 241 px horizontal run at y=823 spanning x 96-337 on
 * the 1536x1024 artwork, so the signature is centred on x=216.5 (14.1%) and sits with its
 * baseline just above y=818. Height is left to the image's own aspect — forcing both axes
 * would squash a signature, which is the one graphic on the page nobody may distort.
 */
export const SIGNATURE_PLACEMENT = {
  /** Left edge as a % of page width — the rule's centre (14.1%) less half the width. */
  left: 6.6,
  /**
   * Top as a % of page height. The image's natural height (aspect ~3.3:1) carries it down
   * to just above the rule at y=818 of 1024.
   */
  top: 73.1,
  /**
   * % of page width. Just under the rule's own 15.7%, so the signature spans it the way a
   * signature does rather than sitting as a small mark in the middle of a long line.
   */
  width: 15,
} as const;

/**
 * Where the two approved exports genuinely disagree.
 *
 * They are not the same layout with a different ribbon: the internship artwork's whole
 * upper block sits about 13 px left of the training one's at 1536 px wide, and its
 * paragraph about 10 px lower. That is visible on the page, because the name is centred on
 * an ORNAMENTAL RULE the artwork draws — the rules are at 752 and 739 respectively — so a
 * single shared centre splits the difference and leaves the name visibly off its own rule
 * on both certificates. Two lines of table beat that.
 *
 * Everything the two artworks agree on stays in the shared table above. Anything a template
 * sets in `design.artworkFields` still wins over both.
 */
const ARTWORK_FIELD_OVERRIDES: Partial<
  Record<CertificateKind, Partial<Record<ArtworkFieldKey, Partial<ArtworkFieldPlacement>>>>
> = {
  training: { holderName: { x: 49.3, y: 45.2 }, body: { y: 59.5 } },
  internship: { holderName: { x: 48.3, y: 45.7 }, body: { y: 60.5 } },
};

/** The placements for one award: shared table, the artwork's own nudges, then the template's. */
export function resolveArtworkFields(
  kind: CertificateKind,
  overrides: CertificateDesign["artworkFields"],
): Record<ArtworkFieldKey, ArtworkFieldPlacement> {
  const perArtwork = ARTWORK_FIELD_OVERRIDES[kind] ?? {};
  const resolved = {} as Record<ArtworkFieldKey, ArtworkFieldPlacement>;
  for (const key of Object.keys(DEFAULT_ARTWORK_FIELDS) as ArtworkFieldKey[]) {
    resolved[key] = { ...DEFAULT_ARTWORK_FIELDS[key], ...perArtwork[key], ...overrides?.[key] };
  }
  return resolved;
}

/**
 * The faces the approved artwork is set in, shipped in the private asset directory.
 *
 * Defaulted IN CODE rather than left to the template's `design` JSON. The artwork and the
 * type that goes on it are one design: a database row that names the artwork but not the
 * fonts would print the approved certificate with a Helvetica name across the middle of it,
 * and every environment seeded before these files existed is exactly that row. A template
 * that wants different faces still names them and wins.
 *
 * HOW THESE TWO WERE CHOSEN, since "it looks about right" is how a certificate ends up
 * subtly not being the approved design. Both were identified by measuring the specimen
 * rather than by eye, because eyes are bad at this and there are hundreds of candidates:
 *
 *   - Parisienne, for the name, from the PROPORTION of the specimen's "Your Name" — 363 ×
 *     85 px, an aspect of 4.271. Size is a free parameter and a connected script cannot be
 *     tracked, so aspect is a fingerprint nothing downstream can fake. Parisienne is 4.266.
 *     The next candidate is off by 8×, and Great Vibes — the obvious guess, and what this
 *     file's own documentation used to suggest — is off by 200×, which is why the first
 *     render came out with a name half again too tall for its width.
 *   - Outfit, for everything else, from the specimen's single-glyph widths as a fraction of
 *     cap height (O 1.000, F 0.677, C 0.903, M 1.032, E 0.645, measured off "OF COMPLETION"
 *     at 31 px). A single glyph's width is the fingerprint here because tracking, which the
 *     placements above set, moves a whole line but never one letter. Outfit matches all
 *     five inside the ±0.03 a 31 px measurement can resolve. Poppins — the obvious guess,
 *     and what this file tried second — is 3× that out on F and E, which is not noise: at a
 *     matched cap height its words come out about 15% wide, so the paragraph either
 *     overflows the design's column or has to be shrunk until the type is visibly small.
 *
 * The two Outfit files are STATIC instances, and finding them was the awkward part: Outfit
 * is published as a variable font, which hands @react-pdf a single weight and would flatten
 * the runs the design sets bolder. The web-font builds of the static instances are worse
 * than useless — @react-pdf embeds a .woff2 without complaint and renders it as blank space
 * (see certificate-assets.ts). These are TrueType instances, latin subset, which the sans
 * never strains: it sets only the fixed English sentence, the programme name, the serial
 * and the date. THE HOLDER NAME — the one string nobody controls — is Parisienne, and that
 * is the complete font.
 */
export const DEFAULT_ARTWORK_FONTS = {
  /**
   * PINYON SCRIPT, not Parisienne.
   *
   * Parisienne was chosen by measuring glyph aspect and single-glyph widths, and aspect is
   * not the property a reader notices on a certificate: STROKE CONTRAST is. Measured against
   * the approved artwork's own "Your Name" ink — thick-run over thin-run, p90/p10, which is
   * scale-invariant — the specimen sits at 6.0 and Parisienne at 2.5, ranking 23rd of the 26
   * script faces tried. It is close to monoline where the artwork is a high-contrast
   * copperplate, which is exactly the "font is not good" a reviewer reported.
   *
   * Pinyon Script measures 5.0 and shares the copperplate letterforms. Of the candidates it
   * is the only one that matches both the contrast and the structure; the next best on
   * contrast (Lovers Quarrel, Mea Culpa) are decorative in a way the artwork is not.
   *
   * NOT claimed to be the artwork's actual typeface — that name lives in the design source
   * and was never available here. It is the closest of 26 measured, which is a different and
   * weaker claim. `scripts/identify-certificate-script-font.cjs` re-runs the measurement in
   * one command if the real name ever turns up.
   */
  script: "PinyonScript-Regular.ttf",
  body: "Outfit-Medium.ttf",
  bodyBold: "Outfit-SemiBold.ttf",
} as const;

/** Registered @react-pdf font families; an absent slot falls back to a built-in face. */
export interface ArtworkFonts {
  script?: string;
  body?: string;
  bodyBold?: string;
}

const registeredFonts = new Set<string>();

/**
 * Register the template's fonts, once per process.
 *
 * Degrades silently on every failure path: an unreadable or unsupported file must not fail
 * an earned certificate, so a broken font falls back to Helvetica rather than to no PDF.
 * Family names are namespaced per file so two templates with different faces cannot collide
 * in @react-pdf's global registry.
 */
export async function registerArtworkFonts(design: CertificateDesign): Promise<ArtworkFonts> {
  const requested = { ...DEFAULT_ARTWORK_FONTS, ...(design.artworkFonts ?? {}) };
  const resolved: ArtworkFonts = {};

  for (const slot of ["script", "body", "bodyBold"] as const) {
    const fileName = requested[slot];
    if (!fileName) continue;
    const path = await resolveCertificateFontPath(fileName);
    if (!path) continue;

    const family = `cert-${slot}-${fileName.replace(/[^a-zA-Z0-9]/g, "")}`;
    if (!registeredFonts.has(family)) {
      try {
        Font.register({ family, src: path });
        registeredFonts.add(family);
      } catch {
        continue; // Unsupported/corrupt file — keep the built-in face.
      }
    }
    resolved[slot] = family;
  }
  return resolved;
}

/** Test seam — @react-pdf's font registry is global, so specs need to reset ours too. */
export function __clearRegisteredArtworkFonts(): void {
  registeredFonts.clear();
}

/** A percentage placement → the style @react-pdf needs for an absolutely-placed value. */
function placementStyle(placement: ArtworkFieldPlacement, fonts: ArtworkFonts) {
  const width = placement.width ?? 40;
  const align = placement.align ?? "center";
  // `x` is the CENTRE for centred text and the relevant edge otherwise — that is how a
  // person positioning a field thinks about it. Convert to the left edge react-pdf wants.
  const left = align === "center" ? placement.x - width / 2 : align === "right" ? placement.x - width : placement.x;
  const family = placement.font ? fonts[placement.font] : fonts.body;

  return {
    position: "absolute" as const,
    left: `${left}%`,
    top: `${placement.y}%`,
    width: `${width}%`,
    textAlign: align,
    fontSize: placement.size ?? 10,
    color: placement.color ?? "#1F2933",
    ...(family ? { fontFamily: family } : {}),
    ...(placement.lineHeight ? { lineHeight: placement.lineHeight } : {}),
    ...(placement.letterSpacing ? { letterSpacing: placement.letterSpacing } : {}),
  };
}

export interface ArtworkDocumentInput {
  fields: CertificateRenderFields;
  design: CertificateDesign;
  /** Data URI of the approved artwork, already loaded from the private asset directory. */
  artworkSrc: string;
  /**
   * Data URI of the authorised signature, or undefined when the file is absent.
   *
   * Optional on purpose: every certificate asset is optional (see certificate-assets.ts),
   * and a missing signature file must degrade to the artwork's bare rule rather than fail
   * an issuance for a student who has earned the award.
   */
  signatureSrc?: string;
  /**
   * The artwork's intrinsic pixel size, which SETS THE PAGE SIZE.
   *
   * The approved design is 3:2. A4 landscape is 1.414:1, so printing it onto A4 full-bleed
   * stretches it about 6% vertically — enough to turn the seal into an ellipse and stretch
   * every letter of the approved wordmark, while still looking roughly right, which is the
   * worst kind of wrong. The page takes the artwork's proportions instead.
   */
  artworkPx: { widthPx: number; heightPx: number };
  fonts: ArtworkFonts;
  /** Which approved artwork this is, so that artwork's own field nudges apply. */
  kind: CertificateKind;
  /** "TRAINING" | "INTERNSHIP" | "PROGRAM" — appears twice in the body sentence. */
  kindNoun: string;
  /** PDF document title, e.g. "TRAINING CERTIFICATE — Certificate of Completion". */
  documentTitle: string;
  orgName: string;
  /** Pre-formatted by the adapter so date formatting lives in exactly one place. */
  issuedAtText: string;
}

/**
 * The body sentence, with the two runs the approved copy sets in bold.
 *
 * Nested Text rather than one string so "TRAINING" and the programme name carry the heavier
 * weight exactly as the artwork does.
 */
function buildBody(input: ArtworkDocumentInput, placement: ArtworkFieldPlacement): ReactElement {
  const bold = input.fonts.bodyBold ? { fontFamily: input.fonts.bodyBold } : { fontWeight: 700 as const };

  return h(Text, { key: "body", style: placementStyle(placement, input.fonts) }, [
    "HAS SUCCESSFULLY COMPLETED HIS/HER ",
    h(Text, { key: "kind-1", style: bold }, input.kindNoun),
    " IN ",
    h(Text, { key: "programme", style: bold }, input.fields.programName.toUpperCase()),
    " ON ",
    h(Text, { key: "issued", style: bold }, `${input.issuedAtText}.`),
    " DURING THIS PROGRAM HE/SHE SHOWED DILIGENCE, CONSISTENCY, DETERMINATION, " +
      "ACTIVE PARTICIPATION, AND INNOVATION THROUGHOUT THE ",
    h(Text, { key: "kind-2", style: bold }, input.kindNoun),
    " PERIOD.",
  ]);
}

/**
 * A4 landscape's width in points — the page's long edge, whatever its proportions.
 *
 * Anchoring the WIDTH rather than fitting inside A4 in both axes keeps the certificate a
 * familiar size on screen and on paper: at 3:2 the page comes out 842 × 561 pt, shorter
 * than A4 landscape's 595 pt, so it still prints on an A4 sheet with a little more margin
 * top and bottom, which is exactly how a certificate is trimmed anyway.
 */
const PAGE_LONG_EDGE_PT = 841.89;

/** The whole document in artwork mode: one full-bleed image, and the values on top of it. */
export function buildArtworkDocument(input: ArtworkDocumentInput): ReactElement<DocumentProps> {
  const placements = resolveArtworkFields(input.kind, input.design.artworkFields);

  // The page IS the artwork, so it takes the artwork's aspect ratio rather than a paper
  // size. `orientation` is deliberately not consulted: the artwork already is landscape or
  // portrait, and letting a stale design flag rotate the page would only ever distort it.
  const { widthPx, heightPx } = input.artworkPx;
  const landscape = widthPx >= heightPx;
  const pageSize: [number, number] = landscape
    ? [PAGE_LONG_EDGE_PT, (PAGE_LONG_EDGE_PT * heightPx) / widthPx]
    : [(PAGE_LONG_EDGE_PT * widthPx) / heightPx, PAGE_LONG_EDGE_PT];

  const values: Array<[ArtworkFieldKey, string | undefined]> = [
    ["holderName", input.fields.holderName],
    ["certificateId", input.fields.serial],
    ["issuedAt", input.issuedAtText],
    // Only when a template positions it: the artwork already carries the static address.
    ["verifyUrl", input.design.artworkFields?.verifyUrl ? input.fields.verifyUrl : undefined],
  ];

  return h(
    Document,
    { title: input.documentTitle, author: input.orgName },
    h(
      Page,
      { size: pageSize, style: { position: "relative" } },
      // ONE full-size positioned View holding everything, rather than the image and the
      // values as direct children of the Page. Load-bearing, and it cost an afternoon:
      // @react-pdf measures a page-height child as flow content even when it is absolutely
      // positioned, decides the values no longer fit beside it, and pushes them onto a
      // SECOND PAGE. That fails silently — the render succeeds and produces the approved
      // artwork followed by a page carrying the student's name. Giving the absolute
      // children a sized container to resolve their percentages against keeps the page's
      // own flow empty, so there is never a second page to spill onto. (`wrap: false` looks
      // like the fix and is not: it tells @react-pdf to size the page to its content, and
      // with every child absolute that content is nothing — a page 0 pt tall.)
      h(View, { style: { position: "relative", width: "100%", height: "100%" } }, [
        // Full-bleed: the artwork IS the page, not a decoration on it.
        h(Image, {
          key: "artwork",
          src: input.artworkSrc,
          style: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" },
        }),
        // Above the artwork's signature rule. Omitted entirely when the asset is absent.
        ...(input.signatureSrc
          ? [
              h(Image, {
                key: "signature",
                src: input.signatureSrc,
                style: {
                  position: "absolute",
                  left: `${SIGNATURE_PLACEMENT.left}%`,
                  top: `${SIGNATURE_PLACEMENT.top}%`,
                  width: `${SIGNATURE_PLACEMENT.width}%`,
                },
              }),
            ]
          : []),
        buildBody(input, placements.body),
        ...values
          .filter((entry): entry is [ArtworkFieldKey, string] => Boolean(entry[1]))
          .map(([key, value]) => h(Text, { key, style: placementStyle(placements[key], input.fonts) }, value)),
      ]),
    ),
  );
}
