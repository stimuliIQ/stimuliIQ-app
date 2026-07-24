import type { Metadata } from "next";

import { AccountStatus } from "../../components/account-status";

export const metadata: Metadata = {
  title: "Your Account — stimuliiq",
  description: "View your stimuliiq account status, enrollments, and roles.",
};

// Wave 5 shell route (docs/plans/phase-0.md task #9): calls GET /api/v1/me via
// @repo/api-client + TanStack Query, rendering loading/signed-out/error/success
// states with @repo/ui primitives. No business logic here — see useMe().
export default function AccountPage() {
  return (
    <main id="main-content" className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold text-fg">Account</h1>
      <AccountStatus />
    </main>
  );
}
