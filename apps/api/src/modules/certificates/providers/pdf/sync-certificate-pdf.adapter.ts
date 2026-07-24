// apps/api/src/modules/certificates/providers/pdf/sync-certificate-pdf.adapter.ts
//
// Real CertificatePdfPort adapter (docs/plans/phase-4.md task #4).
//
// Renders a certificate to a real PDF INLINE, using @react-pdf/renderer's
// server-side renderToBuffer(). This is the "Sync" adapter in the ADR-0020 seam
// sense: PDF generation happens in the request cycle. The BullMQ `certificate-gen`
// worker implements the SAME CertificatePdfPort and is bound in its place with zero
// changes to CertificatesService.
//
// LAYOUT (reworked): a two-column "course certificate" composition — the issuer
// wordmark, date, holder, programme and signature run down the LEFT; a vertical
// ribbon carrying the certificate seal runs down the RIGHT; the public verify URL
// sits under the ribbon. This replaces the earlier centred, stacked layout.
//
// NO JSX: the document tree is built with React.createElement so the backend
// tsconfig needs no `jsx` compiler option. @react-pdf/renderer requires `react`
// as a peer dependency (installed for this adapter).
//
// SECURITY (port contract): never logs `certUid` or any secret; embeds the public
// `verifyUrl` only; reads nothing from process.env — all data comes via input.

import { Injectable, Logger } from "@nestjs/common";
import { createElement as h, type ReactElement } from "react";
import {
  Document,
  Page,
  View,
  Text,
  Svg,
  Polygon,
  Circle,
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

// Design defaults (applied when a template omits a directive).
//
// Clean, minimal, professional — a monochrome treatment matching the apps'
// black & white identity. Templates can still override any of these via the
// CertificateDesign directives.
const DEFAULTS = {
  orientation: "landscape" as const,
  borderColor: "#d9dde3", // hairline grey frame
  borderWidth: 1,
  accentColor: "#16181d", // near-black ink — headings, name, rules
  textColor: "#5b6472", // muted grey — secondary text
  backgroundColor: "#ffffff",
  orgName: "stimuliiq",
};

/** Very-subtle tertiary tone (labels, footer meta). Derived locally, not a template directive. */
const SUBTLE_COLOR = "#8b94a3";
/** Ribbon panel fill — a light neutral so the seal reads against it in mono printing. */
const RIBBON_FILL = "#eef1f5";

function formatIssuedAt(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

function buildStyles(design: CertificateDesign) {
  const accent = design.accentColor ?? DEFAULTS.accentColor;
  const text = design.textColor ?? DEFAULTS.textColor;
  const border = design.borderColor ?? DEFAULTS.borderColor;
  const borderWidth = design.borderWidth ?? DEFAULTS.borderWidth;
  const background = design.backgroundColor ?? DEFAULTS.backgroundColor;

  return StyleSheet.create({
    page: {
      backgroundColor: background,
      padding: 24,
      fontFamily: "Helvetica",
    },
    frame: {
      flex: 1,
      borderWidth,
      borderColor: border,
      borderStyle: "solid",
      flexDirection: "row",
    },

    // ── Left column: the certificate's substance ──
    main: {
      flex: 1,
      paddingVertical: 40,
      paddingLeft: 48,
      paddingRight: 34,
      justifyContent: "space-between",
    },
    wordmark: {
      fontSize: 40,
      color: accent,
      fontFamily: "Helvetica-Bold",
      letterSpacing: -1,
    },
    tagline: { fontSize: 8, color: SUBTLE_COLOR, marginTop: 4, letterSpacing: 1.5 },
    date: { fontSize: 9, color: text, marginTop: 26 },

    holder: {
      fontSize: 22,
      color: accent,
      fontFamily: "Helvetica-Bold",
      letterSpacing: 1,
      textTransform: "uppercase",
      marginTop: 14,
    },
    completed: { fontSize: 9, color: text, marginTop: 12 },
    program: {
      fontSize: 15,
      color: accent,
      fontFamily: "Helvetica-Bold",
      marginTop: 10,
      maxWidth: 380,
    },
    authorised: { fontSize: 8, color: SUBTLE_COLOR, marginTop: 10, maxWidth: 380, lineHeight: 1.5 },

    // ── Signature block ──
    signature: {
      fontSize: 19,
      color: accent,
      fontFamily: "Helvetica-BoldOblique",
      marginBottom: 4,
    },
    signatureLine: { width: 170, height: 0.8, backgroundColor: border, marginBottom: 5 },
    signatoryName: { fontSize: 8, color: text },
    signatoryDesignation: { fontSize: 8, color: SUBTLE_COLOR, marginTop: 1 },
    footerLine: { fontSize: 7, color: SUBTLE_COLOR, marginTop: 1 },

    // ── Right column: ribbon + seal + verify ──
    aside: {
      width: 178,
      alignItems: "center",
      paddingTop: 0,
      paddingBottom: 26,
      paddingHorizontal: 12,
      justifyContent: "space-between",
    },
    ribbonWrap: { alignItems: "center", width: "100%" },
    ribbonHeading: {
      fontSize: 11,
      color: accent,
      fontFamily: "Helvetica-Bold",
      letterSpacing: 2,
      textAlign: "center",
      textTransform: "uppercase",
    },
    sealCaption: {
      fontSize: 6,
      color: accent,
      fontFamily: "Helvetica-Bold",
      letterSpacing: 1,
      textTransform: "uppercase",
      marginTop: 6,
    },
    verifyBlock: { alignItems: "center", width: "100%" },
    verifyLabel: {
      fontSize: 7,
      color: SUBTLE_COLOR,
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    serialLabel: {
      fontSize: 7,
      color: SUBTLE_COLOR,
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    serialValue: {
      fontSize: 9,
      color: accent,
      fontFamily: "Helvetica-Bold",
      letterSpacing: 1,
      marginTop: 2,
      marginBottom: 6,
      textAlign: "center",
    },
    verifyUrl: { fontSize: 7, color: text, marginTop: 3, textAlign: "center" },
    verifyNote: { fontSize: 6, color: SUBTLE_COLOR, marginTop: 6, textAlign: "center", lineHeight: 1.4 },
  });
}

/**
 * The vertical ribbon behind the seal: a rectangle ending in a downward chevron,
 * echoing a physical certificate's hanging ribbon. Drawn as one SVG polygon so it
 * scales cleanly and needs no image asset.
 */
function buildRibbon(children: ReactElement[]): ReactElement {
  return h(
    View,
    { key: "ribbon", style: { width: 154, alignItems: "center" } },
    h(
      View,
      { key: "shape", style: { position: "relative", width: 154, height: 300 } },
      h(
        Svg,
        { key: "svg", viewBox: "0 0 154 300", style: { position: "absolute", width: 154, height: 300 } },
        h(Polygon, {
          key: "poly",
          // Rectangle down to y=262, then a chevron notch to the point at y=300.
          points: "0,0 154,0 154,262 77,300 0,262",
          fill: RIBBON_FILL,
        }),
      ),
      h(
        View,
        {
          key: "content",
          style: { position: "absolute", width: 154, height: 300, alignItems: "center", paddingTop: 26 },
        },
        children,
      ),
    ),
  );
}

/** The circular seal — concentric rings around the issuer's initial. */
function buildSeal(orgName: string, accent: string): ReactElement {
  const initial = (orgName.trim()[0] ?? "S").toUpperCase();
  return h(
    View,
    { key: "seal", style: { width: 96, height: 96, marginTop: 24, alignItems: "center", justifyContent: "center" } },
    h(
      Svg,
      { key: "svg", viewBox: "0 0 96 96", style: { position: "absolute", width: 96, height: 96 } },
      h(Circle, { key: "c1", cx: "48", cy: "48", r: "46", fill: "#ffffff", stroke: accent, strokeWidth: "1.2" }),
      h(Circle, { key: "c2", cx: "48", cy: "48", r: "39", fill: "none", stroke: accent, strokeWidth: "0.6" }),
      h(Circle, { key: "c3", cx: "48", cy: "48", r: "31", fill: "none", stroke: accent, strokeWidth: "0.4" }),
    ),
    h(
      View,
      { key: "inner", style: { alignItems: "center" } },
      h(
        Text,
        { key: "initial", style: { fontSize: 30, fontFamily: "Helvetica-Bold", color: accent } },
        initial,
      ),
      h(
        Text,
        {
          key: "verified",
          style: { fontSize: 5, fontFamily: "Helvetica-Bold", color: accent, letterSpacing: 1, marginTop: 2 },
        },
        "VERIFIED",
      ),
    ),
  );
}

function buildDocument(input: CertificatePdfInput): ReactElement<DocumentProps> {
  const design = input.design ?? {};
  const f: CertificateRenderFields = input.fields;
  const styles = buildStyles(design);
  const orientation = design.orientation ?? DEFAULTS.orientation;
  const orgName = design.orgName ?? DEFAULTS.orgName;
  const accent = design.accentColor ?? DEFAULTS.accentColor;
  const signatory = f.signatoryName ?? "Authorised Signatory";

  // ── Left column ──
  const main = h(View, { key: "main", style: styles.main }, [
    h(View, { key: "head" }, [
      h(Text, { key: "wm", style: styles.wordmark }, orgName),
      design.tagline ? h(Text, { key: "tag", style: styles.tagline }, design.tagline) : null,
    ]),

    h(View, { key: "body" }, [
      h(Text, { key: "date", style: styles.date }, formatIssuedAt(f.issuedAt)),
      h(Text, { key: "holder", style: styles.holder }, f.holderName),
      h(Text, { key: "done", style: styles.completed }, "has successfully completed"),
      h(Text, { key: "program", style: styles.program }, f.programName),
      h(
        Text,
        { key: "auth", style: styles.authorised },
        `an internship-training programme authorised and offered by ${orgName}. ` +
          "The certificate confirms this learner's identity and their completion of the programme.",
      ),
    ]),

    h(View, { key: "sign" }, [
      // A handwritten-feel signature: the signatory's name set in an oblique face,
      // above the ruled line — no image asset required.
      h(Text, { key: "sig", style: styles.signature }, signatory),
      h(View, { key: "sline", style: styles.signatureLine }),
      h(Text, { key: "sname", style: styles.signatoryName }, signatory),
      f.signatoryDesignation
        ? h(Text, { key: "sdes", style: styles.signatoryDesignation }, f.signatoryDesignation)
        : null,
      ...(design.footerLines ?? []).map((line, i) => h(Text, { key: `fl-${i}`, style: styles.footerLine }, line)),
    ]),
  ]);

  // ── Right column: ribbon (heading + seal) over the verify block ──
  const aside = h(View, { key: "aside", style: styles.aside }, [
    buildRibbon([
      h(Text, { key: "rh", style: styles.ribbonHeading }, "Course\nCertificate"),
      buildSeal(orgName, accent),
      h(Text, { key: "cap", style: styles.sealCaption }, "Certificate of Completion"),
    ]),
    h(View, { key: "verify", style: styles.verifyBlock }, [
      // Short, human-typeable ID first — this is what a reader types into /verify.
      h(Text, { key: "sl", style: styles.serialLabel }, "Certificate ID"),
      h(Text, { key: "sv", style: styles.serialValue }, f.serial),
      h(Text, { key: "vl", style: styles.verifyLabel }, "Verify at"),
      h(Text, { key: "vu", style: styles.verifyUrl }, f.verifyUrl),
      h(
        Text,
        { key: "vn", style: styles.verifyNote },
        `${orgName} has confirmed the identity of this individual and their participation in the programme.`,
      ),
    ]),
  ]);

  return h(
    Document,
    { title: "Certificate", author: orgName },
    h(Page, { size: "A4", orientation, style: styles.page }, h(View, { style: styles.frame }, [main, aside])),
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

    const bytes = await renderToBuffer(buildDocument(input));

    return { bytes, contentType: "application/pdf" };
  }
}
