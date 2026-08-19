// apps/api/src/modules/careers/careers-notification.service.spec.ts
//
// Unit tests for CareersNotificationService (docs/specs/careers-hiring.md, ADR-0066).
//
// What these actually guard is the CONTENT of mail going to people outside the company:
// that reviewer-authored text is escaped before it lands in an HTML email, that a failed
// send never throws into a decision that has already been recorded, and that the offer
// carries its attachment.

import { CareersNotificationService } from "./careers-notification.service";
import type { MailProvider } from "../notifications/providers/mail/mail-provider.interface";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

const CANDIDATE = { name: "Priya Sharma", email: "priya@example.com", role: "Senior Counsellor" };

function lastSend(mail: Mocked<MailProvider>) {
  return mail.send.mock.calls[mail.send.mock.calls.length - 1]![0];
}

describe("CareersNotificationService", () => {
  let mail: Mocked<MailProvider>;
  let service: CareersNotificationService;

  beforeEach(() => {
    mail = {
      send: jest.fn().mockResolvedValue({ providerMessageId: "msg-1" }),
      verifyWebhookSignature: jest.fn(),
    } as unknown as Mocked<MailProvider>;
    service = new CareersNotificationService(mail as unknown as MailProvider);
  });

  describe("acknowledgement", () => {
    it("names the role in the subject so it is recognisable in a crowded inbox", async () => {
      await service.sendAcknowledgement(CANDIDATE);
      expect(lastSend(mail).subject).toContain("Senior Counsellor");
    });

    it("promises no outcome and no date we cannot keep", async () => {
      await service.sendAcknowledgement(CANDIDATE);
      const html = lastSend(mail).html as string;
      expect(html).not.toMatch(/within \d+ (business )?days/i);
      expect(html).not.toMatch(/shortlist/i);
    });
  });

  describe("next round", () => {
    it("carries the reviewer's round name and details into the email", async () => {
      await service.sendNextRound(CANDIDATE, "Technical interview", "A 45-minute call.");
      const html = lastSend(mail).html as string;
      expect(html).toContain("Technical interview");
      expect(html).toContain("A 45-minute call.");
    });

    it("ESCAPES reviewer-authored text — staff input is still input, and this is an HTML email", async () => {
      await service.sendNextRound(CANDIDATE, "<script>alert(1)</script>", "Bring <b>notes</b>");
      const html = lastSend(mail).html as string;
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("Bring <b>notes</b>");
    });

    it("preserves the reviewer's line breaks so the message arrives shaped the way it was written", async () => {
      await service.sendNextRound(CANDIDATE, "Demo", "Line one\nLine two");
      expect(lastSend(mail).html as string).toContain("Line one<br />Line two");
    });

    it("escapes a candidate's own name too — it came from an anonymous public form", async () => {
      await service.sendNextRound({ ...CANDIDATE, name: '<img src=x onerror="alert(1)">' }, "Demo", "Details");
      const html = lastSend(mail).html as string;
      expect(html).not.toContain('<img src=x onerror="alert(1)">');
      expect(html).toContain("&lt;img");
    });
  });

  describe("offer", () => {
    const letter = { filename: "Offer-Letter-Priya-Sharma.pdf", content: Buffer.from("%PDF"), contentType: "application/pdf" };

    it("attaches the letter", async () => {
      await service.sendOffer(CANDIDATE, letter, null);
      const sent = lastSend(mail);
      expect(sent.attachments).toHaveLength(1);
      expect(sent.attachments![0]!.filename).toBe("Offer-Letter-Priya-Sharma.pdf");
      expect(sent.attachments![0]!.content).toEqual(Buffer.from("%PDF"));
    });

    it("includes the reviewer's covering note when there is one, escaped", async () => {
      await service.sendOffer(CANDIDATE, letter, "Great <b>demo</b>!");
      const html = lastSend(mail).html as string;
      expect(html).toContain("Great &lt;b&gt;demo&lt;/b&gt;!");
    });

    it("works without a covering note", async () => {
      await expect(service.sendOffer(CANDIDATE, letter, null)).resolves.toBe(true);
    });
  });

  describe("rejection", () => {
    it("carries NO reason — the internal note is never an argument to this method at all", async () => {
      await service.sendRejection(CANDIDATE);
      const sent = lastSend(mail);
      expect(service.sendRejection.length).toBe(1); // candidate only; there is no notes parameter
      expect(JSON.stringify(sent)).not.toMatch(/internal/i);
    });

    it("points the candidate at future openings rather than ending on a flat no", async () => {
      await service.sendRejection(CANDIDATE);
      const sent = lastSend(mail);
      expect(sent.html as string).toContain("/careers");
    });
  });

  describe("failure handling", () => {
    it.each([
      ["acknowledgement", () => service.sendAcknowledgement(CANDIDATE)],
      ["next round", () => service.sendNextRound(CANDIDATE, "R", "D")],
      [
        "offer",
        () =>
          service.sendOffer(CANDIDATE, { filename: "o.pdf", content: Buffer.from("x"), contentType: "application/pdf" }, null),
      ],
      ["rejection", () => service.sendRejection(CANDIDATE)],
    ])("%s returns false instead of throwing — a bounced mailbox must not undo a recorded decision", async (_label, call) => {
      mail.send.mockRejectedValue(new Error("provider down"));
      await expect(call()).resolves.toBe(false);
    });
  });

  it("tags every message so a send can be traced in the provider dashboard", async () => {
    await service.sendAcknowledgement(CANDIDATE);
    await service.sendNextRound(CANDIDATE, "R", "D");
    await service.sendRejection(CANDIDATE);
    for (const call of mail.send.mock.calls) {
      expect(call[0].tags?.[0]?.value).toMatch(/^career_application_/);
    }
  });
});
