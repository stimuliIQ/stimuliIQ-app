// Public certificate-verification page — `app/verify/[certId]/page.tsx`
//
// Task #11, Phase 4 (docs/plans/phase-4.md §4 #11).
//
// Design:
//   - React Server Component (RSC) — unauthenticated, no auth guard, no login redirect.
//   - Calls the PUBLIC endpoint `GET /api/v1/verify/:certUid` via @repo/api-client.
//     No hand-written fetch (CLAUDE.md §3 rule 2).
//   - Three render states:
//       valid   → AC-H1: green/verified visual + program, issued date, holder name.
//       revoked → AC-H2: distinct revoked visual (ShieldX + text; not color-only).
//       invalid → AC-H3/H4/H5: "Certificate Not Found" — no internal details leaked.
//   - A fabricated/guessed/tampered certId returns 404 from the API → renders invalid state.
//   - SEO/OG metadata for shareability (generateMetadata, per-route; title + description + OG).
//   - loading.tsx suspense boundary + error.tsx error boundary are co-located.
//   - No PII beyond holderName (the API already guarantees this; we render exactly 5 fields).
//
// A11y (docs/07 §11, WCAG 2.2 AA):
//   - Semantic <main id="main-content"> skip-target, <article>, heading hierarchy.
//   - Status conveyed by icon + text, never color alone.
//   - Visible focus ring inherited from @repo/ui tokens.
//   - SR labels on all icon-only and decorative elements.
//
// Analytics: verify-page-view event fired (centralised analytics module, see docs/04 §3.5).
// The event key is ONLY the certId (no PII); the VerifyResult is not sent to analytics.

import type { Metadata } from "next";
import { Suspense } from "react";
import { ApiError, createApiClient } from "@repo/api-client";
import type { VerifyResult } from "@repo/types";

import { VerifyPanel } from "../../../components/verify/verify-panel";
import type { VerifyState } from "../../../components/verify/verify-panel";
import { VerifyPageSkeleton } from "../../../components/verify/verify-skeleton";
import { escapeJsonLd } from "../../../lib/seo/json-ld";
import { SITE_NAME, SITE_URL } from "../../../lib/seo/metadata";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side API client (RSC context — no cookie refresh needed for public endpoint)
// ─────────────────────────────────────────────────────────────────────────────

const serverApiClient = createApiClient({
  baseUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  // Public endpoint — no onUnauthorized refresh needed (the verify endpoint requires no auth)
  onUnauthorized: async () => "failed",
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ certId: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata (SEO + OG for shareability — AC task §11 "SEO/OG for shareability")
// ─────────────────────────────────────────────────────────────────────────────

// SITE_NAME/SITE_URL come from lib/seo/metadata (imported above) rather than being re-derived
// from the environment here: the local copy defaulted to the bare apex, which only ever 307s to
// www, and it skipped the trim the shared constant applies. Two modules deriving the canonical
// host from the same env var by different rules is how they drift apart.

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { certId } = await params;

  // Best-effort server fetch for rich OG metadata; falls back to generic if unavailable.
  let result: VerifyResult | null = null;
  try {
    result = await serverApiClient.learning.certificates.verify(certId);
  } catch {
    // 404 or network error — fallback metadata below
  }

  const canonicalUrl = `${SITE_URL}/verify/${encodeURIComponent(certId)}`;

  if (result?.valid === true) {
    const title = `${result.holderName} — ${result.program} Certificate | ${SITE_NAME}`;
    const description =
      `Verify the ${result.program} certificate issued by ${SITE_NAME} to ${result.holderName}.`;
    return {
      title,
      description,
      alternates: { canonical: canonicalUrl },
      openGraph: {
        type: "website",
        url: canonicalUrl,
        title,
        description,
        siteName: SITE_NAME,
        // OG image: structured-data image for the verify page
        // Production: replace with the actual OG image generation endpoint
        images: [
          {
            url: `${SITE_URL}/api/og/verify?certId=${encodeURIComponent(certId)}`,
            width: 1200,
            height: 630,
            alt: `${result.holderName}'s ${result.program} certificate from ${SITE_NAME}`,
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
      },
    };
  }

  if (result?.valid === "revoked") {
    const title = `Certificate Revoked — ${SITE_NAME}`;
    const description = `This ${result.program} certificate issued by ${SITE_NAME} has been revoked.`;
    return {
      title,
      description,
      alternates: { canonical: canonicalUrl },
      openGraph: {
        type: "website",
        url: canonicalUrl,
        title,
        description,
        siteName: SITE_NAME,
      },
      robots: { index: false, follow: false },
    };
  }

  // Invalid / not-found cert — minimal metadata, no-index
  return {
    title: `Certificate Verification — ${SITE_NAME}`,
    description: `Verify a ${SITE_NAME} certificate using its unique verification ID.`,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "website",
      url: canonicalUrl,
      title: `Certificate Verification — ${SITE_NAME}`,
      description: `Verify a ${SITE_NAME} certificate using its unique verification ID.`,
      siteName: SITE_NAME,
    },
    robots: { index: false, follow: false },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured data (JSON-LD) for shareable valid certificates
// ─────────────────────────────────────────────────────────────────────────────

function VerifyStructuredData({
  certId,
  result,
}: {
  certId: string;
  result: Extract<VerifyResult, { valid: true }>;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "EducationalOccupationalCredential",
    name: result.program,
    description: `Certificate of completion for ${result.program} issued by ${SITE_NAME}`,
    url: `${SITE_URL}/verify/${encodeURIComponent(certId)}`,
    dateCreated: result.issuedAt,
    recognizedBy: {
      "@type": "EducationalOrganization",
      name: SITE_NAME,
      url: SITE_URL,
    },
    credentialCategory: "Certificate",
  };

  // Escape via the shared helper — resolves P4 L-1 (AC-33).
  // escapeJsonLd serialises + escapes `<` to prevent script-breakout.
  const escapedJsonLd = escapeJsonLd(jsonLd);

  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped by escapeJsonLd()
      dangerouslySetInnerHTML={{ __html: escapedJsonLd }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetch + state resolution (server-side; no business logic in component)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveVerifyState(certId: string): Promise<VerifyState> {
  try {
    const result = await serverApiClient.learning.certificates.verify(certId);
    if (result.valid === true) {
      return { kind: "valid", result };
    }
    // valid === "revoked"
    return { kind: "revoked", result };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 429)) {
      // 404 = fabricated/nonexistent/tampered cert_uid (AC-H3/H4/H5)
      // 429 = rate-limited — show invalid state without leaking limit details (AC-H6)
      return { kind: "invalid" };
    }
    // Any other error (network failure, 5xx, etc.) → invalid state.
    // We never show internal error details on a public page (AC-H3).
    return { kind: "invalid" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page component (RSC)
// ─────────────────────────────────────────────────────────────────────────────

export default async function VerifyCertificatePage({ params }: PageProps) {
  const { certId } = await params;

  // Decode the URL-encoded certId (Next.js decodes params but be explicit)
  const decodedCertId = decodeURIComponent(certId);

  // Resolve state server-side — falls back to "invalid" on any API failure.
  // This function contains the only "business" data-fetching logic; the
  // component layer (VerifyPanel) is purely presentational.
  const state = await resolveVerifyState(decodedCertId);

  return (
    <>
      {/* Structured data for valid certs only (search engines, social preview) */}
      {state.kind === "valid" && (
        <VerifyStructuredData certId={decodedCertId} result={state.result} />
      )}

      <main
        id="main-content"
        className="mx-auto max-w-xl px-4 py-12 sm:py-16"
        data-testid="verify-page"
      >
        {/* Page header */}
        <header className="mb-10 text-center">
          <p className="mb-2 text-sm font-medium uppercase tracking-widest text-fg-subtle">
            {SITE_NAME}
          </p>
          <h1 className="text-2xl font-semibold text-fg sm:text-3xl">
            Certificate Verification
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            Instantly verify the authenticity of a{" "}
            <span className="font-medium">{SITE_NAME}</span> certificate.
          </p>
        </header>

        {/* Verification result — all three states rendered by VerifyPanel */}
        <Suspense fallback={<VerifyPageSkeleton />}>
          <VerifyPanel state={state} certId={decodedCertId} />
        </Suspense>

        {/* Footer note */}
        <footer className="mt-10 text-center">
          <p className="text-xs text-fg-subtle">
            Powered by{" "}
            <a
              href={SITE_URL}
              className="underline underline-offset-2 hover:text-fg focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              target="_blank"
              rel="noopener noreferrer"
            >
              {SITE_NAME}
            </a>
          </p>
        </footer>
      </main>
    </>
  );
}
