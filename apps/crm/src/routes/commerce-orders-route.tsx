import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { OrderLedger } from "../components/commerce/order-ledger";

function CommerceOrdersPage() {
  const { me } = useMe();
  return <OrderLedger me={me} />;
}

export const commerceOrdersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commerce/orders",
  component: CommerceOrdersPage,
});
