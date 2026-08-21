// /notifications/prefs — Notification preferences page. Phase 6, Task #10.
// docs/02 §7.15, docs/specs/phase-6-engagement.md WS-1D.
//
// force-dynamic: authenticated route; no static prerendering needed.
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

import { LmsShell } from "../../../components/shell/lms-shell";
import { NotificationPrefsContent } from "../../../components/notifications/notification-prefs-content";

export const metadata: Metadata = {
  title: "Notification Preferences | stimuliiq",
  description: "Configure which notifications you receive and on which channels.",
};

export default function NotificationPrefsPage() {
  return (
    <LmsShell>
      <NotificationPrefsContent />
    </LmsShell>
  );
}
