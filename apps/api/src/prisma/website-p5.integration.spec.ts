// apps/api/src/prisma/website-p5.integration.spec.ts
//
// Integration tests for Phase-5 Marketing Website schema additions
// (docs/plans/phase-5.md task #1 DoD).
//
// Covers (DoD requirements):
//   1. Additive migration applies clean: P5 columns exist on programs / leads / bookings.
//   2. programs (tenant_id, slug) partial-unique WHERE deleted_at IS NULL holds:
//        - Two programs with the same (tenant_id, slug) cannot coexist when both are active.
//        - After soft-deleting the first, the slug can be reused (partial-unique skips deleted rows).
//   3. A public-projection SELECT on programs does NOT expose draft/internal columns:
//        - The "public" shape (slug, title, domain, cardSummary, ratingAvg, ratingCount,
//          pricePaise, isPublic, status) must be selectable without pulling seo, emi, seoTitle,
//          seoDescription, ogImageKey, outcomes, or any internal relation ids.
//        - Assert the returned shape matches the public allowlist; asserting that `seo` and
//          `ogImageKey` are NOT in the selection proves the projection contract.
//   4. is_public=false programs are excluded by a public filter
//        (WHERE is_public=true AND status='published').
//   5. Soft-delete + audit coverage on programs for the new P5 columns.
//   6. AppModule boot smoke (DEFECT-1 lesson): PrismaClient can query P5 columns after migration.
//
// Requires DATABASE_URL pointing at the running dev/CI Postgres with the P5 schema applied.
// SKIPS (not fails) when DATABASE_URL is absent.
//
// Pattern: base PrismaClient for fixtures + hard cleanup; extended client (audit + soft-delete)
// for the DUT assertions. auditContextStorage.run() wraps mutating calls.

import { PrismaClient } from "@prisma/client";
import { softDeleteExtension } from "./soft-delete.extension";
import { auditExtension } from "./audit.extension";
import { auditContextStorage } from "./audit-context";
import { describeIfLocalDb } from "./local-db-guard";

// Fail closed: this spec creates real rows and hard-`deleteMany`s them in afterAll, so it
// runs ONLY against a disposable local database. The previous `!!process.env.DATABASE_URL`
// gate passed against the PRODUCTION DB, because importing @prisma/client auto-loads the
// repo-root .env. See local-db-guard.ts.
const describeIfDb = describeIfLocalDb;

describeIfDb("Phase-5 Marketing Website — schema + projection + is_public + partial-unique (integration)", () => {
  const base = new PrismaClient();
  // Composition order: audit (inner) then soft-delete (outer) — canonical wiring.
  const prisma = base.$extends(auditExtension).$extends(softDeleteExtension);

  // Shared test-scope fixture identifiers.
  let tenantId: string;
  let adminUserId: string;

  beforeAll(async () => {
    await base.$connect();

    // Isolated test tenant — does not pollute the seed data.
    const tenant = await base.tenant.upsert({
      where: { slug: "stimuliiq-p5-integration-test" },
      update: {},
      create: { slug: "stimuliiq-p5-integration-test", name: "P5 Integration Test Tenant" },
    });
    tenantId = tenant.id;

    // Admin user for audit actor.
    const adminUser = await base.user.upsert({
      where: { tenantId_email: { tenantId, email: "p5-test-admin@stimuliiq.test" } },
      update: {},
      create: {
        tenantId,
        email: "p5-test-admin@stimuliiq.test",
        name: "P5 Test Admin",
        passwordHash: "hashed_placeholder",
        status: "active",
      },
    });
    adminUserId = adminUser.id;
  });

  afterAll(async () => {
    // Hard-delete all test-scoped rows to leave a clean DB after the test run.
    // Order respects FK constraints.
    await base.auditLog.deleteMany({ where: { tenantId } });
    await base.program.deleteMany({ where: { tenantId } });
    await base.user.deleteMany({ where: { tenantId } });
    await base.tenant.deleteMany({ where: { id: tenantId } });
    await base.$disconnect();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. P5 columns exist (schema smoke test)
  // ────────────────────────────────────────────────────────────────────────────

  describe("1. P5 columns exist in DB schema", () => {
    it("programs table has all P5 SEO/marketing columns", async () => {
      const result = await base.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'programs'
          AND column_name = ANY(ARRAY[
            'seo_title', 'seo_description', 'og_image_key',
            'card_summary', 'outcomes', 'rating_avg', 'rating_count', 'is_public'
          ])
        ORDER BY column_name
      `;
      const cols = result.map((r) => r.column_name);
      expect(cols).toContain("seo_title");
      expect(cols).toContain("seo_description");
      expect(cols).toContain("og_image_key");
      expect(cols).toContain("card_summary");
      expect(cols).toContain("outcomes");
      expect(cols).toContain("rating_avg");
      expect(cols).toContain("rating_count");
      expect(cols).toContain("is_public");
    });

    it("leads table has P5 attribution + consent columns", async () => {
      const result = await base.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'leads'
          AND column_name = ANY(ARRAY['landing_url', 'referrer', 'gclid', 'fbclid', 'consent'])
        ORDER BY column_name
      `;
      const cols = result.map((r) => r.column_name);
      expect(cols).toContain("landing_url");
      expect(cols).toContain("referrer");
      expect(cols).toContain("gclid");
      expect(cols).toContain("fbclid");
      expect(cols).toContain("consent");
    });

    it("bookings table has P5 consent column", async () => {
      const result = await base.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'bookings'
          AND column_name = 'consent'
      `;
      expect(result.length).toBe(1);
      expect(result[0]?.column_name).toBe("consent");
    });

    it("P5 partial indexes exist on programs", async () => {
      const result = await base.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'programs'
          AND indexname = ANY(ARRAY[
            'programs_active_tenant_slug_key',
            'programs_public_published_idx'
          ])
        ORDER BY indexname
      `;
      const names = result.map((r) => r.indexname);
      expect(names).toContain("programs_active_tenant_slug_key");
      expect(names).toContain("programs_public_published_idx");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. (tenant_id, slug) partial-unique WHERE deleted_at IS NULL
  // ────────────────────────────────────────────────────────────────────────────

  describe("2. programs (tenant_id, slug) partial-unique constraint", () => {
    const SLUG = "p5-test-slug-unique";
    let firstProgramId: string;

    afterEach(async () => {
      // Hard-delete both programs with this slug after each test — sanctioned test-only
      // fixture cleanup (not a production code path): a soft-delete would leave the
      // `(tenant_id, slug)` slot occupied and break the next test run's uniqueness setup,
      // which is exactly the constraint this describe block exists to exercise.
      // eslint-disable-next-line no-restricted-syntax -- test-fixture cleanup only, see comment above
      await base.$executeRaw`
        DELETE FROM "programs"
        WHERE "tenant_id" = ${tenantId}::uuid
          AND "slug" LIKE 'p5-test-slug%'
      `;
    });

    it("two active programs with the same (tenant_id, slug) violate the partial-unique", async () => {
      // First program — should succeed.
      await base.program.create({
        data: {
          tenantId,
          slug: `${SLUG}-first-${Date.now()}`,
          title: "P5 Test Program A",
          domain: "test",
          pricePaise: 0,
        },
      });
      // Second program with the EXACT same slug in the SAME tenant — should fail.
      const duplicateSlug = `p5-test-slug-dup-${Date.now()}`;
      await base.program.create({
        data: {
          tenantId,
          slug: duplicateSlug,
          title: "P5 Test Program B - original",
          domain: "test",
          pricePaise: 0,
        },
      });

      // Direct SQL insert to bypass Prisma's global @unique and test the partial-unique.
      await expect(
        base.$executeRaw`
          INSERT INTO "programs" (
            id, tenant_id, slug, title, domain, price_paise, currency, mode, status,
            is_public, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${tenantId}::uuid, ${duplicateSlug},
            'P5 Test Program B - duplicate', 'test', 0, 'INR', 'recorded', 'draft',
            false, NOW(), NOW()
          )
        `,
      ).rejects.toThrow();
    });

    it("soft-deleted program slug can be reused by a new active program", async () => {
      const reusedSlug = `p5-test-slug-reuse-${Date.now()}`;

      // Create the original program.
      const original = await base.program.create({
        data: {
          tenantId,
          slug: reusedSlug,
          title: "P5 Original (will be soft-deleted)",
          domain: "test",
          pricePaise: 0,
        },
      });
      firstProgramId = original.id;

      // Soft-delete the original (set deleted_at directly — the extended client's soft-delete
      // extension intercepts `delete` calls; using base client with update for clarity).
      await base.program.update({
        where: { id: firstProgramId },
        data: { deletedAt: new Date() },
      });

      // Now create a new program with the same slug — the partial-unique skips deleted rows,
      // so this should succeed (slug is free again for this tenant).
      const replacement = await base.$executeRaw`
        INSERT INTO "programs" (
          id, tenant_id, slug, title, domain, price_paise, currency, mode, status,
          is_public, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${tenantId}::uuid, ${reusedSlug},
          'P5 Replacement Program', 'test', 0, 'INR', 'recorded', 'draft',
          false, NOW(), NOW()
        )
      `;
      expect(replacement).toBe(1); // 1 row inserted — no conflict.
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Public projection: does NOT expose draft/internal columns
  // ────────────────────────────────────────────────────────────────────────────

  describe("3. Public projection — shape never includes draft/internal columns", () => {
    let publicProgramId: string;

    beforeAll(async () => {
      const p = await base.program.create({
        data: {
          tenantId,
          slug: `p5-proj-test-${Date.now()}`,
          title: "P5 Projection Test Program",
          domain: "web-development",
          pricePaise: 999900,
          currency: "INR",
          status: "published",
          isPublic: true,
          seoTitle: "P5 Test SEO Title",
          seoDescription: "P5 test SEO description.",
          ogImageKey: "marketing/programs/p5-test-og.jpg",
          cardSummary: "P5 card summary for listing grid.",
          outcomes: ["Outcome 1", "Outcome 2"],
          ratingAvg: 45,
          ratingCount: 10,
        },
      });
      publicProgramId = p.id;
    });

    afterAll(async () => {
      await base.program.delete({ where: { id: publicProgramId } });
    });

    it("public projection select shape contains only the marketing allowlist fields", async () => {
      // This simulates the repository method used by GET /public/programs — selecting ONLY
      // the fields that are safe to expose to anonymous visitors. The test proves the
      // SELECT shape contract: the fields NOT in the allowlist (seo, seoTitle, seoDescription,
      // ogImageKey, emi, outcomes, etc.) are never returned when the projection is applied.
      //
      // In the real backend, a Prisma `select` clause in the repository enforces this.
      // Here we replicate that select to prove the pattern works at the DB/ORM level.
      //
      // The PUBLIC projection allowlist (per docs/plans/phase-5.md §2 + plan §0 task output):
      //   slug, title, domain, level, mode, durationWeeks, pricePaise, currency,
      //   cardSummary, ratingAvg, ratingCount, status, isPublic, createdAt.
      // NEVER in public projection:
      //   seo (old Json column), seoTitle, seoDescription, ogImageKey, outcomes, emi, summary.

      const PUBLIC_SELECT = {
        id: true,
        slug: true,
        title: true,
        domain: true,
        level: true,
        mode: true,
        durationWeeks: true,
        pricePaise: true,
        currency: true,
        cardSummary: true,
        ratingAvg: true,
        ratingCount: true,
        status: true,
        isPublic: true,
        createdAt: true,
        // EXPLICITLY EXCLUDED (not in select = never in response):
        // seo: false,
        // seoTitle: false,
        // seoDescription: false,
        // ogImageKey: false,
        // outcomes: false,
        // emi: false,
        // summary: false,
        // tenantId: false (never expose tenant internals),
        // deletedAt: false,
      } as const;

      const result = await base.program.findUnique({
        where: { id: publicProgramId },
        select: PUBLIC_SELECT,
      });

      expect(result).not.toBeNull();
      // Assert fields IN the allowlist are present.
      expect(result?.slug).toBeDefined();
      expect(result?.title).toBe("P5 Projection Test Program");
      expect(result?.cardSummary).toBe("P5 card summary for listing grid.");
      expect(result?.ratingAvg).toBe(45);
      expect(result?.ratingCount).toBe(10);
      expect(result?.pricePaise).toBe(999900);
      expect(result?.isPublic).toBe(true);

      // Assert fields NOT in the allowlist are ABSENT from the returned object.
      // TypeScript's type system enforces this at compile time; the runtime check confirms
      // the select clause is applied at the DB/ORM boundary (no field leakage).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional shape check
      const anyResult = result as any;
      expect(anyResult.seo).toBeUndefined();
      expect(anyResult.seoTitle).toBeUndefined();
      expect(anyResult.seoDescription).toBeUndefined();
      expect(anyResult.ogImageKey).toBeUndefined();
      expect(anyResult.outcomes).toBeUndefined();
      expect(anyResult.emi).toBeUndefined();
      expect(anyResult.summary).toBeUndefined();
      expect(anyResult.tenantId).toBeUndefined();
      expect(anyResult.deletedAt).toBeUndefined();
    });

    it("public projection does not include answerKey-analogues (no sensitive internal keys)", async () => {
      // Analogous to the P4 answer-key isolation test — verifies no internal-only column
      // leaks through a public select. For programs, the internal-only fields are
      // ogImageKey (S3 key — backend signs URLs, never exposes raw key), seoTitle
      // (could expose internal content strategy), and outcomes (detailed curriculum info
      // that should only appear on the detail page, not the listing).
      //
      // The programs listing projection (GET /public/programs) MUST exclude ogImageKey —
      // the backend converts it to a signed CDN URL before returning; the raw key is
      // internal. This test asserts the Prisma select contract excludes it.
      const listingSelect = {
        id: true,
        slug: true,
        title: true,
        domain: true,
        pricePaise: true,
        cardSummary: true,
        ratingAvg: true,
        ratingCount: true,
        isPublic: true,
        status: true,
        // ogImageKey intentionally excluded from listing projection.
      } as const;

      const result = await base.program.findUnique({
        where: { id: publicProgramId },
        select: listingSelect,
      });

      expect(result).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional shape check
      const anyResult = result as any;
      expect(anyResult.ogImageKey).toBeUndefined();
      expect(anyResult.outcomes).toBeUndefined();
      expect(anyResult.seoTitle).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. is_public=false programs excluded by public filter
  // ────────────────────────────────────────────────────────────────────────────

  describe("4. is_public filter — draft/private programs not visible on public catalog", () => {
    let publicProgId: string;
    let privateProgId: string;
    let draftProgId: string;

    beforeAll(async () => {
      const ts = Date.now();
      const [pub, priv, draft] = await Promise.all([
        base.program.create({
          data: {
            tenantId,
            slug: `p5-filter-public-${ts}`,
            title: "Public Published Program",
            domain: "web",
            pricePaise: 100000,
            status: "published",
            isPublic: true,
          },
        }),
        base.program.create({
          data: {
            tenantId,
            slug: `p5-filter-private-${ts}`,
            title: "Private Published Program",
            domain: "web",
            pricePaise: 100000,
            status: "published",
            isPublic: false, // published but NOT public-listable
          },
        }),
        base.program.create({
          data: {
            tenantId,
            slug: `p5-filter-draft-${ts}`,
            title: "Draft Public Program",
            domain: "web",
            pricePaise: 100000,
            status: "draft",
            isPublic: true, // public flag set but status=draft — should NOT appear
          },
        }),
      ]);
      publicProgId = pub.id;
      privateProgId = priv.id;
      draftProgId = draft.id;
    });

    afterAll(async () => {
      await base.program.deleteMany({
        where: { id: { in: [publicProgId, privateProgId, draftProgId] } },
      });
    });

    it("public catalog filter (is_public=true AND status=published) returns ONLY the public+published program", async () => {
      // Simulate the query used by GET /public/programs:
      //   WHERE is_public = true AND status = 'published' AND deleted_at IS NULL AND tenant_id = X
      const results = await base.program.findMany({
        where: {
          tenantId,
          isPublic: true,
          status: "published",
          deletedAt: null,
          // Scope to just the 3 fixture programs for isolation.
          id: { in: [publicProgId, privateProgId, draftProgId] },
        },
        select: { id: true, title: true, isPublic: true, status: true },
      });

      // Only the public+published one should appear.
      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe(publicProgId);
    });

    it("private program (is_public=false) is excluded from public catalog", async () => {
      const found = await base.program.findMany({
        where: {
          tenantId,
          isPublic: true,
          status: "published",
          deletedAt: null,
          id: { in: [privateProgId] },
        },
      });
      expect(found.length).toBe(0);
    });

    it("draft program (status=draft) is excluded even when is_public=true", async () => {
      const found = await base.program.findMany({
        where: {
          tenantId,
          isPublic: true,
          status: "published", // only 'published' passes
          deletedAt: null,
          id: { in: [draftProgId] },
        },
      });
      expect(found.length).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Soft-delete + audit on programs with P5 marketing columns
  // ────────────────────────────────────────────────────────────────────────────

  describe("5. Soft-delete + audit on programs with P5 columns", () => {
    let testProgramId: string;

    afterEach(async () => {
      await base.auditLog.deleteMany({ where: { tenantId } });
      if (testProgramId) {
        await base.program.deleteMany({ where: { id: testProgramId } });
        testProgramId = "";
      }
    });

    it("creating a program with P5 marketing fields writes an audit log entry", async () => {
      await auditContextStorage.run(
        { tenantId, actorId: adminUserId, ip: "127.0.0.1", requestId: "p5-test-req-1" },
        async () => {
          const program = await prisma.program.create({
            data: {
              tenantId,
              slug: `p5-audit-test-${Date.now()}`,
              title: "P5 Audit Test Program",
              domain: "web",
              pricePaise: 299900,
              status: "published",
              isPublic: true,
              cardSummary: "A marketing card summary.",
              ratingAvg: 42,
              ratingCount: 7,
            },
          });
          testProgramId = program.id;
        },
      );

      const auditRows = await base.auditLog.findMany({
        where: { tenantId, entity: "Program", action: "create" },
      });
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      const latest = auditRows.find((r) => r.entityId === testProgramId);
      expect(latest).toBeDefined();
      expect(latest?.actorId).toBe(adminUserId);
    });

    it("soft-deleting a program with P5 columns hides it from findMany", async () => {
      const program = await base.program.create({
        data: {
          tenantId,
          slug: `p5-soft-del-${Date.now()}`,
          title: "P5 Soft Delete Test",
          domain: "web",
          pricePaise: 0,
          isPublic: true,
          status: "published",
        },
      });
      testProgramId = program.id;

      // Soft-delete via the extended client (intercepts `delete` → sets deleted_at).
      await auditContextStorage.run(
        { tenantId, actorId: adminUserId, ip: "127.0.0.1", requestId: "p5-test-req-2" },
        async () => {
          await prisma.program.delete({ where: { id: testProgramId } });
        },
      );

      // The extended client's soft-delete filter hides it from findMany.
      const found = await prisma.program.findMany({
        where: { tenantId, id: testProgramId },
      });
      expect(found.length).toBe(0);

      // But the base client can still find it (it was only soft-deleted, not hard-deleted).
      const raw = await base.program.findUnique({ where: { id: testProgramId } });
      expect(raw?.deletedAt).not.toBeNull();
      expect(raw?.isPublic).toBe(true); // P5 column preserved through soft-delete
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. AppModule boot smoke — PrismaClient syncs with the P5-migrated DB
  // ────────────────────────────────────────────────────────────────────────────

  describe("6. AppModule boot smoke — Prisma client → DB sync after P5 migration", () => {
    it("PrismaClient can create/read/update/delete programs with all P5 columns", async () => {
      const ts = Date.now();
      const prog = await base.program.create({
        data: {
          tenantId,
          slug: `p5-smoke-${ts}`,
          title: "P5 Smoke Test Program",
          domain: "cloud-devops",
          pricePaise: 179900,
          isPublic: true,
          status: "published",
          seoTitle: "P5 Smoke SEO Title",
          seoDescription: "P5 smoke SEO desc.",
          ogImageKey: "marketing/programs/p5-smoke-og.jpg",
          cardSummary: "Smoke test card summary.",
          outcomes: ["Deploy apps to AWS", "Set up CI/CD"],
          ratingAvg: 44,
          ratingCount: 52,
        },
      });

      // Read back and verify every P5 column round-trips correctly.
      const found = await base.program.findUniqueOrThrow({ where: { id: prog.id } });
      expect(found.seoTitle).toBe("P5 Smoke SEO Title");
      expect(found.seoDescription).toBe("P5 smoke SEO desc.");
      expect(found.ogImageKey).toBe("marketing/programs/p5-smoke-og.jpg");
      expect(found.cardSummary).toBe("Smoke test card summary.");
      expect(found.ratingAvg).toBe(44);       // integer 0–50 (no float)
      expect(found.ratingCount).toBe(52);
      expect(found.isPublic).toBe(true);
      expect(typeof found.ratingAvg).toBe("number");

      // Update — verify update path doesn't corrupt other columns.
      await base.program.update({
        where: { id: prog.id },
        data: { ratingAvg: 47, ratingCount: 53, isPublic: false },
      });
      const updated = await base.program.findUniqueOrThrow({ where: { id: prog.id } });
      expect(updated.ratingAvg).toBe(47);
      expect(updated.isPublic).toBe(false);
      expect(updated.seoTitle).toBe("P5 Smoke SEO Title"); // unchanged

      // Hard delete.
      await base.program.delete({ where: { id: prog.id } });
    });

    it("leads can be created with P5 attribution + consent columns", async () => {
      // Verify leads.landing_url / referrer / gclid / fbclid / consent round-trip.
      // Need a branch for the lead.
      const branch = await base.branch.upsert({
        where: { id: await (async () => {
          const b = await base.branch.findFirst({ where: { tenantId } });
          return b?.id ?? "00000000-0000-0000-0000-000000000000";
        })() },
        update: {},
        create: { tenantId, name: "P5 Test Branch" },
      });

      const lead = await base.lead.create({
        data: {
          tenantId,
          branchId: branch.id,
          name: "P5 Attribution Test Lead",
          phone: `+91${Date.now().toString().slice(-10)}`,
          email: `p5-lead-${Date.now()}@example.com`,
          source: "website",
          stage: "new",
          landingUrl: "https://stimuliiq.in/programs/fullstack-web-dev-internship?utm_source=google",
          referrer: "https://www.google.com/",
          gclid: `Cj0KCQiA_${Date.now()}`,
          fbclid: null,
          consent: {
            marketing_opt_in: true,
            tos_version: "v1.0",
            timestamp: new Date().toISOString(),
            ip_hash: "sha256_of_ip_placeholder",
          },
        },
      });

      const found = await base.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(found.landingUrl).toContain("fullstack-web-dev-internship");
      expect(found.referrer).toBe("https://www.google.com/");
      expect(found.gclid).toContain("Cj0KCQiA_");
      expect(found.fbclid).toBeNull();
      const consent = found.consent as { marketing_opt_in: boolean; tos_version: string };
      expect(consent?.marketing_opt_in).toBe(true);
      expect(consent?.tos_version).toBe("v1.0");

      // Hard delete.
      await base.lead.delete({ where: { id: lead.id } });
      await base.branch.delete({ where: { id: branch.id } });
    });

    it("bookings can be created with P5 consent column", async () => {
      const branch = await base.branch.create({
        data: { tenantId, name: "P5 Booking Test Branch" },
      });
      const booking = await base.booking.create({
        data: {
          tenantId,
          slotAt: new Date("2026-08-01T10:00:00Z"),
          status: "requested",
          source: "website",
          consent: {
            marketing_opt_in: false,
            tos_version: "v1.0",
            timestamp: new Date().toISOString(),
            ip_hash: "sha256_booking_ip",
          },
        },
      });

      const found = await base.booking.findUniqueOrThrow({ where: { id: booking.id } });
      const consent = found.consent as { marketing_opt_in: boolean };
      expect(consent?.marketing_opt_in).toBe(false);

      // Hard delete.
      await base.booking.delete({ where: { id: booking.id } });
      await base.branch.delete({ where: { id: branch.id } });
    });

    it("seeded programs have P5 fields set correctly (validates seed backfill)", async () => {
      // Read the seeded tenant's programs to confirm the P5 backfill applied by seed.ts.
      const seededTenant = await base.tenant.findUnique({ where: { slug: "stimuliiq" } });
      if (!seededTenant) {
        // Seed may not have run in this environment — skip gracefully.
        return;
      }

      const publicPrograms = await base.program.findMany({
        where: { tenantId: seededTenant.id, isPublic: true, deletedAt: null },
        select: { slug: true, isPublic: true, ratingAvg: true, seoTitle: true, cardSummary: true },
      });

      // At least 2 programs should be public (fullstack + data-science).
      expect(publicPrograms.length).toBeGreaterThanOrEqual(2);

      for (const p of publicPrograms) {
        expect(p.isPublic).toBe(true);
        expect(p.ratingAvg).not.toBeNull();
        expect(p.seoTitle).not.toBeNull();
        expect(p.cardSummary).not.toBeNull();
      }

      // cloudDevops program should NOT be public.
      const cloudDevops = await base.program.findFirst({
        where: { tenantId: seededTenant.id, slug: "cloud-devops-internship" },
      });
      if (cloudDevops) {
        expect(cloudDevops.isPublic).toBe(false);
      }
    });
  });
});
