// apps/api/src/modules/content/content.util.spec.ts
//
// `mintCdnUrl` turns a storage key into a permanent, unauthenticated public URL, and
// several of the fields feeding it are free-text strings a CRM user types (a course's
// `ogImageKey`/`brochureKey`, a college or partner `logoKey`, a page's `seoImagePath`).
// These pin the namespace guard that stops one of those fields republishing a private
// object — and equally, pin that it does NOT break the hand-managed marketing keys the
// partners manager has always accepted.

import { mintCdnUrl } from "./content.util";
import { __resetEnvCacheForTests } from "../../config/env";
import { setMinimalEnv } from "../../common/testing/minimal-env";

const BASE = "https://cdn.example.test";

describe("mintCdnUrl", () => {
  beforeEach(() => {
    __resetEnvCacheForTests();
    setMinimalEnv();
    process.env.PUBLIC_ASSET_BASE_URL = BASE;
  });

  afterEach(() => {
    __resetEnvCacheForTests();
  });

  it("returns null for an absent key", () => {
    expect(mintCdnUrl(null)).toBeNull();
    expect(mintCdnUrl(undefined)).toBeNull();
    expect(mintCdnUrl("")).toBeNull();
  });

  it.each([
    "program_images/tenant-1/abc-hero.png",
    "marketing_images/tenant-1/abc-banner.jpg",
    "mentor_photos/tenant-1/abc-face.jpg",
    "college_logos/tenant-1/abc-logo.svg",
    "program_brochures/tenant-1/abc-brochure.pdf",
  ])("mints a URL for the publicly-served namespace %s", (key) => {
    expect(mintCdnUrl(key)).toBe(`${BASE}/${key}`);
  });

  // The leak this closes: a content editor sets `ogImageKey` to a resume key and the
  // public programme page publishes a permanent link to a stranger's CV.
  it.each([
    "careers/tenant-1/abc-resume.pdf",
    "submissions/tenant-1/enrol-1/abc-answer.pdf",
    "exports/tenant-1/job-1.csv",
    "invoices/tenant-1/inv-1.pdf",
    "receipts/tenant-1/pay-1.pdf",
    "certificates/tenant-1/cert-1.pdf",
    "onboarding/tenant-1/abc-receipt.jpg",
    "offer-letters/tenant-1/abc-offer.pdf",
    "resources/tenant-1/lesson-1/abc-notes.pdf",
    "video/source/asset-1",
  ])("refuses to publish the private key %s", (key) => {
    expect(mintCdnUrl(key)).toBeNull();
  });

  // Not every key comes from `buildStorageKey`: the partners manager takes a hand-typed
  // key for a file an operator uploaded to the bucket directly. Nothing here created it,
  // so nothing here claims to protect it — refusing these would break live logos for no
  // security gain.
  it("still mints an unmanaged, hand-typed marketing key", () => {
    expect(mintCdnUrl("partners/acme-logo.png")).toBe(`${BASE}/partners/acme-logo.png`);
    expect(mintCdnUrl("blog/how-we-scaled/cover.jpg")).toBe(`${BASE}/blog/how-we-scaled/cover.jpg`);
  });

  it("does not double up the slash when the base has a trailing one", () => {
    process.env.PUBLIC_ASSET_BASE_URL = `${BASE}/`;
    __resetEnvCacheForTests();
    expect(mintCdnUrl("program_images/t/a.png")).toBe(`${BASE}/program_images/t/a.png`);
  });
});
