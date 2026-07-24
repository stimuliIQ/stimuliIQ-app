// @repo/config/eslint/node — preset for NestJS / Node packages.
const base = require("./base");

// Phase-7 Wave 2 security hardening batch B, item 3 (docs/plans/phase-7.md task #13,
// docs/phase-1-followups.md "Soft-delete-bypass lint rule" + Wave 5 qa-engineer report):
// two anti-patterns caught by hand in prior waves, now enforced by lint so they can't
// silently regress.
//
// (a) Raw `$executeRaw`/`$executeRawUnsafe`/`$queryRaw`/`$queryRawUnsafe` DELETE
//     statements bypass the soft-delete Prisma extension ENTIRELY — Prisma Client
//     Extensions cannot intercept raw-SQL calls the way they intercept
//     `model.delete()`/`model.deleteMany()`. The ONE sanctioned exception in this
//     codebase today is `RolesRepository.replaceGrants` (ADR-0010: `role_permissions`
//     is a pure join table with no independent lifecycle/audit value once superseded).
//     Any OTHER raw-SQL DELETE must either use the model's normal (soft-delete-safe)
//     delegate method, or be an explicitly reviewed, documented purge job with an
//     `eslint-disable-next-line` justification comment (and, ideally, an ADR).
// (b) Reaching into another object's `prisma` field via COMPUTED member access
//     (`repo["prisma"]`) is how TypeScript's `private` visibility gets silently
//     bypassed — the exact anti-pattern found in `assignments.service.ts` and
//     `notifications.service.ts` (fixed in this same wave) where a SERVICE reached
//     past its repository's public API straight into the repository's private Prisma
//     client. CLAUDE.md §3.3: "repository — Prisma data access only... No Prisma in
//     controllers" implies no Prisma in services either — add a proper public
//     repository method instead.
const softDeleteBypassRules = {
  "no-restricted-syntax": [
    "error",
    {
      selector:
        "TaggedTemplateExpression[tag.property.name=/^\\$(executeRaw|queryRaw)$/] TemplateElement[value.raw=/DELETE\\s+FROM/i]",
      message:
        'Raw SQL DELETE via a tagged $executeRaw/$queryRaw template bypasses the soft-delete Prisma extension entirely (extensions cannot intercept raw SQL). This is sanctioned ONLY for a documented, reviewed hard-delete purge job (see ADR-0010 for the one existing example, RolesRepository.replaceGrants). If this is one of those, add `eslint-disable-next-line no-restricted-syntax -- <reason + ADR link>` directly above this line. Otherwise, use the model\'s own soft-delete-respecting delegate method (e.g. `prisma.client.<model>.delete(...)`) instead.',
    },
    {
      selector:
        "CallExpression[callee.property.name=/^\\$(executeRawUnsafe|queryRawUnsafe)$/] Literal[value=/DELETE\\s+FROM/i]",
      message:
        'Raw SQL DELETE via $executeRawUnsafe/$queryRawUnsafe bypasses the soft-delete Prisma extension entirely. Sanctioned ONLY for a documented, reviewed hard-delete purge job (see ADR-0010) with an `eslint-disable-next-line no-restricted-syntax -- <reason + ADR link>` comment. Otherwise, use the model\'s own soft-delete-respecting delegate method instead.',
    },
    {
      selector: "MemberExpression[computed=true][property.value='prisma']",
      message:
        'Reaching into a private `prisma` field via bracket notation (e.g. `repo["prisma"]`) bypasses TypeScript\'s access control and the controller→service→repository layering (CLAUDE.md §3.3). Add a proper public method on the repository and call THAT from the service instead — never reach past a repository into its own Prisma client.',
    },
  ],
};

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  ...base,
  {
    rules: {
      // Nest decorators commonly rely on empty constructors / DI patterns.
      "@typescript-eslint/no-empty-function": "off",
      ...softDeleteBypassRules,
    },
  },
];
