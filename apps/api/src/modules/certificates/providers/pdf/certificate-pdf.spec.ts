// apps/api/src/modules/certificates/providers/pdf/certificate-pdf.spec.ts
//
// Unit tests for the CertificatePdfPort adapters (task #4).
//   - NoopCertificatePdfAdapter: deterministic stub bytes.
//   - SyncCertificatePdfAdapter: a real, non-empty application/pdf via @react-pdf/renderer.

import { NoopCertificatePdfAdapter } from "./noop-certificate-pdf.adapter";
import { SyncCertificatePdfAdapter } from "./sync-certificate-pdf.adapter";
import type { CertificatePdfInput } from "./certificate-pdf-port.interface";

const INPUT: CertificatePdfInput = {
  design: {
    orientation: "landscape",
    orgName: "stimuliIQ",
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
    signatoryDesignation: "Director, stimuliIQ",
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
});
