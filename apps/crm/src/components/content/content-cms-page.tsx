// Marketing > Blog CMS — headless CMS shell over Blog/Testimonials/Partners/
// Faculty Bios/Pages. Phase 9 Completion T22/T40.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { BlogManager } from "./blog-manager";
import { PartnersManager } from "./partners-manager";
import { FacultyBiosManager } from "./faculty-bios-manager";
import { ContentPagesManager } from "./content-pages-manager";

export function ContentCmsPage({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  return (
    <div className="space-y-4 md:space-y-5" data-testid="content-cms-page">
      <PageHeader
        title="Blog CMS"
        description={
          <>
            Blog posts, partner logos, and faculty bios shown on your website. Your main website pages
            (Home, About, Gallery…) are edited in{" "}
            <Link to="/marketing/page-builder" className="font-medium text-brand-500 hover:underline">
              Page Builder
            </Link>
            , not here.
          </>
        }
      />
      <Tabs defaultValue="blog">
        <TabsList aria-label="Content sections">
          <TabsTrigger value="blog" data-testid="content-cms-tab-blog">
            Blog
          </TabsTrigger>
          <TabsTrigger value="partners" data-testid="content-cms-tab-partners">
            Partners
          </TabsTrigger>
          <TabsTrigger value="faculty-bios" data-testid="content-cms-tab-faculty-bios">
            Faculty Bios
          </TabsTrigger>
          <TabsTrigger value="pages" data-testid="content-cms-tab-pages">
            Simple pages
          </TabsTrigger>
        </TabsList>
        <TabsContent value="blog" data-testid="content-cms-panel-blog">
          <BlogManager me={me} />
        </TabsContent>
        <TabsContent value="partners" data-testid="content-cms-panel-partners">
          <PartnersManager me={me} />
        </TabsContent>
        <TabsContent value="faculty-bios" data-testid="content-cms-panel-faculty-bios">
          <FacultyBiosManager me={me} />
        </TabsContent>
        <TabsContent value="pages" data-testid="content-cms-panel-pages">
          <ContentPagesManager me={me} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
