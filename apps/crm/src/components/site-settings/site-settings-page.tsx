// Site Settings — grouped editor over the 7 `SiteSetting` keys (docs/specs/
// phase-10-page-builder.md "Site Settings"). RBAC gate matches page-builder-page.tsx's
// pattern (AC 8/9-equivalent for this surface: `site_settings.view`/`.edit`) — a viewer
// without `site_settings.view` sees a forbidden state and no setting data is fetched.
//
// P10-2 (real-user defect, promoted from follow-up): `stats.headline` was REMOVED
// end-to-end — `apps/web` never consumed it; the homepage's stats actually come from the
// home page's own `stat_group` Page Builder block, so editing this setting silently did
// nothing. The "Stats" tab/group is gone; see site-settings.schemas.ts (@repo/types) for
// the schema-side removal. The helper text below points admins at the block that's
// actually live instead.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { EmptyState, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import { ShieldAlert } from "lucide-react";
import type { MeResponse } from "@repo/types";

import { hasPermission } from "../../lib/permissions";
import { NavPrimaryLinksCard } from "./nav-primary-links-card";
import { FooterColumnsCard } from "./footer-columns-card";
import { FooterLegalLinksCard } from "./footer-legal-links-card";
import { FooterCopyrightCard } from "./footer-copyright-card";
import { SeoDefaultsCard } from "./seo-defaults-card";
import { ContactDetailsCard } from "./contact-details-card";
import { ContactWhatsappCard } from "./contact-whatsapp-card";
import { AnnouncementBarCard } from "./announcement-bar-card";

export function SiteSettingsPage({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "site_settings.view");
  const canEdit = hasPermission(me?.permissions, "site_settings.edit");

  if (!canView) {
    return (
      <div className="space-y-4 md:space-y-5" data-testid="site-settings-page">
        <PageHeader title="Site settings" />
        <EmptyState
          icon={<ShieldAlert />}
          title="You don't have access to site settings"
          description="This surface is restricted to super_admin. Ask an Owner to grant site_settings.view if you believe this is wrong."
          data-testid="site-settings-page-access-denied"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="site-settings-page">
      <PageHeader
        title="Site settings"
        description={
          <>
            <span className="block">
              Things that appear on every page of your website: the top menu, the footer, contact details, and how
              the site appears on Google and social media. Changes here take effect within about 5 minutes.
            </span>
            {/* P10-2: point admins at the block that's actually live, since this is the #1 place
                someone looking to change homepage stats would otherwise land. */}
            <span className="block">
              Looking for the homepage numbers (15,000+ students…)? They&apos;re edited on the Home page&apos;s
              Stats section in{" "}
              <Link to="/marketing/page-builder" className="font-medium text-brand-500 hover:underline">
                Page Builder
              </Link>
              .
            </span>
          </>
        }
      />

      <Tabs defaultValue="nav">
        <TabsList aria-label="Site settings groups">
          <TabsTrigger value="nav" data-testid="site-settings-tab-nav">
            Menu
          </TabsTrigger>
          <TabsTrigger value="footer" data-testid="site-settings-tab-footer">
            Footer
          </TabsTrigger>
          <TabsTrigger value="seo" data-testid="site-settings-tab-seo">
            Search &amp; sharing
          </TabsTrigger>
          <TabsTrigger value="contact" data-testid="site-settings-tab-contact">
            Contact
          </TabsTrigger>
          <TabsTrigger value="announcement" data-testid="site-settings-tab-announcement">
            Announcement
          </TabsTrigger>
        </TabsList>
        <TabsContent value="nav" data-testid="site-settings-panel-nav">
          <NavPrimaryLinksCard canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="footer" data-testid="site-settings-panel-footer" className="flex flex-col gap-4">
          <FooterColumnsCard canEdit={canEdit} />
          <FooterLegalLinksCard canEdit={canEdit} />
          <FooterCopyrightCard canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="seo" data-testid="site-settings-panel-seo">
          <SeoDefaultsCard canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="contact" data-testid="site-settings-panel-contact" className="flex flex-col gap-4">
          <ContactDetailsCard canEdit={canEdit} />
          <ContactWhatsappCard canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="announcement" data-testid="site-settings-panel-announcement">
          <AnnouncementBarCard canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
