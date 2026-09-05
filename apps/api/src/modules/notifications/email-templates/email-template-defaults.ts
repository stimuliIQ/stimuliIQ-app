// The shipped text for every CRM-editable transactional email.
//
// These are the DEFAULTS. A row in `email_templates` overrides the prose; deleting it
// restores what is written here. Keeping defaults in code rather than seeding them as rows
// is deliberate on two counts:
//
//   1. An email that fails to render is worse than one nobody can reword. Enrolment must
//      not break for a student who has already paid because a row is missing on a freshly
//      provisioned tenant, or because somebody deleted one.
//   2. Seeded rows would make every template read as "customised" on day one, hiding which
//      words the company actually chose and making "reset to default" restore a copy of the
//      default rather than the default.
//
// ADDING A KEY: add it to EMAIL_TEMPLATE_KEYS in @repo/types, add a default here, and make
// the send site render through EmailTemplateService. A key with no send site is a control
// that edits nothing, which is exactly what the certificate "template designer" was.
import type { EmailTemplateKey, EmailTemplateVariable } from "@repo/types";

export interface EmailTemplateDefault {
  /** Shown in the CRM list. */
  name: string;
  /** When this email fires. Staff cannot sensibly edit what they cannot place. */
  description: string;
  subject: string;
  heading: string;
  /** Blank lines separate paragraphs. */
  body: string;
  footnote: string | null;
  /** The placeholders this key supplies. Anything else is rejected on save. */
  variables: EmailTemplateVariable[];
  /**
   * What the send site adds and the editor cannot touch, in words a non-engineer can read.
   * Rendered in the CRM beside the form so the boundary is stated rather than discovered.
   */
  fixedPartsNote: string;
}

export const EMAIL_TEMPLATE_DEFAULTS: Record<EmailTemplateKey, EmailTemplateDefault> = {
  enrollment_welcome: {
    name: "Enrolment welcome",
    description:
      "Sent once, the first time a student's payment is recorded, when their LMS account is created. Carries their login details.",
    subject: "Welcome aboard! Your LMS login is inside",
    heading: "You're Enrolled!",
    body:
      "Welcome aboard! Your enrolment is confirmed and your learning account is ready. " +
      "Sign in with the details below to get started.",
    footnote:
      "For your security you'll be asked to set a new password the first time you sign in. " +
      "Please don't share these details with anyone.",
    variables: [
      { key: "studentName", description: "The student's name.", sample: "Chandra Sekhar" },
    ],
    fixedPartsNote:
      "The LMS username, the temporary password and the 'Sign in to the LMS' button are added automatically and cannot be edited here, so this email can never be saved without the details a student needs to log in.",
  },

  payment_receipt: {
    name: "Payment receipt",
    description:
      "Sent when a payment is recorded for a student who already has an LMS account, for example a second instalment. The first payment gets the enrolment welcome instead, never both.",
    subject: "You're enrolled at Stimuli IQ",
    heading: "You're Enrolled!",
    // NO AMOUNT, NO ORDER, NO INVOICE — the owner's instruction covered both payment
    // emails, not just the first one. A student paying a second instalment was still
    // getting "we've received your payment of ₹14,999.00" with the order id and invoice
    // number under it. All three are gone from the default; the placeholders stay
    // DECLARED below so anybody who does want a receipt can add them back from the CRM
    // without a deploy, which is the entire point of that screen.
    body:
      "Hi {{studentName}}, your payment has been received and your enrolment is confirmed.\n\n" +
      "Head to the LMS to continue your programme.",
    footnote: null,
    variables: [
      { key: "studentName", description: "The student's name.", sample: "Chandra Sekhar" },
      { key: "amountRupees", description: "Amount paid, in rupees.", sample: "14,999.00" },
      { key: "orderId", description: "The order's id.", sample: "a9adcbe6-2e3e-4351-87d0-ea470ebf0078" },
      { key: "invoiceNumber", description: "The GST invoice number, when one exists.", sample: "INV-2026-0001" },
    ],
    fixedPartsNote:
      "Only the 'Go to LMS' button is added automatically. Everything a student reads is the text above. This email intentionally mentions no amount, order or invoice — add {{amountRupees}}, {{orderId}} or {{invoiceNumber}} if you ever want it to read as a receipt.",
  },
};

/** The placeholder keys a template may use, for validation and for the editor's hint list. */
export function allowedVariableKeys(key: EmailTemplateKey): string[] {
  return EMAIL_TEMPLATE_DEFAULTS[key].variables.map((v) => v.key);
}
