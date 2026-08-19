// Certificates page (/certificates) — student-facing.
// P4 Task #10: docs/02 §7.11 Certificates list + download.
//
// PageHeader lives here, at page level, not inside CertificatesContent — the
// content component returns early for the loading/signed-out/error/empty states,
// so a header rendered only on its success branch disappeared entirely for a
// student with no certificates yet, leaving the page with no <h1> at all. Same
// shape as /forum and the rest of the LMS: one page-level header, then content.
"use client";

import { PageHeader } from "@repo/ui";

import { LmsShell } from "../../components/shell/lms-shell";
import { CertificatesContent } from "../../components/certificates/certificates-content";
import { useMe } from "../../hooks/use-me";

export default function CertificatesPage() {
  const { me } = useMe();

  return (
    <LmsShell>
      <div className="space-y-6 md:space-y-8" data-testid="certificates-page">
        <PageHeader title="My Certificates" />
        <CertificatesContent holderName={me?.user.name ?? "Student"} />
      </div>
    </LmsShell>
  );
}
