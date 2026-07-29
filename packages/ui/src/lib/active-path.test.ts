import { describe, expect, it } from "vitest";

import { isPathActive } from "./active-path";

describe("isPathActive", () => {
  it("matches an exact path", () => {
    expect(isPathActive("/about", "/about")).toBe(true);
  });

  it("matches descendants of the href", () => {
    expect(isPathActive("/blog", "/blog/why-neurology")).toBe(true);
    expect(isPathActive("/programs", "/programs/certified-neurology-program")).toBe(true);
  });

  it("does not match on a bare string prefix — the boundary is a path separator", () => {
    expect(isPathActive("/blog", "/blogging")).toBe(false);
    expect(isPathActive("/for-colleges", "/for-colleges-partners")).toBe(false);
  });

  it("matches '/' only against '/' so the home link never lights up everywhere", () => {
    expect(isPathActive("/", "/")).toBe(true);
    expect(isPathActive("/", "/about")).toBe(false);
  });

  it("normalises trailing slashes on both sides", () => {
    expect(isPathActive("/about/", "/about")).toBe(true);
    expect(isPathActive("/about", "/about/")).toBe(true);
  });

  it("ignores query strings and hashes on the href", () => {
    expect(isPathActive("/blog?tag=neuro", "/blog")).toBe(true);
    expect(isPathActive("/faq#pricing", "/faq")).toBe(true);
  });

  it("never matches external or non-path hrefs", () => {
    expect(isPathActive("https://stimuliiq.com/about", "/about")).toBe(false);
    expect(isPathActive("mailto:support@stimuliiq.com", "/contact")).toBe(false);
    expect(isPathActive("#top", "/about")).toBe(false);
  });

  it("returns false when either side is missing", () => {
    expect(isPathActive(undefined, "/about")).toBe(false);
    expect(isPathActive("/about", undefined)).toBe(false);
    expect(isPathActive(null, null)).toBe(false);
  });
});
