import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { CouponList } from "../components/commerce/coupon-list";

function CommerceCouponsPage() {
  const { me } = useMe();
  return <CouponList me={me} />;
}

export const commerceCouponsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commerce/coupons",
  component: CommerceCouponsPage,
});
