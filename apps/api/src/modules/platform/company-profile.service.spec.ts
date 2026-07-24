// Unit tests for CompanyProfileService — resolves company-scope settings into a profile
// with defaults, and reads via SettingsRepository (no request scope), so it works in the
// worker/invoice-gen context.

import { CompanyProfileService, DEFAULT_COMPANY_LEGAL_NAME } from "./company-profile.service";
import { SettingsRepository } from "./settings.repository";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockSettingsRepository(): Mocked<SettingsRepository> {
  return {
    list: jest.fn(),
    findByScopeAndKey: jest.fn(),
    upsert: jest.fn(),
  } as unknown as Mocked<SettingsRepository>;
}

/** Build a stored Setting row (only the fields the service reads). */
function settingRow(key: string, value: unknown) {
  return { id: `s-${key}`, tenantId: "tenant-1", scope: "company", key, value } as unknown as Awaited<
    ReturnType<SettingsRepository["findByScopeAndKey"]>
  >;
}

describe("CompanyProfileService", () => {
  let repo: Mocked<SettingsRepository>;
  let service: CompanyProfileService;

  beforeEach(() => {
    repo = mockSettingsRepository();
    service = new CompanyProfileService(repo as unknown as SettingsRepository);
  });

  it("falls back to the platform brand and nulls when nothing is set", async () => {
    repo.findByScopeAndKey.mockResolvedValue(null);

    const profile = await service.resolve("tenant-1");

    expect(profile).toEqual({
      legalName: DEFAULT_COMPANY_LEGAL_NAME,
      supportEmail: null,
      supportPhone: null,
      websiteUrl: null,
      address: null,
    });
    // Reads company scope (not system), tenant-scoped by argument.
    expect(repo.findByScopeAndKey).toHaveBeenCalledWith("tenant-1", "company", "company.legalName");
  });

  it("resolves configured values and trims whitespace", async () => {
    repo.findByScopeAndKey.mockImplementation((_tenantId: string, _scope: string, key: string) => {
      const values: Record<string, unknown> = {
        "company.legalName": "  Acme Learning Pvt. Ltd.  ",
        "company.supportEmail": "help@acme.test",
        "company.supportPhone": "+91 98765 43210",
        "company.websiteUrl": "https://acme.test",
        "company.address": "1 MG Road, Bengaluru",
      };
      return Promise.resolve(key in values ? settingRow(key, values[key]) : null);
    });

    const profile = await service.resolve("tenant-1");

    expect(profile).toEqual({
      legalName: "Acme Learning Pvt. Ltd.",
      supportEmail: "help@acme.test",
      supportPhone: "+91 98765 43210",
      websiteUrl: "https://acme.test",
      address: "1 MG Road, Bengaluru",
    });
  });

  it("ignores non-string / blank values (e.g. JSON set via the Advanced editor) and uses the default name", async () => {
    repo.findByScopeAndKey.mockImplementation((_tenantId: string, _scope: string, key: string) => {
      const values: Record<string, unknown> = {
        "company.legalName": "   ", // blank → default
        "company.supportEmail": { not: "a string" }, // wrong type → null
      };
      return Promise.resolve(key in values ? settingRow(key, values[key]) : null);
    });

    const profile = await service.resolve("tenant-1");

    expect(profile.legalName).toBe(DEFAULT_COMPANY_LEGAL_NAME);
    expect(profile.supportEmail).toBeNull();
  });
});
