// /downloads — Downloads & Resources page. Phase 9 Completion, T34.
// docs/02 §7.8. force-dynamic: authenticated route; must not be statically prerendered.
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

import { LmsShell } from "../../components/shell/lms-shell";
import { DownloadsContent } from "../../components/downloads/downloads-content";

export const metadata: Metadata = {
  title: "Downloads & Resources | stimuliiq",
  description: "Notes, slides, datasets, and cheat-sheets from your enrolled courses.",
};

export default function DownloadsPage() {
  return (
    <LmsShell>
      <DownloadsContent />
    </LmsShell>
  );
}
