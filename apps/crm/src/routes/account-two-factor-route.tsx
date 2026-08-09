// Account ▸ Two-Factor Auth — the last item in the CRM side nav.
//
// Promotes the existing TwoFactorPanel (previously reachable ONLY as the third tab of
// Admin ▸ Settings) to a directly-linkable page. The panel itself is unchanged and is
// still rendered by SettingsManager too — this route adds a way in, it does not move
// the feature.
import { createRoute } from "@tanstack/react-router";
import { PageHeader } from "@repo/ui";

import { rootRoute } from "./root-route";
import { TwoFactorPanel } from "../components/admin/two-factor-panel";

function AccountTwoFactorPage() {
  return (
    <div className="space-y-6 md:space-y-8" data-testid="account-two-factor-page">
      <PageHeader
        title="Two-factor authentication"
        description="Add a second step to your own sign-in using an authenticator app such as Google Authenticator, Authy or 1Password."
      />
      <TwoFactorPanel />
    </div>
  );
}

export const accountTwoFactorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account/two-factor",
  component: AccountTwoFactorPage,
});
