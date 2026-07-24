// Public payment-link page (lifecycle-redesign): /pay/[token]
//
// The student lands here from a link their counsellor sent. The HMAC-signed
// token in the URL authorizes viewing + paying EXACTLY ONE order — no login
// (see apps/api .../pay-link.util.ts for the contract). Client component does
// the work: token is sensitive-ish (a bearer credential), so no SSR caching,
// no metadata derived from it.
import type { Metadata } from "next";

import { PayLinkClient } from "./pay-link-client";

export const metadata: Metadata = {
  title: "Complete your payment",
  robots: { index: false, follow: false }, // bearer-token URL — never index
};

export default async function PayLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PayLinkClient token={token} />;
}
