// Profile route (/profile) — Phase 9 Completion, T34 (docs/02 §7.16).
import type { Metadata } from "next";

import { LmsShell } from "../../components/shell/lms-shell";
import { ProfileContent } from "../../components/profile/profile-content";

export const metadata: Metadata = {
  title: "Profile & Settings | stimuliiq",
};

export default function ProfilePage() {
  return (
    <LmsShell>
      <div data-testid="profile-page">
        <ProfileContent />
      </div>
    </LmsShell>
  );
}
