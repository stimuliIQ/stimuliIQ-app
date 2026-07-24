// Forgot-password route ("/forgot-password") — QA defect #5 fix. Reachable
// while signed out (see components/layout/app-shell.tsx's PUBLIC_PATHS
// bypass) since that's the entire point of this route.
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { ForgotPasswordForm } from "../components/auth/forgot-password-form";

export const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordForm,
});
