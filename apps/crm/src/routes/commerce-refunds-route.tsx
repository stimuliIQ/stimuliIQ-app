import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { RefundList } from "../components/commerce/refund-list";

function CommerceRefundsPage() {
  const { me } = useMe();
  return <RefundList me={me} />;
}

export const commerceRefundsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commerce/refunds",
  component: CommerceRefundsPage,
});
