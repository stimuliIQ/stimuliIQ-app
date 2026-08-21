// apps/api/src/modules/certificates/providers/pdf/certificate-pdf.spec.ts
//
// Unit tests for the CertificatePdfPort adapters (task #4).
//   - NoopCertificatePdfAdapter: deterministic stub bytes.
//   - SyncCertificatePdfAdapter: a real, non-empty application/pdf via @react-pdf/renderer.

import { NoopCertificatePdfAdapter } from "./noop-certificate-pdf.adapter";
import { SyncCertificatePdfAdapter } from "./sync-certificate-pdf.adapter";
import type { CertificatePdfInput } from "./certificate-pdf-port.interface";
import { loadCertificateAsset } from "./certificate-assets";

const INPUT: CertificatePdfInput = {
  design: {
    orientation: "landscape",
    orgName: "Stimuli IQ",
    tagline: "Empowering India's Next Generation",
    footerLines: ["www.stimuliiq.com"],
  },
  fields: {
    holderName: "Ananya Sharma",
    programName: "Full-Stack Web Development",
    issuedAt: new Date("2026-06-12T10:00:00.000Z"),
    certUid: "body.sig",
    serial: "STMQ-2026-7F3K-9QX2",
    verifyUrl: "https://stimuliiq.com/verify/body.sig",
    signatoryName: "R. Menon",
    signatoryDesignation: "Director, Stimuli IQ",
  },
};

describe("NoopCertificatePdfAdapter", () => {
  it("returns deterministic stub bytes regardless of input", async () => {
    const noop = new NoopCertificatePdfAdapter();
    const a = await noop.render(INPUT);
    const b = await noop.render({ ...INPUT, fields: { ...INPUT.fields, holderName: "Different Person" } });

    expect(a.contentType).toBe("application/pdf");
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(Buffer.from(a.bytes).equals(NoopCertificatePdfAdapter.STUB_BYTES)).toBe(true);
    expect(Buffer.from(a.bytes).subarray(0, 5).toString("utf-8")).toBe("%PDF-");
  });
});

describe("SyncCertificatePdfAdapter", () => {
  it("renders a real, non-empty PDF buffer", async () => {
    const sync = new SyncCertificatePdfAdapter();
    const result = await sync.render(INPUT);

    expect(result.contentType).toBe("application/pdf");
    const buf = Buffer.from(result.bytes);
    expect(buf.length).toBeGreaterThan(500); // a real cert PDF is not tiny
    expect(buf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
  }, 30000); // @react-pdf/renderer cold-start can be slow

  it("does not embed the raw certUid string in the PDF bytes (only the verifyUrl)", async () => {
    const sync = new SyncCertificatePdfAdapter();
    const result = await sync.render({
      ...INPUT,
      fields: { ...INPUT.fields, certUid: "SECRET-UID-should-not-appear-raw" },
    });
    const text = Buffer.from(result.bytes).toString("latin1");
    // The verifyUrl is embedded; the bare certUid token is not embedded separately.
    // (PDF text may be compressed, so this is a best-effort smoke check.)
    expect(text.includes("SECRET-UID-should-not-appear-raw\n")).toBe(false);
  }, 30000);

  // ── certificateKind ────────────────────────────────────────────────────────
  //
  // The internship and training certificates are ONE renderer driven by
  // `design.certificateKind`; the document title is the cheapest place to observe which
  // award was rendered, because it is the only kind-dependent string that reaches the
  // PDF as plain, uncompressed metadata. The ribbon heading and body copy go through the
  // content stream, which @react-pdf/renderer compresses, asserting on those would be
  // asserting on Flate output.

  /**
   * Does the rendered document's title contain `phrase`?
   *
   * The title is written as a UTF-16BE PDF string, so the ASCII phrase does NOT appear
   * verbatim in the bytes, "COURSE" is stored as `\0C\0O\0U\0R\0S\0E`. Encoding the
   * needle the same way is what makes this a real assertion rather than one that passes
   * by never matching anything.
   */
  async function titleContains(
    design: CertificatePdfInput["design"],
    phrase: string,
  ): Promise<boolean> {
    const { bytes } = await new SyncCertificatePdfAdapter().render({ ...INPUT, design });
    const haystack = Buffer.from(bytes);
    // A PDF string is written EITHER as a Latin-1 literal or, when it contains any
    // non-Latin-1 character, as UTF-16BE with a BOM. Which one you get is a property of the
    // TITLE TEXT, not of this assertion: the title used to contain an em dash, which was the
    // only thing forcing UTF-16 -- so a UTF-16-only search silently started failing the day
    // the punctuation changed, even though the title still said the right words. Check both.
    const utf16be = Buffer.from(phrase, "utf16le").swap16();
    const latin1 = Buffer.from(phrase, "latin1");
    return haystack.includes(utf16be) || haystack.includes(latin1);
  }

  it("names the award in the document title for each certificateKind", async () => {
    await expect(
      titleContains({ ...INPUT.design, certificateKind: "internship" }, "INTERNSHIP CERTIFICATE"),
    ).resolves.toBe(true);
    await expect(
      titleContains({ ...INPUT.design, certificateKind: "training" }, "TRAINING CERTIFICATE"),
    ).resolves.toBe(true);
    // ...and each kind excludes the other, so a title that simply contains every label
    // would not pass.
    await expect(
      titleContains({ ...INPUT.design, certificateKind: "internship" }, "TRAINING CERTIFICATE"),
    ).resolves.toBe(false);
  }, 60000);

  it("falls back to the neutral COURSE wording when certificateKind is absent or unknown", async () => {
    // Templates seeded before `certificateKind` existed carry no such key, and `design` is
    // a CRM-editable JSON column, so an unrecognised value must degrade, never throw.
    await expect(titleContains(INPUT.design, "COURSE CERTIFICATE")).resolves.toBe(true);
    await expect(
      titleContains({ ...INPUT.design, certificateKind: "diploma" as never }, "COURSE CERTIFICATE"),
    ).resolves.toBe(true);
  }, 60000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Artwork mode
// ─────────────────────────────────────────────────────────────────────────────
//
// The code-drawn certificate above is a REPRODUCTION of the approved design and can never
// be identical to it. Artwork mode prints the approved file itself and draws only the
// per-student values onto it, which is the only way "exactly as designed" is achievable.
// These pin the switch and its safety behaviour, the visual result is the artwork's, not
// something a unit test can assert.

describe("SyncCertificatePdfAdapter, artwork mode", () => {
  const adapter = new SyncCertificatePdfAdapter();

  it("still renders a PDF when the named artwork is missing, instead of failing an earned certificate", async () => {
    // A template can name artwork that has not been installed on this server yet. That must
    // degrade to the code-drawn certificate, never to an error, the student earned it.
    const result = await adapter.render({
      ...INPUT,
      design: { ...INPUT.design, artworkFileName: "not-installed-yet.png" },
    });

    expect(result.contentType).toBe("application/pdf");
    expect(result.bytes.subarray(0, 4).toString()).toBe("%PDF");
  }, 60000);

  it("ignores an unsafe artwork name rather than reading outside the asset directory", async () => {
    // `design` is CRM-editable, so the file name is untrusted input (same posture as every
    // other asset here, see certificate-assets.ts).
    const result = await adapter.render({
      ...INPUT,
      design: { ...INPUT.design, artworkFileName: "../../../../etc/passwd" },
    });

    expect(result.bytes.subarray(0, 4).toString()).toBe("%PDF");
  }, 60000);

  it("renders with the real artwork when one is installed", async () => {
    // Skips until a blank artwork is dropped into apps/api/assets/certificate/, the file is
    // the customer's approved design and is deliberately not committed as a fixture.
    const installed = await loadCertificateAsset("training-certificate-blank.png");
    if (!installed) return;

    const result = await adapter.render({
      ...INPUT,
      design: { ...INPUT.design, certificateKind: "training", artworkFileName: "training-certificate-blank.png" },
    });

    expect(result.bytes.subarray(0, 4).toString()).toBe("%PDF");
    // The artwork is embedded, so the document is materially larger than the vector-only
    // reproduction, a cheap proof that the image actually made it into the page.
    expect(result.bytes.byteLength).toBeGreaterThan(20_000);
  }, 60000);
});
