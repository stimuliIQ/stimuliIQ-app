import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { ReferralDirectory } from "../components/referrals/referral-directory";

function MarketingReferralsPage() {
  const { me } = useMe();
  return <ReferralDirectory me={me} />;
}

export const marketingReferralsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketing/referrals",
  component: MarketingReferralsPage,
});
