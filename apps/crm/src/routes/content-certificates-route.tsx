import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { useMe } from "../hooks/use-me";
import { CertificateDirectory } from "../components/certificates/certificate-directory";

function ContentCertificatesPage() {
  const { me } = useMe();
  return <CertificateDirectory me={me} />;
}

export const contentCertificatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/content/certificates",
  component: ContentCertificatesPage,
});
