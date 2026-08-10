import { createRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { CertificateDirectory } from "../components/certificates/certificate-directory";

// `?batchId=` is the cohort being reviewed. The page opens on the batch list
// (no param) and drills in from a row — keeping it in the URL rather than in
// component state makes a drilled-in cohort linkable and makes the browser Back
// button walk back out to the batch list. `.catch(undefined)` so a malformed id
// in a pasted link degrades to the batch list instead of erroring the route.
const certificatesSearchSchema = z.object({
  batchId: z.string().uuid().optional().catch(undefined),
});

function ContentCertificatesPage() {
  const { me } = useMe();
  const { batchId } = contentCertificatesRoute.useSearch();
  const navigate = useNavigate();

  return (
    <CertificateDirectory
      me={me}
      batchId={batchId ?? null}
      onBatchChange={(next) =>
        void navigate({
          to: "/content/certificates",
          search: next ? { batchId: next } : {},
        })
      }
    />
  );
}

export const contentCertificatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/content/certificates",
  validateSearch: certificatesSearchSchema,
  component: ContentCertificatesPage,
});
