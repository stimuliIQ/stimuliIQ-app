// Reset-password route ("/reset-password?token=...") — QA defect #5 fix.
// Reachable while signed out (see components/layout/app-shell.tsx's
// PUBLIC_PATHS bypass). `token` is validated as an optional string search
// param (zod, matches CLAUDE.md §3.2's "validation at every boundary") and
// handed to ResetPasswordForm as a prop; a missing/malformed token is a valid
// (if unhappy) state the form itself renders, not a router-level 404.
import { createRoute } from "@tanstack/react-router";
import { z } from "zod";

import { rootRoute } from "./root-route";
import { ResetPasswordForm } from "../components/auth/reset-password-form";

const resetPasswordSearchSchema = z.object({
  token: z.string().optional(),
});

function ResetPasswordPage() {
  const { token } = resetPasswordRoute.useSearch();
  return <ResetPasswordForm token={token} />;
}

export const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  validateSearch: resetPasswordSearchSchema,
  component: ResetPasswordPage,
});
