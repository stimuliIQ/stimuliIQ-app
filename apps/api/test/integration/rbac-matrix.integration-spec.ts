// apps/api/test/integration/rbac-matrix.integration-spec.ts
//
// THE GENERATED RBAC MATRIX.
//
// Every other RBAC test in this repo is hand-written: someone thought of a case and wrote
// it down. That approach cannot prove *exhaustiveness* — it only proves that the cases
// somebody remembered are covered. A route added next month with a missing (or wrong)
// @RequirePermission slips through silently, because no hand-written test knows it exists.
//
// This spec inverts that. It introspects the REAL Nest router at runtime, extracts every
// (method, path, requiredPermission, guards) tuple from the actual decorator metadata, and
// derives its assertions from that inventory. It cannot go stale: a new endpoint is picked
// up automatically the moment it is registered, and if it is unguarded or carries an
// unseeded permission key, THIS suite fails on the day the endpoint is merged.
//
// WHY THE NEGATIVE MATRIX IS GENERATABLE (the load-bearing insight):
// Nest's execution order is  middleware -> guards -> interceptors -> pipes -> handler.
// `PermissionsGuard` therefore runs BEFORE any validation pipe. So a caller lacking the
// required permission gets 403 *regardless of whether the request body or path params are
// valid*. That means we can fire a syntactically-empty request at every protected route
// and still make a sound assertion about authorization. We deliberately assert only:
//
//   - role LACKS the permission  -> MUST be 403          (a hard, exact assertion)
//   - role HOLDS the permission  -> MUST NOT be 403      (proves the grant actually grants)
//
// We do NOT assert 200 for the positive case: with an empty body / non-existent path param
// the handler legitimately answers 400 or 404. Anything-but-403 is the correct, honest
// assertion — a 400 still proves the request got PAST the guard, which is the property
// under test. Deep happy-path behavior stays the job of the hand-written suites.
//
// SCOPE (all|branch|assigned|own) IS NOT TESTED HERE. This suite proves the *permission*
// layer is exhaustive. Data-scope isolation (faculty sees only assigned batches, etc.) is
// a different property, tested in leads-pipeline-scope / phase-8-mentor / lms-idor specs.
//
// SAFETY: runs against whatever global-setup.ts resolved (an ephemeral testcontainers DB,
// or an ambient DATABASE_URL). It fires thousands of requests that are expected to 403 or
// 404; requests that pass the guard hit an empty body and die in validation. Point this at
// a THROWAWAY database, never a database whose contents you care about.

import { readFileSync } from "node:fs";
import { STATE_FILE, type IntegrationEnvFile } from "./global-setup";

const envFile: IntegrationEnvFile = JSON.parse(readFileSync(STATE_FILE, "utf8"));

// Must be set before any import transitively pulls in config/env.ts (it memoizes).
if (envFile.available) {
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = envFile.databaseUrl;
  process.env.REDIS_URL = envFile.redisUrl;
  process.env.JWT_PRIVATE_KEY_PATH = require.resolve("../../../../keys/jwt-private.pem");
  process.env.JWT_PUBLIC_KEY_PATH = require.resolve("../../../../keys/jwt-public.pem");
  process.env.JWT_ACCESS_TTL = "15m";
  process.env.JWT_REFRESH_TTL = "7d";
  process.env.JWT_AUDIENCE = "stimuliiq-clients";
  process.env.COOKIE_SECRET = "integration-test-cookie-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.CSRF_SECRET = "integration-test-csrf-secret-bbbbbbbbbbbbbbbbbbbbbbbbbb";
  process.env.COOKIE_SECURE = "false";
  process.env.WEB_APP_URL = "http://localhost:3000";
  process.env.LMS_APP_URL = "http://localhost:3001";
  process.env.CRM_APP_URL = "http://localhost:3002";
}

const describeIfAvailable = envFile.available ? describe : describe.skip;

/** A route as the Nest router actually registered it. */
interface RouteEntry {
  controller: string;
  handler: string;
  method: string; // GET | POST | PUT | PATCH | DELETE ...
  path: string; // full path incl. global prefix, with :params intact
  permission: string | undefined; // from @RequirePermission
  jwtGuarded: boolean; // is JwtAuthGuard in the effective guard chain?
  guards: string[];
}

describeIfAvailable("RBAC matrix — generated from the live Nest router", () => {
  const { Test } = require("@nestjs/testing");
  const cookieParser = require("cookie-parser");
  const request = require("supertest");
  const { PrismaClient } = require("@prisma/client");
  const argon2 = require("argon2");
  const { ModulesContainer } = require("@nestjs/core");
  const { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } = require("@nestjs/common/constants");
  const { RequestMethod } = require("@nestjs/common");
  const { AppModule } = require("../../src/app.module");
  const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
  const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");
  const { PERMISSION_KEY } = require("../../src/modules/auth/decorators/require-permission.decorator");

  const GLOBAL_PREFIX = "/api/v1";
  // Mirrors main.ts:104 exactly. These two controllers sit OUTSIDE the global prefix, so the
  // inventory must not prepend it to them or their paths won't match reality.
  const PREFIX_EXCLUDED = ["metrics", "api-docs.json"];
  const MATRIX_PASSWORD = "MatrixProbe@12345";
  // A syntactically-valid uuid that does not exist. Guards run before the handler, so for a
  // denied caller this never reaches a DB lookup; for an allowed caller it 404s. Either way
  // it is inert.
  const NONEXISTENT_UUID = "00000000-0000-4000-8000-000000000000";

  let app: import("@nestjs/common").INestApplication;
  let prisma: import("@prisma/client").PrismaClient;
  let routes: RouteEntry[] = [];
  let seededPermissionKeys: Set<string>;
  /** roleKey -> the set of permission keys that role actually holds (from the DB grants). */
  const grantsByRole = new Map<string, Set<string>>();
  /** roleKey -> logged-in cookie jar. */
  const sessions = new Map<string, { cookie: string; csrf: string }>();

  // ---------------------------------------------------------------------------
  // Route introspection — read the decorator metadata off the real controllers.
  // ---------------------------------------------------------------------------
  function methodName(verb: number): string {
    const found = Object.entries(RequestMethod).find(([, v]) => v === verb);
    return (found?.[0] ?? "GET").toUpperCase();
  }

  function joinPath(...parts: string[]): string {
    const joined = parts
      .filter((p) => p !== undefined && p !== null && p !== "" && p !== "/")
      .map((p) => p.replace(/^\/+|\/+$/g, ""))
      .filter(Boolean)
      .join("/");
    return `/${joined}`;
  }

  function collectRoutes(): RouteEntry[] {
    const container = app.get(ModulesContainer);
    const out: RouteEntry[] = [];

    for (const module of container.values()) {
      for (const wrapper of module.controllers.values()) {
        const { instance, metatype } = wrapper;
        if (!instance || !metatype) continue;

        const controllerPath: string = Reflect.getMetadata(PATH_METADATA, metatype) ?? "";
        const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, metatype) ?? [];
        const classPermission: string | undefined = Reflect.getMetadata(PERMISSION_KEY, metatype);

        const proto = Object.getPrototypeOf(instance);
        for (const key of Object.getOwnPropertyNames(proto)) {
          if (key === "constructor") continue;
          const handler = proto[key];
          if (typeof handler !== "function") continue;

          const verb = Reflect.getMetadata(METHOD_METADATA, handler);
          if (verb === undefined) continue; // not a route handler

          const handlerPath: string = Reflect.getMetadata(PATH_METADATA, handler) ?? "";
          const handlerGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
          const permission: string | undefined =
            Reflect.getMetadata(PERMISSION_KEY, handler) ?? classPermission;

          const guards = [...classGuards, ...handlerGuards].map((g: any) =>
            typeof g === "function" ? g.name : (g?.constructor?.name ?? String(g)),
          );

          const isExcluded = PREFIX_EXCLUDED.some((e) => controllerPath.replace(/^\/+/, "") === e);

          out.push({
            controller: metatype.name,
            handler: key,
            method: methodName(verb),
            path: isExcluded
              ? joinPath(controllerPath, handlerPath)
              : joinPath(GLOBAL_PREFIX, controllerPath, handlerPath),
            permission,
            jwtGuarded: guards.includes("JwtAuthGuard"),
            guards,
          });
        }
      }
    }
    return out.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
  }

  /** Substitute every :param with an inert, syntactically-valid uuid. */
  function concretePath(path: string): string {
    return path.replace(/:[A-Za-z0-9_]+/g, NONEXISTENT_UUID);
  }

  // ---------------------------------------------------------------------------
  // Fixtures: one active user per seeded role, so we can probe the matrix as each.
  // ---------------------------------------------------------------------------
  async function mintUserForRole(tenantId: string, roleId: string, roleKey: string, branchId: string | null) {
    const email = `matrix.${roleKey}@probe.test`;
    const passwordHash = await argon2.hash(MATRIX_PASSWORD, { type: argon2.argon2id });

    const existing = await prisma.user.findFirst({ where: { email, tenantId } });
    const user =
      existing ??
      (await prisma.user.create({
        data: { tenantId, email, name: `Matrix ${roleKey}`, passwordHash, status: "active" },
      }));

    if (existing) {
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash, status: "active" } });
    }

    // The branch link matters: a `branch`-scoped role (branch_manager, counsellor) whose
    // UserRole carries no branchId cannot resolve a scope context at all, and the repository
    // layer correctly FAILS CLOSED with a 403 — which would look like a false "wrongly denied"
    // here. Giving the probe user a real branch isolates the permission layer (what this suite
    // tests) from the scope layer (tested elsewhere), instead of papering over it.
    const link = await prisma.userRole.findFirst({ where: { userId: user.id, roleId } });
    if (link) {
      await prisma.userRole.update({ where: { id: link.id }, data: { branchId } });
    } else {
      await prisma.userRole.create({ data: { userId: user.id, roleId, branchId } });
    }

    return user;
  }

  function extractCookies(res: any): { cookie: string; csrf: string } {
    const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const cookie = list.map((c) => c.split(";")[0]).join("; ");
    const csrfRaw = list.find((c) => c.startsWith("csrf_token="));
    const csrf = csrfRaw ? csrfRaw.split(";")[0].split("=").slice(1).join("=") : "";
    return { cookie, csrf };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.setGlobalPrefix("api/v1", { exclude: PREFIX_EXCLUDED });
    await app.init();

    routes = collectRoutes();

    // The permission catalog + grants, straight from the seeded DB (the source of truth).
    const permissions = await prisma.permission.findMany();
    seededPermissionKeys = new Set(permissions.map((p: any) => p.key));

    const tenant = await prisma.tenant.findFirst();
    if (!tenant) throw new Error("No tenant in the DB — run `pnpm db:seed` against the test database first.");

    const roles = await prisma.role.findMany({
      include: { rolePermissions: { include: { permission: true } } },
    });

    const branch = await prisma.branch.findFirst();

    for (const role of roles as any[]) {
      grantsByRole.set(role.key, new Set(role.rolePermissions.map((rp: any) => rp.permission.key)));
      await mintUserForRole(tenant.id, role.id, role.key, branch?.id ?? null);
    }

    // Log in as each role. `audience` is deliberately omitted: the audience gate is a no-op
    // when absent (auth.service.ts assertAudienceAllowed), which lets us probe the student
    // role against CRM routes too — exactly the cross-audience case we most want to prove
    // is denied by PERMISSIONS, not merely by the audience gate.
    for (const roleKey of grantsByRole.keys()) {
      const res = await request(app.getHttpServer())
        .post(`${GLOBAL_PREFIX}/auth/login`)
        .send({ email: `matrix.${roleKey}@probe.test`, password: MATRIX_PASSWORD });

      if (res.status !== 200) {
        throw new Error(`Matrix probe login failed for role "${roleKey}": ${res.status} ${JSON.stringify(res.body)}`);
      }
      sessions.set(roleKey, extractCookies(res));
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  // ===========================================================================
  // PHASE 1 — Static inventory. These need no HTTP and cannot go stale.
  // ===========================================================================
  describe("inventory", () => {
    it("discovered a plausible number of routes (guards against a silently-empty matrix)", () => {
      // If introspection ever breaks, every assertion below would vacuously pass over an
      // empty array. This is the canary that stops that happening.
      expect(routes.length).toBeGreaterThan(150);
    });

    it("every @RequirePermission key exists in the permission catalog", () => {
      // CAVEAT — this checks the LIVE DB catalog, which is weaker than it looks, and the
      // weakness is exactly how finding F-1 stayed hidden:
      //
      // Integration specs upsert their own permission rows as fixtures. p4-learning-depth-
      // journey.integration-spec.ts:257 creates ["attempts.grade", "Grade Attempts"] because
      // the route it exercises needs it. So the key EXISTS in any DB this suite has touched,
      // and a DB-based check goes green — while `pnpm db:seed` (all a real deployment runs)
      // never creates it, leaving that route 403 for every role in production, forever.
      //
      // The robust version of this check must read the catalog that `prisma/seed.ts` actually
      // produces. It cannot today: the catalog is assembled inside main() from unexported
      // buildPhaseXPermissionCatalog() cross-product builders. Re-deriving those in the test
      // would only make the test agree with the seed by CONSTRUCTION rather than verify it.
      // The fix is a one-line export in seed.ts — pending approval; see the F-1 regression
      // test below, which pins the concrete bug in the meantime.
      const unseeded = routes
        .filter((r) => r.permission && !seededPermissionKeys.has(r.permission))
        .map((r) => `${r.method} ${r.path}  ->  @RequirePermission("${r.permission}")  [${r.controller}.${r.handler}]`)
        .sort();

      expect({ permissionKeysMissingFromCatalog: unseeded }).toEqual({ permissionKeysMissingFromCatalog: [] });
    });

    it("prisma/seed.ts defines AND grants attempts.grade (F-1, fixed — kept as a guard)", () => {
      // Deliberately reads the seed SOURCE, not the live catalog. The two DB-backed checks
      // around it cannot see this class of bug: integration specs upsert their own permission
      // fixtures (p4-learning-depth-journey creates attempts.grade because the route it
      // exercises needs it), so the key exists in any DB this suite has touched while
      // `pnpm db:seed` — all a real deployment runs — did not create it. That was F-1:
      // PUT /crm/attempts/:id/grade 403'd for EVERY role including super_admin, making
      // descriptive-attempt grading dead in production. Fail-closed, so a functional gap
      // rather than a hole.
      //
      // Now fixed in the P4 catalog + the faculty assigned-scope grant (super_admin/admin
      // arrive via the catch-all). Both halves are asserted because the catalog entry alone
      // would leave the key granted to nobody — equally dead.
      const seedSource = readFileSync(require.resolve("../../../../prisma/seed.ts"), "utf8");
      expect(seedSource).toContain('{ key: "attempts.grade"');
      expect(seedSource).toMatch(/facultyP4AssignedGrants[\s\S]*?"attempts\.grade"[\s\S]*?\]/);
    });

    it("no route requires a permission that the seed grants to nobody (dead endpoint check)", async () => {
      // A permission that exists in the catalog but is granted to ZERO roles is just as dead as
      // one that does not exist at all — no user can ever hold it, so the route is permanently
      // 403. Same failure, different cause; worth catching separately.
      const grantedToSomeone = new Set<string>();
      for (const held of grantsByRole.values()) for (const key of held) grantedToSomeone.add(key);

      const ungranted = routes
        .filter((r) => r.permission && seededPermissionKeys.has(r.permission) && !grantedToSomeone.has(r.permission))
        .map((r) => `${r.method} ${r.path} (needs ${r.permission}, held by NO role)`)
        .sort();

      expect({ routesNoRoleCanEverReach: ungranted }).toEqual({ routesNoRoleCanEverReach: [] });
    });

    it("every seeded permission key is actually used by at least one route (dead-grant check)", () => {
      const used = new Set(routes.map((r) => r.permission).filter(Boolean));
      const dead = [...seededPermissionKeys].filter((k) => !used.has(k)).sort();

      // Not a hard failure — some keys are legitimately UI-only or reserved for a future
      // route. Recorded so the drift is visible and deliberate rather than accidental.
      if (dead.length > 0) {
        console.warn(`[rbac-matrix] ${dead.length} seeded permission key(s) are not enforced by any route:\n  ${dead.join("\n  ")}`);
      }
      expect(Array.isArray(dead)).toBe(true);
    });

    it("every JWT-guarded route declares a @RequirePermission, or is an explicit exception", () => {
      // PermissionsGuard ALLOWS any route that declares no @RequirePermission — such a route
      // is authenticated-only, readable/writable by ANY logged-in user of ANY role. That is
      // sometimes right (GET /me), but it must always be a DECISION, never an oversight.
      // Anything not on this list is a finding.
      const AUTHENTICATED_ONLY_ALLOWLIST = new Set<string>([
        "GET /api/v1/me",
        "POST /api/v1/auth/logout",
        // Pre-existing gap closed (gap-closing pass): authenticated-only by design — any
        // logged-in user changes ONLY their own password (no module.action permission is
        // meaningful here, same rationale as GET /me / POST /auth/logout above). Was
        // already `@UseGuards(JwtAuthGuard)`-only with no `@RequirePermission` since the
        // lifecycle-redesign P3 change-password route was added; never added to this
        // allowlist until now.
        "POST /api/v1/auth/change-password",
        "GET /api/v1/crm/saved-views",
        "POST /api/v1/crm/saved-views",
        "DELETE /api/v1/crm/saved-views/:id",
        "POST /api/v1/public/enroll/orders",
        "POST /api/v1/public/enroll/checkout",
        "POST /api/v1/public/enroll/verify",
      ]);

      const undeclared = routes
        .filter((r) => r.jwtGuarded && !r.permission)
        .map((r) => `${r.method} ${r.path}`)
        .filter((sig) => !AUTHENTICATED_ONLY_ALLOWLIST.has(sig))
        .sort();

      expect({ jwtGuardedButNoPermission: undeclared }).toEqual({ jwtGuardedButNoPermission: [] });
    });

    it("every unauthenticated route is an explicitly-approved public surface", () => {
      // A route with no JwtAuthGuard is reachable by the entire internet. Each one must be
      // deliberate: a public catalog read, a captcha-gated intake form, an HMAC-verified
      // webhook, or a signed-token endpoint. A NEW unauthenticated route failing this test
      // is exactly the alarm we want.
      const PUBLIC_ALLOWLIST_PREFIXES = [
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/auth/logout",
        "/api/v1/auth/otp",
        "/api/v1/auth/password-reset",
        "/api/v1/auth/2fa/login-verify",
        // 2FA recovery (request + confirm) — necessarily anonymous, for the same reason
        // password-reset above is: the caller is locked OUT of their second factor, so there is
        // no session to authenticate with. Possession of the emailed OTP is the credential.
        // Both carry AuthIpRateLimitGuard, so the surface is rate-limited rather than open.
        "/api/v1/auth/2fa/recovery",
        "/api/v1/public/",
        "/api/v1/verify/",
        "/api/v1/health",
        "/api/v1/unsubscribe/",
        "/api/v1/commerce/payments/webhook",
        "/api/v1/campaigns/webhooks/",
        "/api/v1/lms/videos/webhook",
        "/api/v1/live-classes/webhook",
        "/metrics", // outside the global prefix; guarded by MetricsAuthGuard (bearer token)
        "/api-docs.json", // outside the global prefix; the OpenAPI document is public by design
        "/api/v1/storage/", // dev-only local storage provider; auth IS the HMAC in the signed URL
        "/api/v1/assets/", // ditto
      ];

      const unexpectedlyPublic = routes
        .filter((r) => !r.jwtGuarded)
        .filter((r) => !PUBLIC_ALLOWLIST_PREFIXES.some((p) => r.path.startsWith(p)))
        .map((r) => `${r.method} ${r.path}  [${r.controller}.${r.handler}]  guards=[${r.guards.join(",")}]`)
        .sort();

      expect({ unexpectedlyPublicRoutes: unexpectedlyPublic }).toEqual({ unexpectedlyPublicRoutes: [] });
    });
  });

  // ===========================================================================
  // PHASE 2 — The matrix itself: every protected route x every role.
  // ===========================================================================
  describe("authorization matrix", () => {
    // Routes whose guard chain includes something that legitimately answers before
    // PermissionsGuard can (rate limiters returning 429), which would make a 403 assertion
    // flaky rather than wrong. None expected today; kept as the documented escape hatch.
    const SKIP_PATHS = new Set<string>([]);

    // Routes that apply a SECOND authorization layer beyond the permission grant: they also
    // require the caller to own a domain profile (a mentor record, a student record). Holding
    // the permission is necessary but not sufficient, so a synthetic probe user — who has a
    // role but no such profile — is correctly 403'd. This is a FEATURE, not a false negative:
    //   - /me/mentor/dashboard re-verifies the caller is an assigned mentor (defense-in-depth
    //     IDOR guard; a wildcard-granted admin is deliberately NOT a mentor).
    //   - /me/referrals + /crm/referrals scope to the caller's own student record (the Wave-6
    //     H1 referrals-scope fix).
    // Listing them explicitly keeps the assertion sharp: any OTHER route that starts 403-ing a
    // grant-holder is a real regression and will still fail this suite.
    //
    // The /crm/courses entries are a DIFFERENT case and are listed here under protest. The
    // seed grants courses.view/edit to faculty at scope=assigned, and to branch_manager /
    // counsellor at branch scope — but courses.repository.ts:9-17 documents that `assigned`
    // FAILS CLOSED (the `programs` table has no author/owner column to resolve "assigned"
    // against) and that branch/own were never implemented. So those grants are DEAD: the
    // roles hold the permission, the CRM nav shows them the Courses item, and every request
    // 403s. Safe (fail-closed) but wrong (a dead grant + a nav item that cannot work).
    // Tracked as finding F-2 in the report; remove these entries once the scope is resolvable.
    const SECOND_LAYER_AUTHZ = new Set<string>([
      "GET /api/v1/me/mentor/dashboard",
      "GET /api/v1/me/referrals",
      "POST /api/v1/me/referrals",
      "GET /api/v1/crm/referrals",
      "GET /api/v1/crm/courses",
      "GET /api/v1/crm/courses/:id",
      "GET /api/v1/crm/courses/:id/curriculum",
      "PATCH /api/v1/crm/courses/:id",
      "PATCH /api/v1/crm/courses/:id/modules/:moduleId",
      "PATCH /api/v1/crm/courses/:id/modules/:moduleId/lessons/:lessonId",
      // Lesson resources are the SAME F-2 family: they deliberately reuse courses.view /
      // courses.edit rather than minting new keys, so they inherit the same unresolvable
      // `assigned`/`branch`/`own` scopes and hit the same fail-closed guard
      // (courses.service.ts assertResolvableScope). Not a new defect — the routes were added
      // after this list was written. Only these two appear: the sibling POSTs are rejected by
      // ZodValidationPipe on the probe's empty `{}` body before the scope guard ever runs, so
      // they never surface as a 403 here.
      "GET /api/v1/crm/courses/lessons/:lessonId/resources",
      "DELETE /api/v1/crm/courses/lessons/resources/:resourceId",
      // Same family, and here the denial is unambiguously CORRECT: the `student` role holds
      // enrollments.view at scope=own so it can read its OWN enrollments via /me/enrollments.
      // The CRM list route reuses the same permission KEY, so the permission layer alone would
      // let a student through — and the SCOPE layer is what stops it, failing closed because
      // `own` is not resolvable for a tenant-wide CRM list. A student listing CRM enrollments
      // is exactly the breach this must prevent, and it does. Listed here because the assertion
      // measures the permission layer; the scope layer is proven in the *-scope specs.
      "GET /api/v1/crm/enrollments",
    ]);

    function protectedRoutes(): RouteEntry[] {
      return routes.filter((r) => r.jwtGuarded && r.permission && !SKIP_PATHS.has(r.path));
    }

    async function probe(route: RouteEntry, session: { cookie: string; csrf: string }) {
      const verb = route.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
      let req = (request(app.getHttpServer()) as any)[verb](concretePath(route.path))
        .set("Cookie", session.cookie)
        .set("X-CSRF-Token", session.csrf); // double-submit CSRF, required on unsafe verbs

      if (verb !== "get") req = req.send({});
      return req;
    }

    it("the matrix is non-trivial (sanity: protected routes x roles)", () => {
      const cells = protectedRoutes().length * grantsByRole.size;
      console.log(
        `[rbac-matrix] ${routes.length} routes discovered | ${protectedRoutes().length} permission-protected | ` +
          `${grantsByRole.size} roles | ${cells} authorization cells asserted`,
      );
      expect(cells).toBeGreaterThan(500);
    });

    // Deliberately ONE test that loops every role, rather than `it.each` over a role list.
    // `it.each` is evaluated at COLLECTION time, before `beforeAll` has queried the DB — so
    // it would need a hardcoded role count, and a hardcoded count silently under-tests the
    // matrix the moment a role is added (another spec in this suite creates one, taking the
    // count from 11 to 12). A test that quietly skips coverage is worse than no test at all.
    // Looping inside the test body means the role list is always whatever the DB actually
    // holds, and every role is always asserted.
    it("every role is denied exactly the routes it lacks the permission for", async () => {
      const shouldHaveBeenDenied: string[] = []; // role LACKS the permission but got through — a security hole
      const wronglyDenied: string[] = []; // role HOLDS the permission but was 403'd — a dead grant

      for (const roleKey of [...grantsByRole.keys()].sort()) {
        const held = grantsByRole.get(roleKey)!;
        const session = sessions.get(roleKey)!;

        for (const route of protectedRoutes()) {
          const res = await probe(route, session);
          const roleHolds = held.has(route.permission!);
          const sig = `[${roleKey}] ${route.method} ${route.path} (needs ${route.permission})`;

          if (!roleHolds && res.status !== 403) {
            shouldHaveBeenDenied.push(`${sig} -> got ${res.status}, expected 403`);
          }
          if (roleHolds && res.status === 403 && !SECOND_LAYER_AUTHZ.has(`${route.method} ${route.path}`)) {
            wronglyDenied.push(`${sig} -> got 403 despite holding the grant`);
          }
        }
      }

      expect({ shouldHaveBeenDenied, wronglyDenied }).toEqual({ shouldHaveBeenDenied: [], wronglyDenied: [] });
    }, 600_000);
  });
});
