import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { TestimonialsManager } from "../components/content/testimonials-manager";

function MarketingTestimonialsPage() {
  const { me } = useMe();
  return <TestimonialsManager me={me} />;
}

export const marketingTestimonialsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketing/testimonials",
  component: MarketingTestimonialsPage,
});
