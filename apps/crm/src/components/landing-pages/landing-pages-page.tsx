// Marketing > Landing Pages — tabbed shell over Landing Pages + Lead Forms
// (the two are managed together since lead forms are typically embedded on
// landing pages). Phase 9 Completion T33/T40.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { LandingPageDirectory } from "./landing-page-directory";
import { LeadFormManager } from "./lead-form-manager";

export function LandingPagesPage({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  return (
    <div className="space-y-4 md:space-y-5" data-testid="landing-pages-page">
      <PageHeader
        title="Landing pages"
        description={
          <>
            Campaign pages for ads and promotions, and the lead-capture forms embedded on them, separate from your
            main website pages, which are edited in{" "}
            <Link to="/marketing/page-builder" className="font-medium text-brand-500 hover:underline">
              Page Builder
            </Link>
            .
          </>
        }
      />
      <Tabs defaultValue="pages">
        <TabsList aria-label="Landing pages sections">
          <TabsTrigger value="pages" data-testid="landing-pages-tab-pages">
            Landing Pages
          </TabsTrigger>
          <TabsTrigger value="forms" data-testid="landing-pages-tab-forms">
            Lead Forms
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pages" data-testid="landing-pages-panel-pages">
          <LandingPageDirectory me={me} />
        </TabsContent>
        <TabsContent value="forms" data-testid="landing-pages-panel-forms">
          <LeadFormManager me={me} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
