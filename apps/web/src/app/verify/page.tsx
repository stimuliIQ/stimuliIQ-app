// Public certificate-verification ENTRY page — `app/verify/page.tsx`
//
// Go-live blocker B10a: the footer, program pages, sitemap.ts and robots.ts all link
// to `/verify`, but only `/verify/[certId]` (the result page) existed — so `/verify`
// itself 404'd. This is the ID-entry page: a holder or employer types a certificate ID
// and is taken to `/verify/<id>`, which renders the verified/revoked/invalid result.
//
// Server component shell (SEO/OG) + a small client form for the input + navigation.
// No business logic here — validity is decided by the public API on the result page.

import type { Metadata } from "next";
import { VerifyEntryForm } from "../../components/verify/verify-entry-form";

const SITE_NAME = "stimuliiq";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stimuliiq.com";

export const metadata: Metadata = {
  title: `Verify a Certificate — ${SITE_NAME}`,
  description:
    "Verify the authenticity of a stimuliiq training certificate. Enter the certificate ID printed on the certificate to confirm the holder, program and issue date.",
  alternates: { canonical: `${SITE_URL}/verify` },
  openGraph: {
    title: `Verify a Certificate — ${SITE_NAME}`,
    description: "Confirm the authenticity of a stimuliiq training certificate.",
    url: `${SITE_URL}/verify`,
    siteName: SITE_NAME,
    type: "website",
  },
};

export default function VerifyEntryPage() {
  return (
    <main id="main-content" className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-4 py-16">
      <div className="space-y-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Verify a <span className="text-chart-3">certificate</span></h1>
        <p className="text-muted-foreground">
          Enter the certificate ID printed on a stimuliiq certificate to confirm it is
          genuine and see the holder, program and issue date.
        </p>
      </div>
      <div className="mt-8">
        <VerifyEntryForm />
      </div>
    </main>
  );
}
