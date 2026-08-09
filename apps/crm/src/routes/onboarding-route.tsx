import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { OnboardingWorkspace } from "../components/onboarding/onboarding-workspace";

function OnboardingPage() {
  const { me } = useMe();
  return <OnboardingWorkspace me={me} />;
}

export const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: OnboardingPage,
});
