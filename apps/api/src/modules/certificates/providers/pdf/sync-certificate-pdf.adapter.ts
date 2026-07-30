// apps/api/src/modules/certificates/providers/pdf/sync-certificate-pdf.adapter.ts
//
// Real CertificatePdfPort adapter (docs/plans/phase-4.md task #4).
//
// Renders a certificate to a real PDF INLINE, using @react-pdf/renderer's server-side
// renderToBuffer(). This is the "Sync" adapter in the ADR-0020 seam sense: PDF
// generation happens in the request cycle. The BullMQ `certificate-gen` worker
// implements the SAME CertificatePdfPort and is bound in its place with zero changes to
// CertificatesService.
//
// LAYOUT — reproduces the approved artwork in `docs/sample certificate/`: a deep-green
// "Certificate of Completion" on white, double-ruled frame with corner brackets, issuer
// wordmark at the head, the holder's name in large italic display type over a ruled
// line, a body paragraph naming the programme and date, and a footer band carrying the
// signature block, the human-typeable Certificate ID, accreditation marks, the verify
// URL and the issue date. A green ribbon runs down the right edge with the seal on it.
//
// FOUR DYNAMIC VALUES fill the artwork's placeholders:
//   "Your Name"          → fields.holderName
//   "DOMAIN NAME"        → fields.programName
//   "STIQ-2026-000001"   → fields.serial          (the unique, typeable Certificate ID)
//   "25 JULY 2026"       → fields.issuedAt        (both the body "from <date>" and the
//                                                  footer "Date of Issue")
//
// SIGNATURE — see `certificate-assets.ts`. The authorised signature is read from a
// PRIVATE server-side directory and embedded as a data URI; it is never exposed over
// HTTP. When no signature file is present the block degrades to the ruled line plus the
// printed signatory name, so issuance never depends on the asset being installed.
//
// FONTS: only the PDF base-14 faces (Times / Helvetica). @react-pdf/renderer would
// happily register a Google-hosted display font, but that turns every render into a
// network fetch that can fail or hang mid-issuance — a certificate must render offline.
// Times-Italic at display size stands in for the artwork's script face.
//
// NO JSX: the document tree is built with React.createElement so the backend tsconfig
// needs no `jsx` compiler option.
//
// SECURITY (port contract): never logs `certUid` or any secret; embeds only public
// values; reads nothing from process.env — all data comes via input.

import { Injectable, Logger } from "@nestjs/common";
import { createElement as h, type ReactElement } from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  Svg,
  Polygon,
  Circle,
  Line,
  Path,
  Font,
  StyleSheet,
  renderToBuffer,
  type DocumentProps,
} from "@react-pdf/renderer";
import type {
  CertificatePdfPort,
  CertificatePdfInput,
  CertificatePdfResult,
  CertificateDesign,
  CertificateRenderFields,
} from "./certificate-pdf-port.interface";
import { DEFAULT_ASSETS, loadCertificateAsset } from "./certificate-assets";

// Palette — the artwork's deep forest green on white, with a gold hairline on the
// ribbon. Templates may override the greens via CertificateDesign directives.
const DEFAULTS = {
  orientation: "landscape" as const,
  borderColor: "#14563C",
  borderWidth: 2.5,
  accentColor: "#14563C", // headings, holder name, seal
  textColor: "#1F2933", // body copy
  backgroundColor: "#FFFFFF",
  orgName: "STIMULIIQ",
};

const SUBTLE_COLOR = "#6B7280";
const GOLD = "#C9A227";
/** Ribbon fill. Kept as a flat colour: react-pdf gradients are unreliable across viewers. */
const RIBBON_FILL = "#14563C";

// Disable hyphenation globally for this renderer. @react-pdf/renderer's default callback
// breaks long words across lines, which turned the body copy's "INNOVATION" into
// "INNOVA-TION" — acceptable in a paragraph of prose, wrong on a certificate. Returning
// the word whole makes the line-breaker wrap on spaces only.
Font.registerHyphenationCallback((word) => [word]);

/** "25 JULY 2026" — upper-case day/month/year, matching the artwork's footer. */
function formatIssuedAt(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" })
    .format(d)
    .toUpperCase();
}

/**
 * The host shown beside "Verify this certificate at" — e.g. "stimuliiq.com/verify".
 * Derived from the full per-certificate `verifyUrl` so the printed instruction always
 * matches the deployment that issued the document, with no separate config to drift.
 * The certificate-specific id is NOT shown here; a reader types the Certificate ID
 * printed alongside it, which is the whole reason that short serial exists.
 */
function verifyHostLabel(verifyUrl: string): string {
  try {
    const url = new URL(verifyUrl);
    return `${url.host.replace(/^www\./, "")}/verify`;
  } catch {
    return "stimuliiq.com/verify";
  }
}

function buildStyles(design: CertificateDesign) {
  const accent = design.accentColor ?? DEFAULTS.accentColor;
  const text = design.textColor ?? DEFAULTS.textColor;
  const border = design.borderColor ?? DEFAULTS.borderColor;
  const borderWidth = design.borderWidth ?? DEFAULTS.borderWidth;
  const background = design.backgroundColor ?? DEFAULTS.backgroundColor;

  return StyleSheet.create({
    page: { backgroundColor: background, padding: 12, fontFamily: "Helvetica" },

    // Double rule: a heavy outer frame with a hairline set just inside it.
    outerFrame: { flex: 1, borderWidth, borderColor: border, borderStyle: "solid", padding: 4 },
    innerFrame: { flex: 1, borderWidth: 0.8, borderColor: border, borderStyle: "solid", flexDirection: "row" },

    // ── Left column ──
    // `space-between` distributes the three groups (head / body / footer) down the full
    // height of the frame. Without it the composition bunches at the top and leaves a
    // third of the page blank under the signature block.
    main: {
      flex: 1,
      paddingTop: 22,
      paddingBottom: 18,
      paddingLeft: 34,
      paddingRight: 18,
      justifyContent: "space-between",
    },

    logoImage: { height: 34, objectFit: "contain", alignSelf: "center" },
    wordmark: {
      fontSize: 30,
      color: DEFAULTS.textColor,
      fontFamily: "Helvetica-Bold",
      letterSpacing: -0.5,
      textAlign: "center",
    },

    title: {
      fontSize: 40,
      color: accent,
      fontFamily: "Times-Bold",
      letterSpacing: 5,
      textAlign: "center",
      marginTop: 18,
    },
    subtitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 6 },
    subtitle: {
      fontSize: 15,
      color: DEFAULTS.textColor,
      fontFamily: "Helvetica-Bold",
      letterSpacing: 4,
      textAlign: "center",
    },
    subtitleRule: { width: 46, height: 0.8, backgroundColor: accent },

    certifyThat: {
      fontSize: 9,
      color: text,
      letterSpacing: 2,
      textAlign: "center",
      marginTop: 14,
    },
    holder: {
      fontSize: 40,
      color: accent,
      fontFamily: "Times-Italic",
      textAlign: "center",
      marginTop: 6,
    },
    holderRule: { height: 0.9, backgroundColor: accent, marginTop: 4, marginHorizontal: 40 },

    body: {
      fontSize: 9.5,
      color: text,
      letterSpacing: 0.6,
      lineHeight: 1.75,
      textAlign: "center",
      marginTop: 14,
      paddingHorizontal: 22,
    },
    bodyStrong: { fontFamily: "Helvetica-Bold", color: accent },

    // ── Footer band: signature | certificate id | accreditation ──
    footerRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 20 },
    footerDivider: { width: 0.8, backgroundColor: "#D8DEE4", alignSelf: "stretch", marginHorizontal: 14 },

    signatureCol: { width: 168, alignItems: "center" },
    signatureImage: { height: 34, objectFit: "contain", marginBottom: 2 },
    /** Reserves the signature's height when no image is installed, so the block never jumps. */
    signatureSpacer: { height: 34 },
    signatureLine: { width: 150, height: 0.9, backgroundColor: DEFAULTS.textColor },
    signatoryName: { fontSize: 10, color: DEFAULTS.textColor, fontFamily: "Helvetica-Bold", marginTop: 5 },
    signatoryDesignation: { fontSize: 8.5, color: text, marginTop: 1 },

    certIdCol: { flex: 1, alignItems: "center" },
    certIdLabel: { fontSize: 9, color: DEFAULTS.textColor, fontFamily: "Helvetica-Bold", letterSpacing: 1.6 },
    certIdValue: {
      fontSize: 13,
      color: accent,
      fontFamily: "Helvetica-Bold",
      letterSpacing: 1,
      marginTop: 4,
      textAlign: "center",
    },
    certIdRule: { width: 128, height: 0.8, backgroundColor: "#D8DEE4", marginTop: 5 },

    badgeCol: { width: 150, alignItems: "center", justifyContent: "flex-end" },
    badgeRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
    badgeImage: { height: 40, objectFit: "contain", marginHorizontal: 4 },
    badgeCaption: { fontSize: 6.5, color: SUBTLE_COLOR, marginTop: 3, textAlign: "center" },

    // ── Bottom strip: verify + issue date ──
    bottomRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 16,
      paddingTop: 8,
      borderTopWidth: 0.8,
      borderTopColor: "#E3E8EC",
      borderTopStyle: "solid",
    },
    bottomText: { fontSize: 8.5, color: DEFAULTS.textColor },
    bottomStrong: { fontFamily: "Helvetica-Bold" },
    bottomValue: { fontFamily: "Helvetica-Bold", color: accent },

    // ── Right ribbon ──
    aside: { width: 128, alignItems: "center" },
    ribbonHeading: {
      fontSize: 10,
      color: "#FFFFFF",
      fontFamily: "Helvetica-Bold",
      letterSpacing: 2.2,
      textAlign: "center",
      lineHeight: 1.5,
    },
  });
}

/** Decorative corner brackets, echoing the artwork's engraved frame. */
function buildCornerBrackets(accent: string): ReactElement {
  const arm = 34;
  const inset = 3;
  const corners = [
    { key: "tl", d: `M${inset},${arm} L${inset},${inset} L${arm},${inset}` },
    { key: "tr", d: `M${100 - arm},${inset} L${100 - inset},${inset} L${100 - inset},${arm}` },
    { key: "bl", d: `M${inset},${100 - arm} L${inset},${100 - inset} L${arm},${100 - inset}` },
    { key: "br", d: `M${100 - arm},${100 - inset} L${100 - inset},${100 - inset} L${100 - inset},${100 - arm}` },
  ];
  return h(
    View,
    { key: "corners", style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } },
    h(
      Svg,
      { viewBox: "0 0 100 100", preserveAspectRatio: "none", style: { width: "100%", height: "100%" } },
      corners.map((c) =>
        h(Path, { key: c.key, d: c.d, stroke: accent, strokeWidth: 0.5, fill: "none" }),
      ),
    ),
  );
}

/**
 * The circular seal carried on the ribbon: concentric rings around the issuer initial,
 * ringed by the "LEARN · UNDERSTAND · TRANSFORM" motto of the artwork's badge.
 */
function buildSeal(orgName: string): ReactElement {
  const initial = (orgName.trim()[0] ?? "S").toUpperCase();
  return h(
    View,
    {
      key: "seal",
      style: { width: 92, height: 92, marginTop: 22, alignItems: "center", justifyContent: "center" },
    },
    h(
      Svg,
      { key: "svg", viewBox: "0 0 92 92", style: { position: "absolute", width: 92, height: 92 } },
      h(Circle, { key: "c0", cx: "46", cy: "46", r: "45", fill: RIBBON_FILL, stroke: "#FFFFFF", strokeWidth: "1.6" }),
      h(Circle, { key: "c1", cx: "46", cy: "46", r: "38", fill: "none", stroke: GOLD, strokeWidth: "0.8" }),
      h(Circle, { key: "c2", cx: "46", cy: "46", r: "30", fill: "none", stroke: "#FFFFFF", strokeWidth: "0.6" }),
    ),
    h(
      View,
      { key: "inner", style: { alignItems: "center" } },
      h(Text, { key: "initial", style: { fontSize: 26, fontFamily: "Times-Bold", color: "#FFFFFF" } }, initial),
      h(
        Text,
        {
          key: "certified",
          style: { fontSize: 5, fontFamily: "Helvetica-Bold", color: GOLD, letterSpacing: 1.2, marginTop: 3 },
        },
        "CERTIFIED",
      ),
    ),
  );
}

/**
 * The right-hand ribbon: a full-height green band ending in a chevron notch, with a
 * gold hairline inset. Drawn as one SVG polygon so it needs no image asset and scales
 * with the page.
 */
function buildRibbon(children: ReactElement[]): ReactElement {
  // H is tuned to the A4-landscape frame's inner height (~552 pt): the band runs from
  // the top edge down to ~90% so the chevron point sits clear of the bottom rule,
  // matching the artwork. Changing the page size means retuning this.
  const W = 104;
  const H = 500;
  const notch = 44;
  return h(
    View,
    { key: "ribbon", style: { width: W, height: H, position: "relative", alignItems: "center" } },
    h(
      Svg,
      { key: "svg", viewBox: `0 0 ${W} ${H}`, style: { position: "absolute", width: W, height: H } },
      h(Polygon, {
        key: "band",
        points: `0,0 ${W},0 ${W},${H - notch} ${W / 2},${H} 0,${H - notch}`,
        fill: RIBBON_FILL,
      }),
      h(Line, { key: "gl", x1: "8", y1: "0", x2: "8", y2: `${H - notch - 4}`, stroke: GOLD, strokeWidth: "0.7" }),
      h(Line, {
        key: "gr",
        x1: `${W - 8}`,
        y1: "0",
        x2: `${W - 8}`,
        y2: `${H - notch - 4}`,
        stroke: GOLD,
        strokeWidth: "0.7",
      }),
    ),
    h(
      View,
      { key: "content", style: { position: "absolute", width: W, height: H, alignItems: "center", paddingTop: 26 } },
      children,
    ),
  );
}

interface ResolvedAssets {
  logo?: string;
  signature?: string;
  isoBadge?: string;
  msmeBadge?: string;
}

function buildDocument(input: CertificatePdfInput, assets: ResolvedAssets): ReactElement<DocumentProps> {
  const design = input.design ?? {};
  const f: CertificateRenderFields = input.fields;
  const styles = buildStyles(design);
  const orientation = design.orientation ?? DEFAULTS.orientation;
  const orgName = design.orgName ?? DEFAULTS.orgName;
  const accent = design.accentColor ?? DEFAULTS.accentColor;
  const issued = formatIssuedAt(f.issuedAt);
  // Per-certificate signatory wins; otherwise the template's issuer-level default.
  const signatoryName = f.signatoryName ?? design.signatoryName ?? "Authorised Signatory";
  const signatoryDesignation = f.signatoryDesignation ?? design.signatoryDesignation;

  // ── Head: issuer wordmark (image when installed, typeset otherwise) ──
  const head = assets.logo
    ? h(Image, { key: "logo", src: assets.logo, style: styles.logoImage })
    : h(Text, { key: "wm", style: styles.wordmark }, orgName);

  // ── Signature block: image over the rule, name and designation beneath ──
  const signatureCol = h(View, { key: "sig", style: styles.signatureCol }, [
    assets.signature
      ? h(Image, { key: "sigimg", src: assets.signature, style: styles.signatureImage })
      : h(View, { key: "sigspace", style: styles.signatureSpacer }),
    h(View, { key: "sline", style: styles.signatureLine }),
    h(Text, { key: "sname", style: styles.signatoryName }, signatoryName),
    signatoryDesignation
      ? h(Text, { key: "sdes", style: styles.signatoryDesignation }, signatoryDesignation)
      : null,
  ]);

  // ── Certificate ID: the short, human-typeable serial a reader enters at /verify ──
  const certIdCol = h(View, { key: "cid", style: styles.certIdCol }, [
    h(Text, { key: "cl", style: styles.certIdLabel }, "CERTIFICATE ID"),
    h(Text, { key: "cv", style: styles.certIdValue }, f.serial),
    h(View, { key: "cr", style: styles.certIdRule }),
  ]);

  // ── Accreditation marks: optional, omitted entirely when not installed ──
  const badges: ReactElement[] = [];
  if (assets.isoBadge) badges.push(h(Image, { key: "iso", src: assets.isoBadge, style: styles.badgeImage }));
  if (assets.msmeBadge) badges.push(h(Image, { key: "msme", src: assets.msmeBadge, style: styles.badgeImage }));
  const badgeCol =
    badges.length > 0
      ? h(View, { key: "badges", style: styles.badgeCol }, [
          h(View, { key: "brow", style: styles.badgeRow }, badges),
          ...(design.footerLines ?? []).map((line, i) =>
            h(Text, { key: `fl-${i}`, style: styles.badgeCaption }, line),
          ),
        ])
      : null;

  // Three groups, spread down the frame by `main`'s space-between: the issuer head, the
  // award itself, and the footer band. Grouping is what makes the vertical rhythm hold
  // for both a one-line and a three-line body paragraph.
  const main = h(View, { key: "main", style: styles.main }, [
    h(View, { key: "g-head" }, [head]),

    h(View, { key: "g-award" }, [
      h(Text, { key: "title", style: styles.title }, "CERTIFICATE"),
      h(View, { key: "subrow", style: styles.subtitleRow }, [
        h(View, { key: "l", style: styles.subtitleRule }),
        h(Text, { key: "sub", style: [styles.subtitle, { marginHorizontal: 10 }] }, "OF COMPLETION"),
        h(View, { key: "r", style: styles.subtitleRule }),
      ]),

      h(Text, { key: "certify", style: styles.certifyThat }, "THIS IS TO CERTIFY THAT"),
      h(Text, { key: "holder", style: styles.holder }, f.holderName),
      h(View, { key: "hrule", style: styles.holderRule }),

      // Programme name and date are emphasised inline, exactly as in the artwork.
      h(Text, { key: "body", style: styles.body }, [
        "HAS SUCCESSFULLY COMPLETED HIS/HER PROGRAM IN ",
        h(Text, { key: "prog", style: styles.bodyStrong }, f.programName.toUpperCase()),
        " ON ",
        h(Text, { key: "date", style: styles.bodyStrong }, issued),
        ". DURING THIS PROGRAM HE/SHE SHOWED DILIGENCE, CONSISTENCY, DETERMINATION, ACTIVE PARTICIPATION, AND INNOVATION THROUGHOUT THE PROGRAM PERIOD.",
      ]),
    ]),

    h(View, { key: "g-foot" }, [
      h(
        View,
        { key: "frow", style: styles.footerRow },
        [
          signatureCol,
          h(View, { key: "d1", style: styles.footerDivider }),
          certIdCol,
          badgeCol ? h(View, { key: "d2", style: styles.footerDivider }) : null,
          badgeCol,
        ].filter(Boolean) as ReactElement[],
      ),

      h(View, { key: "brow", style: styles.bottomRow }, [
        h(Text, { key: "verify", style: styles.bottomText }, [
          h(Text, { key: "vl", style: styles.bottomStrong }, "Verify this certificate at:  "),
          h(Text, { key: "vv", style: styles.bottomValue }, verifyHostLabel(f.verifyUrl)),
        ]),
        h(Text, { key: "issued", style: styles.bottomText }, [
          h(Text, { key: "il", style: styles.bottomStrong }, "Date of Issue:  "),
          h(Text, { key: "iv", style: styles.bottomValue }, issued),
        ]),
      ]),
    ]),
  ]);

  const aside = h(View, { key: "aside", style: styles.aside }, [
    buildRibbon([
      h(Text, { key: "rh", style: styles.ribbonHeading }, "COURSE\nCERTIFICATE"),
      buildSeal(orgName),
    ]),
  ]);

  return h(
    Document,
    { title: "Certificate of Completion", author: orgName },
    h(
      Page,
      { size: "A4", orientation, style: styles.page },
      h(View, { style: styles.outerFrame }, [
        buildCornerBrackets(accent),
        h(View, { key: "inner", style: styles.innerFrame }, [main, aside]),
      ]),
    ),
  );
}

@Injectable()
export class SyncCertificatePdfAdapter implements CertificatePdfPort {
  private readonly logger = new Logger(SyncCertificatePdfAdapter.name);

  async render(input: CertificatePdfInput): Promise<CertificatePdfResult> {
    // Safe to log holder + program; certUid is NEVER logged (port SECURITY contract).
    this.logger.debug(
      `render() holderName="${input.fields.holderName}" program="${input.fields.programName}"`,
    );

    const design = input.design ?? {};
    // Every asset is optional; a missing file resolves to undefined and the layout
    // falls back (see certificate-assets.ts). Loaded in parallel — they are memoised
    // after the first render, so this is a no-op on subsequent certificates.
    const [logo, signature, isoBadge, msmeBadge] = await Promise.all([
      loadCertificateAsset(design.logoFileName ?? DEFAULT_ASSETS.logo),
      loadCertificateAsset(design.signatureFileName ?? DEFAULT_ASSETS.signature),
      loadCertificateAsset(design.isoBadgeFileName ?? DEFAULT_ASSETS.isoBadge),
      loadCertificateAsset(design.msmeBadgeFileName ?? DEFAULT_ASSETS.msmeBadge),
    ]);

    const bytes = await renderToBuffer(buildDocument(input, { logo, signature, isoBadge, msmeBadge }));

    return { bytes, contentType: "application/pdf" };
  }
}
