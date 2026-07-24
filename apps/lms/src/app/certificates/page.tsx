// Certificates page (/certificates) — student-facing.
// P4 Task #10: docs/02 §7.11 Certificates list + download.
"use client";

import { LmsShell } from "../../components/shell/lms-shell";
import { CertificatesContent } from "../../components/certificates/certificates-content";
import { useMe } from "../../hooks/use-me";

export default function CertificatesPage() {
  const { me } = useMe();

  return (
    <LmsShell>
      <CertificatesContent holderName={me?.user.name ?? "Student"} />
    </LmsShell>
  );
}
