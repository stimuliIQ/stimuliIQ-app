import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route";
import { InvoiceList } from "../components/commerce/invoice-list";

function CommerceInvoicesPage() {
  return <InvoiceList />;
}

export const commerceInvoicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commerce/invoices",
  component: CommerceInvoicesPage,
});
