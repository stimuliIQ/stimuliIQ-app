/**
 * JSON-LD helper tests, core escaping + builder functions.
 *
 * Critical security assertion: AC-33 / P4 L-1
 *   - `escapeJsonLd` MUST NOT allow `</script>` to appear in output.
 *   - Any `<` character in user-controlled strings must be escaped as `<`.
 *
 * No DOM/React required, pure string/function tests.
 */

import { describe, expect, it } from "vitest";
import {
  escapeJsonLd,
  buildOrganizationJsonLd,
  buildArticleJsonLd,
  buildFaqJsonLd,
  buildBreadcrumbJsonLd,
  buildCourseJsonLd,
  type FaqJsonLdItem,
  type BreadcrumbItem,
} from "./json-ld";

// Type assertions to ensure unused import warnings don't break the test
// (these types are used in the test fixture declarations below)
type _FaqJsonLdItem = FaqJsonLdItem;
type _BreadcrumbItem = BreadcrumbItem;

// ---------------------------------------------------------------------------
// escapeJsonLd, the core security invariant
// ---------------------------------------------------------------------------

describe("escapeJsonLd", () => {
  it("serialises a plain object as JSON", () => {
    const result = escapeJsonLd({ hello: "world" });
    expect(JSON.parse(result)).toEqual({ hello: "world" });
  });

  it("escapes `<` to \\u003c, preventing </script> breakout (AC-33 / P4 L-1)", () => {
    const malicious = { name: "</script><script>alert(1)</script>" };
    const result = escapeJsonLd(malicious);
    // The literal string `</script>` must NOT appear anywhere in the output.
    expect(result).not.toContain("</script>");
    // The escaped form must appear instead.
    expect(result).toContain("\\u003c");
  });

  it("handles deeply nested user strings with script-breakout attempts", () => {
    const data = {
      a: {
        b: {
          c: "</script><script>alert('xss')</script>",
        },
      },
    };
    const result = escapeJsonLd(data);
    expect(result).not.toContain("</script>");
    // Parses back correctly
    const parsed = JSON.parse(result) as typeof data;
    expect(parsed.a.b.c).toBe("</script><script>alert('xss')</script>");
  });

  it("does not break on strings with no angle brackets", () => {
    const data = { name: "StimuliiQ Course", price: 9999 };
    const result = escapeJsonLd(data);
    expect(result).toBe(JSON.stringify(data));
  });

  it("preserves numeric, boolean, null values unchanged", () => {
    const data = { num: 42, flag: true, nothing: null };
    const result = escapeJsonLd(data);
    const parsed = JSON.parse(result) as typeof data;
    expect(parsed.num).toBe(42);
    expect(parsed.flag).toBe(true);
    expect(parsed.nothing).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildOrganizationJsonLd
// ---------------------------------------------------------------------------

describe("buildOrganizationJsonLd", () => {
  it("returns a valid JSON string", () => {
    const result = buildOrganizationJsonLd();
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("contains @type EducationalOrganization", () => {
    const parsed = JSON.parse(buildOrganizationJsonLd()) as { "@type": string };
    expect(parsed["@type"]).toBe("EducationalOrganization");
  });

  it("does not contain </script>", () => {
    expect(buildOrganizationJsonLd()).not.toContain("</script>");
  });

  it("includes sameAs array when provided", () => {
    const result = JSON.parse(
      buildOrganizationJsonLd({ sameAs: ["https://linkedin.com/company/test"] }),
    ) as { sameAs: string[] };
    expect(result.sameAs).toContain("https://linkedin.com/company/test");
  });

  it("escapes malicious logo URL", () => {
    const result = buildOrganizationJsonLd({ logoUrl: "</script><img>" });
    expect(result).not.toContain("</script>");
  });
});

// ---------------------------------------------------------------------------
// buildArticleJsonLd
// ---------------------------------------------------------------------------

describe("buildArticleJsonLd", () => {
  const BASE_OPTS = {
    headline: "Test Article",
    description: "Test description",
    url: "https://stimuliiq.com/blog/test",
    authorName: "Jane Doe",
    publishedAt: "2026-01-01",
    type: "BlogPosting" as const,
  };

  it("returns a valid JSON string", () => {
    expect(() => JSON.parse(buildArticleJsonLd(BASE_OPTS))).not.toThrow();
  });

  it("sets @type to BlogPosting when type=BlogPosting", () => {
    const parsed = JSON.parse(buildArticleJsonLd(BASE_OPTS)) as { "@type": string };
    expect(parsed["@type"]).toBe("BlogPosting");
  });

  it("sets @type to Article when type=Article", () => {
    const parsed = JSON.parse(
      buildArticleJsonLd({ ...BASE_OPTS, type: "Article" }),
    ) as { "@type": string };
    expect(parsed["@type"]).toBe("Article");
  });

  it("does not contain </script>", () => {
    expect(buildArticleJsonLd(BASE_OPTS)).not.toContain("</script>");
  });

  it("escapes malicious content in headline", () => {
    const result = buildArticleJsonLd({
      ...BASE_OPTS,
      headline: "Normal </script><script>alert(1)</script> title",
    });
    expect(result).not.toContain("</script>");
  });
});

// ---------------------------------------------------------------------------
// buildFaqJsonLd (re-export with escaping)
// ---------------------------------------------------------------------------

describe("buildFaqJsonLd", () => {
  const FAQ_ITEMS = [
    { question: "What is StimuliiQ?", answerText: "A training platform." },
    { question: "How long are programs?", answerText: "8–16 weeks." },
  ];

  it("returns a valid JSON string", () => {
    expect(() => JSON.parse(buildFaqJsonLd(FAQ_ITEMS))).not.toThrow();
  });

  it("contains @type FAQPage", () => {
    const parsed = JSON.parse(buildFaqJsonLd(FAQ_ITEMS)) as { "@type": string };
    expect(parsed["@type"]).toBe("FAQPage");
  });

  it("does not contain </script>", () => {
    expect(buildFaqJsonLd(FAQ_ITEMS)).not.toContain("</script>");
  });

  it("escapes malicious answer text", () => {
    const malicious = [
      {
        question: "Q?",
        answerText: "Answer with </script><script>alert(1)</script>",
      },
    ];
    expect(buildFaqJsonLd(malicious)).not.toContain("</script>");
  });

  it("handles empty items array", () => {
    const result = buildFaqJsonLd([]);
    const parsed = JSON.parse(result) as { mainEntity: unknown[] };
    expect(parsed.mainEntity).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildBreadcrumbJsonLd (re-export with escaping)
// ---------------------------------------------------------------------------

describe("buildBreadcrumbJsonLd", () => {
  const BREADCRUMBS = [
    { label: "Home", href: "/" },
    { label: "Programs", href: "/programs" },
    { label: "Python for Data Science" },
  ];

  it("returns a valid JSON string", () => {
    expect(() => JSON.parse(buildBreadcrumbJsonLd(BREADCRUMBS))).not.toThrow();
  });

  it("contains @type BreadcrumbList", () => {
    const parsed = JSON.parse(buildBreadcrumbJsonLd(BREADCRUMBS)) as { "@type": string };
    expect(parsed["@type"]).toBe("BreadcrumbList");
  });

  it("does not contain </script>", () => {
    expect(buildBreadcrumbJsonLd(BREADCRUMBS)).not.toContain("</script>");
  });

  it("assigns correct positions (1-indexed)", () => {
    const parsed = JSON.parse(buildBreadcrumbJsonLd(BREADCRUMBS)) as {
      itemListElement: Array<{ position: number; name: string }>;
    };
    // Use non-null assertions, we control the breadcrumbs fixture (3 items)
    expect(parsed.itemListElement[0]!.position).toBe(1);
    expect(parsed.itemListElement[1]!.position).toBe(2);
    expect(parsed.itemListElement[2]!.position).toBe(3);
  });

  it("uses baseUrl for href items", () => {
    const result = JSON.parse(
      buildBreadcrumbJsonLd(BREADCRUMBS, "https://stimuliiq.com"),
    ) as {
      itemListElement: Array<{ item?: string }>;
    };
    expect(result.itemListElement[0]!.item).toBe("https://stimuliiq.com/");
  });

  it("omits `item` for the last crumb (no href = current page)", () => {
    const result = JSON.parse(buildBreadcrumbJsonLd(BREADCRUMBS)) as {
      itemListElement: Array<{ item?: string }>;
    };
    expect(result.itemListElement[2]!.item).toBeUndefined();
  });

  it("escapes malicious label", () => {
    const crumbs = [{ label: "Home</script><script>alert(1)", href: "/" }];
    expect(buildBreadcrumbJsonLd(crumbs)).not.toContain("</script>");
  });
});

// ---------------------------------------------------------------------------
// buildCourseJsonLd
// ---------------------------------------------------------------------------

describe("buildCourseJsonLd", () => {
  const COURSE_OPTS = {
    name: "Full Stack Web Development",
    description: "Learn MERN stack in 16 weeks.",
    url: "https://stimuliiq.com/programs/full-stack",
    pricePaise: 1999900, // ₹19,999
    duration: "16 weeks",
    ratingValue: 4.8,
    ratingCount: 250,
  };

  it("returns a valid JSON string", () => {
    expect(() => JSON.parse(buildCourseJsonLd(COURSE_OPTS))).not.toThrow();
  });

  it("contains @type Course", () => {
    const parsed = JSON.parse(buildCourseJsonLd(COURSE_OPTS)) as { "@type": string };
    expect(parsed["@type"]).toBe("Course");
  });

  it("does not contain </script>", () => {
    expect(buildCourseJsonLd(COURSE_OPTS)).not.toContain("</script>");
  });

  it("converts paise to INR correctly (1999900 paise = 19999.00 INR)", () => {
    const parsed = JSON.parse(buildCourseJsonLd(COURSE_OPTS)) as {
      offers: { price: string; priceCurrency: string };
    };
    expect(parsed.offers.price).toBe("19999.00");
    expect(parsed.offers.priceCurrency).toBe("INR");
  });

  it("includes aggregateRating when ratingValue and ratingCount are provided", () => {
    const parsed = JSON.parse(buildCourseJsonLd(COURSE_OPTS)) as {
      aggregateRating: { ratingValue: string; reviewCount: number };
    };
    expect(parsed.aggregateRating).toBeDefined();
    expect(parsed.aggregateRating.ratingValue).toBe("4.8");
    expect(parsed.aggregateRating.reviewCount).toBe(250);
  });

  it("omits aggregateRating when ratingCount is 0", () => {
    const parsed = JSON.parse(
      buildCourseJsonLd({ ...COURSE_OPTS, ratingCount: 0 }),
    ) as { aggregateRating?: unknown };
    expect(parsed.aggregateRating).toBeUndefined();
  });

  it("escapes malicious course name", () => {
    const result = buildCourseJsonLd({
      ...COURSE_OPTS,
      name: "Course </script><script>alert(1)</script> title",
    });
    expect(result).not.toContain("</script>");
  });
});
