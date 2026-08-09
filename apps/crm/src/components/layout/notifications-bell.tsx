// CRM top-bar notification bell — the container that binds useCrmNotifications to the
// presentational NotificationBell from @repo/ui.
//
// Until now the CRM's bell was a hard-disabled placeholder ("Notifications (coming
// soon)"), so lead assignment had no way to reach anyone: the lead's owner changed in the
// database and the assignee found out whenever they next happened to look at the
// pipeline. This is the delivery half of that feature.
//
// Clicking a lead_assigned row marks it read AND navigates to the pipeline filtered to
// the caller's own leads — one click from "you have a lead" to "here it is", rather than
// dropping the user on a page and leaving them to find it.
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { NotificationBell, type NotificationBellItem } from "@repo/ui";

import { useCrmNotifications } from "../../hooks/use-notifications";
import { deriveNotificationBody, deriveNotificationTitle } from "../../lib/notification-copy";

export function NotificationsBell(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { items, isLoading, isSignedOut, markRead, markAllRead } = useCrmNotifications();

  // A signed-out session renders nothing at all rather than an empty or erroring bell —
  // the app is about to bounce to the sign-in screen anyway, and a broken-looking control
  // in the chrome reads as an app fault rather than an expired session.
  if (isSignedOut) return null;

  const bellItems: NotificationBellItem[] = items.map((notification) => ({
    id: notification.id,
    type: notification.type,
    title: deriveNotificationTitle(notification.type, notification.payload),
    body: deriveNotificationBody(notification.type, notification.payload),
    timestamp: notification.createdAt,
    isRead: notification.readAt !== null,
    actionLabel: notification.type === "lead_assigned" ? "Open lead" : undefined,
    onAction:
      notification.type === "lead_assigned"
        ? () => {
            markRead(notification.id);
            // Navigates to the caller's own leads rather than deep-linking one lead id:
            // the pipeline drawer opens from a row click, and landing a rep on their full
            // queue is more useful than isolating the single lead that triggered this.
            void navigate({ to: "/leads", search: { owner: "mine" } });
          }
        : undefined,
  }));

  return (
    <NotificationBell
      items={bellItems}
      loading={isLoading}
      onMarkRead={markRead}
      onMarkAllRead={markAllRead}
      onViewAll={() => void navigate({ to: "/leads", search: { owner: "mine" } })}
      data-testid="notifications-button"
    />
  );
}
