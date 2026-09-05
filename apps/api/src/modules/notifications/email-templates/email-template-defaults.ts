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

};

/** The placeholder keys a template may use, for validation and for the editor's hint list. */
export function allowedVariableKeys(key: EmailTemplateKey): string[] {
  return EMAIL_TEMPLATE_DEFAULTS[key].variables.map((v) => v.key);
}
