/**
 * Tests for useUtm / parseUtmFromSearch (unit, no DOM needed for the parser).
 *
 * Covers:
 *   - AC-2: UTM params absent → utm: {} (all fields undefined)
 *   - AC-1: UTM params present → captured correctly
 *   - gclid/fbclid extraction
 *   - landingUrl + referrer capture
 *   - utmCaptureToSdkUtm mapping
 */

import { describe, it, expect } from "vitest";
import { parseUtmFromSearch, utmCaptureToSdkUtm } from "./use-utm";

describe("parseUtmFromSearch", () => {
  it("returns empty UtmCapture when no UTM params are present (AC-2)", () => {
    const search = new URLSearchParams("");
    const result = parseUtmFromSearch(search);
    expect(result.utmSource).toBeUndefined();
    expect(result.utmMedium).toBeUndefined();
    expect(result.utmCampaign).toBeUndefined();
    expect(result.utmContent).toBeUndefined();
    expect(result.utmTerm).toBeUndefined();
    expect(result.gclid).toBeUndefined();
    expect(result.fbclid).toBeUndefined();
  });

  it("captures all UTM params from search string (AC-1)", () => {
    const search = new URLSearchParams(
      "utm_source=google&utm_medium=cpc&utm_campaign=summer&utm_content=ad1&utm_term=python",
    );
    const result = parseUtmFromSearch(search, "https://example.com/", "https://google.com");
    expect(result.utmSource).toBe("google");
    expect(result.utmMedium).toBe("cpc");
    expect(result.utmCampaign).toBe("summer");
    expect(result.utmContent).toBe("ad1");
    expect(result.utmTerm).toBe("python");
    expect(result.landingUrl).toBe("https://example.com/");
    expect(result.referrer).toBe("https://google.com");
  });

  it("captures gclid and fbclid (attribution IDs)", () => {
    const search = new URLSearchParams("gclid=Cj0abc123&fbclid=IwAR456xyz");
    const result = parseUtmFromSearch(search);
    expect(result.gclid).toBe("Cj0abc123");
    expect(result.fbclid).toBe("IwAR456xyz");
  });

  it("captures landingUrl and referrer", () => {
    const search = new URLSearchParams("");
    const result = parseUtmFromSearch(
      search,
      "https://stimuliiq.com/programs/python?ref=test",
      "https://linkedin.com",
    );
    expect(result.landingUrl).toBe("https://stimuliiq.com/programs/python?ref=test");
    expect(result.referrer).toBe("https://linkedin.com");
  });

  it("treats empty referrer as undefined", () => {
    const search = new URLSearchParams("");
    const result = parseUtmFromSearch(search, "https://example.com", "");
    expect(result.referrer).toBeUndefined();
  });

  it("handles partial UTM params (only some present)", () => {
    const search = new URLSearchParams("utm_source=facebook&utm_campaign=launch");
    const result = parseUtmFromSearch(search);
    expect(result.utmSource).toBe("facebook");
    expect(result.utmCampaign).toBe("launch");
    expect(result.utmMedium).toBeUndefined();
    expect(result.utmContent).toBeUndefined();
    expect(result.utmTerm).toBeUndefined();
  });
});

describe("utmCaptureToSdkUtm", () => {
  it("maps UtmCapture fields to SDK utm object keys", () => {
    const capture = {
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "summer",
      utmContent: "banner",
      utmTerm: "python",
    };
    const result = utmCaptureToSdkUtm(capture);
    expect(result.source).toBe("google");
    expect(result.medium).toBe("cpc");
    expect(result.campaign).toBe("summer");
    expect(result.content).toBe("banner");
    expect(result.term).toBe("python");
  });

  it("returns undefined for absent UTM fields (AC-2: utm: {} when no params)", () => {
    const result = utmCaptureToSdkUtm({});
    expect(result.source).toBeUndefined();
    expect(result.medium).toBeUndefined();
    expect(result.campaign).toBeUndefined();
    expect(result.content).toBeUndefined();
    expect(result.term).toBeUndefined();
  });

  it("does NOT include gclid/fbclid/landingUrl/referrer (those go directly to the SDK)", () => {
    const result = utmCaptureToSdkUtm({ gclid: "abc", fbclid: "xyz", landingUrl: "https://x.com" });
    expect(Object.keys(result)).toEqual(["source", "medium", "campaign", "content", "term"]);
    expect("gclid" in result).toBe(false);
  });
});
