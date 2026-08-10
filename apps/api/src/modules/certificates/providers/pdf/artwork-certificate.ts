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
import { Document, Page, Text, Image, Font, type DocumentProps } from "@react-pdf/renderer";

import type {
  ArtworkFieldKey,
  ArtworkFieldPlacement,
  CertificateDesign,
  CertificateRenderFields,
} from "./certificate-pdf-port.interface";
import { resolveCertificateFontPath } from "./certificate-assets";

/**
 * Field placements measured from the approved specimens in `docs/sample certificate/`
 * (1536 × 1024), as PERCENTAGES so the same numbers hold at any export size.
 *
 * A template that names artwork and nothing else already lands its values in the right
 * places; `design.artworkFields` overrides any single entry.
 */
export const DEFAULT_ARTWORK_FIELDS: Record<ArtworkFieldKey, ArtworkFieldPlacement> = {
  /** The script line under "THIS IS TO CERTIFY THAT". */
  holderName: { x: 49, y: 45.5, width: 52, size: 34, align: "center", font: "script", color: "#14563C" },
  /** The four-line paragraph beneath the name's ornamental rule. */
  body: { x: 49, y: 58.5, width: 50, size: 9.5, align: "center", font: "body", color: "#1F2933", lineHeight: 1.75 },
  /** Under the "CERTIFICATE ID" label in the footer band. */
  certificateId: { x: 35.5, y: 80.5, width: 18, size: 11, align: "center", font: "bodyBold", color: "#1F2933" },
  /** After the "Date of Issue:" label on the bottom rule. */
  issuedAt: { x: 76.5, y: 92, width: 16, size: 10, align: "left", font: "bodyBold", color: "#1F2933" },
  /** Off unless a template positions it — the artwork carries the static verify address. */
  verifyUrl: { x: 50, y: 96, width: 40, size: 8, align: "center", font: "body", color: "#6B7280" },
};

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
  const requested = design.artworkFonts ?? {};
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
  };
}

export interface ArtworkDocumentInput {
  fields: CertificateRenderFields;
  design: CertificateDesign;
  /** Data URI of the approved artwork, already loaded from the private asset directory. */
  artworkSrc: string;
  fonts: ArtworkFonts;
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

/** The whole document in artwork mode: one full-bleed image, and the values on top of it. */
export function buildArtworkDocument(input: ArtworkDocumentInput): ReactElement<DocumentProps> {
  const placements = { ...DEFAULT_ARTWORK_FIELDS, ...(input.design.artworkFields ?? {}) };

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
    h(Page, { size: "A4", orientation: input.design.orientation ?? "landscape", style: { position: "relative" } }, [
      // Full-bleed: the artwork IS the page, not a decoration on it.
      h(Image, {
        key: "artwork",
        src: input.artworkSrc,
        style: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" },
      }),
      buildBody(input, placements.body),
      ...values
        .filter((entry): entry is [ArtworkFieldKey, string] => Boolean(entry[1]))
        .map(([key, value]) => h(Text, { key, style: placementStyle(placements[key], input.fonts) }, value)),
    ]),
  );
}
