// Marketing ▸ Campaigns route — Phase 6, task #11.
// Path: /marketing/campaigns
// Requires: campaigns.view permission (API also enforces server-side).
// Renders the CampaignDirectory which includes:
//   - Paginated campaign list (DataTable + status/channel filters)
//   - CampaignBuilderDrawer (multi-step: segment → template → schedule → review)
//   - CampaignDetailDrawer (metrics + recipients + pause/cancel)
// RBAC: create/send actions gated on campaigns.create / campaigns.send
// (rendered only if the user's permissions include those keys).
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { CampaignDirectory } from "../components/campaigns/campaign-directory";

function MarketingCampaignsPage() {
  const { me } = useMe();
  return <CampaignDirectory me={me} />;
}

export const marketingCampaignsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketing/campaigns",
  component: MarketingCampaignsPage,
});
