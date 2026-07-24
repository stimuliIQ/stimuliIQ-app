import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { PaymentLedger } from "../components/commerce/payment-ledger";

function CommercePaymentsPage() {
  const { me } = useMe();
  return <PaymentLedger me={me} />;
}

export const commercePaymentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commerce/payments",
  component: CommercePaymentsPage,
});
