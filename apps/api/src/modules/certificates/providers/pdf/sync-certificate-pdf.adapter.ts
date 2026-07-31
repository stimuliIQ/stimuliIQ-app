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
// TWO AWARDS, ONE LAYOUT. The approved set is two artworks — `internship-certificate.png`
// and `training-certificate.png` — which differ ONLY in the ribbon heading and the noun
// used twice in the body sentence. They are therefore ONE renderer driven by
// `design.certificateKind`, not two: duplicating the layout would guarantee the two
// drift apart the first time the footer changes. A student may be awarded both; each is
// a separate certificate issued against the matching template.
//
// FOUR DYNAMIC VALUES fill the artwork's placeholders:
//   "Your Name"          → fields.holderName
//   "DOMAIN"             → fields.programName
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
  CertificateKind,
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
  // Display spelling is two words — the artwork's wordmark reads "STIMULI IQ".
  orgName: "STIMULI IQ",
};

/**
 * Per-award copy. The two approved artworks differ ONLY in these three strings, so this
 * table IS the difference between an internship certificate and a training one.
 *
 * `ribbon` is split across two lines by hand rather than left to the line-breaker: the
 * ribbon is a fixed RIBBON_W wide and "INTERNSHIP CERTIFICATE" wraps differently from
 * "TRAINING CERTIFICATE" if you let it choose.
 *
 * `noun` appears TWICE in the body sentence ("...COMPLETED HIS/HER <noun> IN ..." and
 * "...THROUGHOUT THE <noun> PERIOD"), which is exactly how the artwork reads.
 */
const KIND_COPY: Record<CertificateKind, { ribbon: string; noun: string }> = {
  internship: { ribbon: "INTERNSHIP\nCERTIFICATE", noun: "INTERNSHIP" },
  training: { ribbon: "TRAINING\nCERTIFICATE", noun: "TRAINING" },
  // Pre-existing default. Templates seeded before `certificateKind` existed have no such
  // key, and must keep rendering the neutral wording they were approved with.
  course: { ribbon: "COURSE\nCERTIFICATE", noun: "PROGRAM" },
};

/** Narrow the CRM-editable `design.certificateKind` to a kind we have copy for. */
function resolveKind(candidate: unknown): CertificateKind {
  return candidate === "internship" || candidate === "training" ? candidate : "course";
}

const SUBTLE_COLOR = "#6B7280";
const GOLD = "#C9A227";
/** Ribbon fill. Kept as a flat colour: react-pdf gradients are unreliable across viewers. */
const RIBBON_FILL = "#14563C";
/** Ribbon band width in pt. Wide enough to carry the 100 pt seal with a margin either side. */
const RIBBON_W = 118;

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

    // Type sizes are set as a fraction of the artwork's own proportions, not picked by
    // eye: on the approved specimen "CERTIFICATE" spans ~51% of the page width and the
    // body copy sets at ~2.1% of page height. Undersizing them is what leaves a band of
    // dead white between the paragraph and the footer, so these are load-bearing.
    title: {
      fontSize: 48,
      color: accent,
      fontFamily: "Times-Bold",
      letterSpacing: 6,
      textAlign: "center",
      marginTop: 16,
    },
    subtitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 7 },
    subtitle: {
      fontSize: 16,
      color: DEFAULTS.textColor,
      fontFamily: "Helvetica-Bold",
      letterSpacing: 4,
      textAlign: "center",
    },
    subtitleRule: { width: 46, height: 0.8, backgroundColor: accent },

    certifyThat: {
      fontSize: 10,
      color: text,
      letterSpacing: 2,
      textAlign: "center",
      marginTop: 16,
    },
    holder: {
      fontSize: 42,
      color: accent,
      fontFamily: "Times-Italic",
      textAlign: "center",
      marginTop: 8,
    },
    holderRule: { height: 0.9, backgroundColor: accent, marginTop: 6, marginHorizontal: 40 },

    body: {
      fontSize: 11.5,
      color: text,
      letterSpacing: 0.5,
      lineHeight: 1.9,
      textAlign: "center",
      marginTop: 16,
      paddingHorizontal: 18,
    },
    bodyStrong: { fontFamily: "Helvetica-Bold", color: accent },

    // ── Footer band: signature | certificate id | accreditation ──
    footerRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 20 },
    footerDivider: { width: 0.8, backgroundColor: "#D8DEE4", alignSelf: "stretch", marginHorizontal: 14 },

    signatureCol: { width: 168, alignItems: "center" },
    signatureImage: { height: 40, objectFit: "contain", marginBottom: 2 },
    /** Reserves the signature's height when no image is installed, so the block never jumps. */
    signatureSpacer: { height: 40 },
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

    badgeCol: { width: 176, alignItems: "center", justifyContent: "flex-end" },
    badgeRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
    // The two marks need DIFFERENT heights, not one shared `badgeImage`: the ISO seal is
    // square and the MSME lockup is ~2.5:1, so matching their heights would run the MSME
    // block off the end of the column. Matching their optical weight means shrinking it.
    isoBadgeImage: { height: 42, width: 42, objectFit: "contain", marginHorizontal: 5 },
    msmeBadgeImage: { height: 34, width: 86, objectFit: "contain", marginHorizontal: 5 },
    badgeCaption: { fontSize: 6.5, color: SUBTLE_COLOR, marginTop: 4, textAlign: "center" },

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
    // Width tracks RIBBON_W below plus a hairline of white, so the band sits against the
    // frame's right rule the way it does on the artwork rather than floating inside it.
    aside: { width: RIBBON_W + 6, alignItems: "center" },
    ribbonHeading: {
      fontSize: 9.5,
      color: "#FFFFFF",
      fontFamily: "Helvetica-Bold",
      letterSpacing: 1.6,
      textAlign: "center",
      lineHeight: 1.5,
    },
  });
}

/**
 * Decorative corner brackets, echoing the artwork's engraved frame.
 *
 * The SVG is stretched over the frame with `preserveAspectRatio="none"`, so one arm
 * length in the 0–100 viewBox does NOT give one arm length on the page — a single `arm`
 * value drew a horizontal arm ~1.8× the length of the vertical one on A4 landscape, and
 * at 34 the brackets ran a third of the way down the certificate. ARM_X / ARM_Y are the
 * viewBox percentages that come out roughly square at the page's aspect ratio.
 */
function buildCornerBrackets(accent: string): ReactElement {
  const ARM_X = 7;
  const ARM_Y = 10;
  const inset = 2.5;
  const corners = [
    { key: "tl", d: `M${inset},${ARM_Y} L${inset},${inset} L${ARM_X},${inset}` },
    { key: "tr", d: `M${100 - ARM_X},${inset} L${100 - inset},${inset} L${100 - inset},${ARM_Y}` },
    { key: "bl", d: `M${inset},${100 - ARM_Y} L${inset},${100 - inset} L${ARM_X},${100 - inset}` },
    {
      key: "br",
      d: `M${100 - ARM_X},${100 - inset} L${100 - inset},${100 - inset} L${100 - inset},${100 - ARM_Y}`,
    },
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
 * The circular seal carried on the ribbon: a gold-ringed disc bearing the issuer name
 * over "CERTIFIED", matching the badge on the approved artwork.
 *
 * TYPESET FLAT, NOT ON AN ARC. The artwork sets the issuer name around the top of the
 * ring and the motto around the bottom. react-pdf's SVG subset has no <textPath>, and
 * hand-rotating one <Text> per glyph to fake an arc is a lot of machinery to maintain for
 * a 100 pt disc — so the name is set straight across the seal instead. The badge reads
 * the same at print size; it is the ring, the gold and the wordmark that carry it.
 */
function buildSeal(orgName: string): ReactElement {
  const D = 100;
  const r = D / 2;
  return h(
    View,
    {
      key: "seal",
      style: { width: D, height: D, marginTop: 20, alignItems: "center", justifyContent: "center" },
    },
    h(
      Svg,
      { key: "svg", viewBox: `0 0 ${D} ${D}`, style: { position: "absolute", width: D, height: D } },
      h(Circle, { key: "c0", cx: r, cy: r, r: r - 1, fill: RIBBON_FILL, stroke: GOLD, strokeWidth: "2.4" }),
      h(Circle, { key: "c1", cx: r, cy: r, r: r - 6, fill: "none", stroke: "#FFFFFF", strokeWidth: "1" }),
      h(Circle, { key: "c2", cx: r, cy: r, r: r - 13, fill: "none", stroke: GOLD, strokeWidth: "0.7" }),
    ),
    h(
      View,
      { key: "inner", style: { alignItems: "center", paddingHorizontal: 14 } },
      h(
        Text,
        {
          key: "org",
          style: {
            fontSize: 9,
            fontFamily: "Helvetica-Bold",
            color: "#FFFFFF",
            letterSpacing: 0.6,
            textAlign: "center",
          },
        },
        orgName.toUpperCase(),
      ),
      h(View, { key: "rule", style: { width: 40, height: 0.8, backgroundColor: GOLD, marginVertical: 4 } }),
      h(
        Text,
        {
          key: "certified",
          style: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: GOLD, letterSpacing: 1.4 },
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
  const W = RIBBON_W;
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
  const kind = KIND_COPY[resolveKind(design.certificateKind)];
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
  if (assets.isoBadge) badges.push(h(Image, { key: "iso", src: assets.isoBadge, style: styles.isoBadgeImage }));
  if (assets.msmeBadge)
    badges.push(h(Image, { key: "msme", src: assets.msmeBadge, style: styles.msmeBadgeImage }));
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

    // flexGrow + centre: the award is SHORTER than the band left between the wordmark and
    // the footer, and `space-between` alone dumps every point of that slack in one place —
    // which showed up as a hand's width of dead white directly above the signature block.
    // Centring splits the slack above and below, as the approved artwork does.
    h(View, { key: "g-award", style: { flexGrow: 1, justifyContent: "center" } }, [
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
      // The full stop after the date is INSIDE the emphasised run, and the run that
      // follows begins with a space. Leaving a bare "." to start the next run made the
      // layout engine treat "2026" + "." as one word split across a run boundary and
      // break it with a hyphen — the body read "...31 JULY 2026-" / ". DURING THIS...".
      // Every run boundary here now falls on whitespace, which cannot be hyphenated.
      h(Text, { key: "body", style: styles.body }, [
        `HAS SUCCESSFULLY COMPLETED HIS/HER ${kind.noun} IN `,
        h(Text, { key: "prog", style: styles.bodyStrong }, f.programName.toUpperCase()),
        " ON ",
        h(Text, { key: "date", style: styles.bodyStrong }, `${issued}.`),
        " DURING THIS PROGRAM HE/SHE SHOWED DILIGENCE, CONSISTENCY, DETERMINATION, " +
          `ACTIVE PARTICIPATION, AND INNOVATION THROUGHOUT THE ${kind.noun} PERIOD.`,
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
      h(Text, { key: "rh", style: styles.ribbonHeading }, kind.ribbon),
      buildSeal(orgName),
    ]),
  ]);

  return h(
    Document,
    // Title shows in the PDF viewer's tab/title bar, so it names the award. Author is the
    // issuer; no other metadata is set (see the port's SECURITY contract — certUid must
    // not leak into document properties).
    { title: `${kind.ribbon.replace("\n", " ")} — Certificate of Completion`, author: orgName },
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
