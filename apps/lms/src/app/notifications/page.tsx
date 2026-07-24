// /notifications — In-app notification center. Phase 6, Task #10.
// docs/02 §7.15, docs/specs/phase-6-engagement.md WS-1.
//
// force-dynamic: This is an authenticated route. Static prerendering is skipped
// so that isomorphic-dompurify (used by notification-center-content) is not
// bundled for SSR/prerender — it requires browser APIs not available at build time.
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

import { LmsShell } from "../../components/shell/lms-shell";
import { NotificationCenterContent } from "../../components/notifications/notification-center-content";

export const metadata: Metadata = {
  title: "Notifications — stimuliiq",
  description: "Your in-app notification center.",
};

export default function NotificationsPage() {
  return (
    <LmsShell>
      <NotificationCenterContent />
    </LmsShell>
  );
}
