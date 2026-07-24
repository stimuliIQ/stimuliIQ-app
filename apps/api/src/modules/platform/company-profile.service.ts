// apps/api/src/modules/platform/company-profile.service.ts
//
// Resolves the tenant's company profile (legal name, support contact, address) from the
// company-scope `settings` a CRM admin edits under Settings → Company. This is the first
// consumer that makes those settings actually DO something: generated invoices are
// stamped with the configured company name instead of a hard-coded brand, so staff can
// rebrand billing documents without a deploy.
//
// Reads via SettingsRepository directly (NOT SettingsService) on purpose: invoice
// generation runs in the BullMQ worker / async job context where there is NO request
// `requireScopeContext()` — SettingsService.get() would throw there. The repository read
// is tenant-scoped by argument and needs no request scope.

import { Injectable } from "@nestjs/common";
import { SettingsRepository } from "./settings.repository";

export interface CompanyProfile {
  /** Always present — falls back to the platform brand when unset. */
  legalName: string;
  supportEmail: string | null;
  supportPhone: string | null;
  websiteUrl: string | null;
  address: string | null;
}

/** Brand identity used when a tenant has not set its `company.*` settings yet. */
export const DEFAULT_COMPANY_LEGAL_NAME = "Stimuliiq";

@Injectable()
export class CompanyProfileService {
  constructor(private readonly settings: SettingsRepository) {}

  async resolve(tenantId: string): Promise<CompanyProfile> {
    const [legalName, supportEmail, supportPhone, websiteUrl, address] = await Promise.all([
      this.readString(tenantId, "company.legalName"),
      this.readString(tenantId, "company.supportEmail"),
      this.readString(tenantId, "company.supportPhone"),
      this.readString(tenantId, "company.websiteUrl"),
      this.readString(tenantId, "company.address"),
    ]);
    return {
      legalName: legalName ?? DEFAULT_COMPANY_LEGAL_NAME,
      supportEmail,
      supportPhone,
      websiteUrl,
      address,
    };
  }

  /** Reads a company-scope setting as a trimmed non-empty string, or null. */
  private async readString(tenantId: string, key: string): Promise<string | null> {
    const row = await this.settings.findByScopeAndKey(tenantId, "company", key);
    const value = row?.value;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
}
