// apps/api/src/modules/onboarding/onboarding.permission-catalog.spec.ts
//
// Regression test for the P6 `forum.read`/`notification_prefs.edit` 403 bug class (mirrors
// content/mentors/tickets `.permission-catalog.spec.ts`): a `@RequirePermission("x")` whose
// key is missing from the seed catalog, or present but granted to nobody, 403s for every
// caller, and does so silently at runtime rather than loudly at build time. This spec is
// what makes that fail here instead.
//
// It also pins the module's deliberate permission SPLIT: `onboarding.fields.manage` is a
// different key from the three submission permissions, so a counsellor working the intake
// queue cannot delete the payment-receipt question out of the live form. If a future
// refactor collapses the two, the assertions below break.
//
// Static source-scanning only, no live-DB half: the sibling specs' `describeIfDb` block
// runs against whatever `DATABASE_URL` points at, and in this repo that is the PRODUCTION
// Supabase instance. The seed-source assertions below cover the same invariant without a
// test suite reaching for the production database.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTROLLER_FILE = "./onboarding.controller.ts";

/** Read + triage the intake queue. Granted to counsellor + support as well as admins. */
const SUBMISSION_KEYS = ["onboarding.view", "onboarding.edit", "onboarding.delete"] as const;

/** Authoring the live form, admin/super_admin only, via the catch-all catalog grant. */
const FIELDS_KEY = "onboarding.fields.manage";

const ALL_KNOWN_KEYS = [...SUBMISSION_KEYS, FIELDS_KEY] as const;

const SEED_PATH = resolve(__dirname, "../../../../../prisma/seed.ts");

function requiredPermissionKeys(relativePath: string): string[] {
  const source = readFileSync(resolve(__dirname, relativePath), "utf8");
  return [...source.matchAll(/@RequirePermission\("([^"]+)"\)/g)].map((m) => m[1]!);
}

/**
 * Index of a class's `@Controller(...)` decorator, matched at the START of a line so the
 * file-header comment, which documents the very same decorators, cannot be mistaken for
 * the code. (It can: the header lists `@Controller("crm/onboarding/fields")` verbatim, and
 * a naive indexOf finds that first, silently producing empty sections that pass by
 * vacuity.)
 */
function controllerDecoratorIndex(source: string, path: string): number {
  const match = new RegExp(`^@Controller\\("${path.replace(/\//g, "\\/")}"\\)`, "m").exec(source);
  if (!match) throw new Error(`No @Controller("${path}") declaration found`);
  return match.index;
}

describe("Onboarding module permission catalog", () => {
  const seedSource = readFileSync(SEED_PATH, "utf8");
  const controllerSource = readFileSync(resolve(__dirname, CONTROLLER_FILE), "utf8");

  it("every @RequirePermission key the module declares is a known key", () => {
    const referenced = new Set(requiredPermissionKeys(CONTROLLER_FILE));
    expect(referenced.size).toBeGreaterThan(0);
    for (const key of referenced) expect(ALL_KNOWN_KEYS).toContain(key);
    // ...and every known key is actually used, so a controller drifting off one is caught.
    for (const key of ALL_KNOWN_KEYS) expect(referenced.has(key)).toBe(true);
  });

  it("PublicOnboardingController declares NO @RequirePermission (anonymous, captcha-gated)", () => {
    // Bounded by the NEXT controller's @Controller decorator, not its `class` keyword,
    // a class's guards are declared above it, so slicing to `class Foo` would sweep the
    // following controller's @UseGuards into this section and pass vacuously.
    const publicSection = controllerSource.slice(
      controllerSource.indexOf("class PublicOnboardingController"),
      controllerDecoratorIndex(controllerSource, "crm/onboarding/fields"),
    );
    expect(publicSection).not.toMatch(/@RequirePermission\(/);
    // The public controller must also carry no guards at all (ADR-0019).
    expect(publicSection).not.toMatch(/@UseGuards\(/);
  });

  it("every CRM route is permission-gated, no route slips through on JwtAuthGuard alone", () => {
    const crmSection = controllerSource.slice(controllerDecoratorIndex(controllerSource, "crm/onboarding/fields"));
    const handlerCount = (crmSection.match(/@(Get|Post|Patch|Delete)\(/g) ?? []).length;
    const keyCount = (crmSection.match(/@RequirePermission\(/g) ?? []).length;
    expect(keyCount).toBe(handlerCount);
  });

  // The split is the point: mutating the FORM and reading SUBMISSIONS are different rights.
  it("every field-authoring route requires onboarding.fields.manage, not a submission key", () => {
    const fieldsSection = controllerSource.slice(
      controllerDecoratorIndex(controllerSource, "crm/onboarding/fields"),
      controllerDecoratorIndex(controllerSource, "crm/onboarding/submissions"),
    );
    const mutatingKeys = [...fieldsSection.matchAll(/@(?:Post|Patch|Delete)\([^)]*\)\s*@RequirePermission\("([^"]+)"\)/g)].map(
      (m) => m[1]!,
    );
    expect(mutatingKeys.length).toBeGreaterThan(0);
    for (const key of mutatingKeys) expect(key).toBe(FIELDS_KEY);
  });

  describe.each(ALL_KNOWN_KEYS)('permission "%s"', (key) => {
    const literal = key.replace(/\./g, "\\.");

    it("is registered in the seed catalog", () => {
      expect(seedSource).toMatch(new RegExp(`key:\\s*"${literal}"`));
    });

    it("reaches the catalog through ONBOARDING_PERMISSIONS (so admin/super_admin inherit it)", () => {
      const block = seedSource.match(/const ONBOARDING_PERMISSIONS[\s\S]*?\];/);
      expect(block).not.toBeNull();
      expect(block![0]).toMatch(new RegExp(`key:\\s*"${literal}"`));
    });
  });

  describe.each(SUBMISSION_KEYS.slice(0, 2))('submission permission "%s"', (key) => {
    it("has an explicit non-admin role grant in seed.ts (counsellor/support work the queue)", () => {
      const literal = key.replace(/\./g, "\\.");
      const occurrences = seedSource.match(new RegExp(`"${literal}"`, "g")) ?? [];
      // Once in the catalog definition, at least once more in a role-grant block.
      expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });
  });
});
