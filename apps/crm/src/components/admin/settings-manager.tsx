// Settings — system + company scope config (curated typed catalog + a raw
// advanced escape hatch), plus a personal two-factor-authentication section.
// Phase 9 Completion T23/T28/T39/T40; typed-catalog UX upgrade.
import * as React from "react";
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { hasPermission } from "../../lib/permissions";
import { SettingsCatalogPanel } from "./settings-catalog-panel";
import { TwoFactorPanel } from "./two-factor-panel";

export function SettingsManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canEdit = hasPermission(me?.permissions, "settings.edit");

  return (
    <div className="space-y-6 md:space-y-8" data-testid="settings-manager">
      <PageHeader
        title="Settings"
        description="Platform-wide and tenant-configurable settings, plus your own account security."
      />

      <Tabs defaultValue="system">
        <TabsList aria-label="Settings sections">
          <TabsTrigger value="system" data-testid="settings-tab-system">
            System
          </TabsTrigger>
          <TabsTrigger value="company" data-testid="settings-tab-company">
            Company
          </TabsTrigger>
          <TabsTrigger value="two-factor" data-testid="settings-tab-two-factor">
            Two-factor authentication
          </TabsTrigger>
        </TabsList>
        <TabsContent value="system" data-testid="settings-panel-system">
          <SettingsCatalogPanel scope="system" canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="company" data-testid="settings-panel-company">
          <SettingsCatalogPanel scope="company" canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="two-factor" data-testid="settings-panel-two-factor">
          <TwoFactorPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
