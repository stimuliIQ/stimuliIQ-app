// Turns the flat permission catalog into the shape the CRM's own sidebar has, so the
// Roles & Permissions editor asks the question an administrator is actually asking:
// "which screens may this role open, and what may they do once they are there?"
//
// The old editor listed ~200 `module.action` keys grouped by their module name, in
// alphabetical order, with no relationship to anything visible in the product. Deciding
// what a Counsellor should hold meant knowing that `activities.*` is the follow-up log
// inside Leads, that `bulk.leads` is a button on the pipeline, and that the entire
// `tenant.*` group grants nothing at all.
//
// ── The backbone is NAV_SECTIONS ─────────────────────────────────────────────────────
// The sidebar tree already carries, per leaf, the exact permission that reveals it. So
// the sections and screen rows here are DERIVED from it rather than re-typed: the editor
// cannot drift out of step with the menu it describes, and a nav leaf added later shows
// up here for free. Only the ACTION lists are hand-authored (`SCREEN_ACTIONS`), because
// "which permissions belong to the Leads screen" is product knowledge that exists nowhere
// in the code.
//
// ── Why leftovers are COMPUTED, never listed ─────────────────────────────────────────
// Saving is a FULL REPLACE of the role's grants (roles.repository.ts). Any permission the
// editor fails to render is therefore not merely hidden, it is REVOKED on the next save.
// That makes "did I remember to list every key?" a data-loss question, and hand-maintained
// coverage the wrong answer. Instead `buildPermissionModel` starts from the live catalog,
// removes what the nav claims, and puts everything still standing into the extra groups at
// the end. Coverage is structural: a key the map has never heard of still gets a row.
import type { PermissionCatalogEntry } from "@repo/types";

import { NAV_SECTIONS } from "./nav-config";
import { describeModule, isLegacyScaffoldModule } from "./permission-help";

export interface PermissionActionRow {
  key: string;
  /** Short verb for the row, e.g. "Edit" or "Grade submissions". */
  label: string;
}

export interface PermissionScreenRow {
  /** The permission that opens the screen. Doubles as this row's id. */
  gate: string;
  /** Every nav leaf in THIS section that the gate reveals, e.g. ["Pipeline", "My Work"]. */
  screens: string[];
  /** Route of the first leaf, shown as a hint so the row is findable in the real menu. */
  path?: string;
  /** What the role can do once the screen is open. Empty for view-only screens. */
  actions: PermissionActionRow[];
  /** Other sidebar sections the same gate also unlocks. Warns that the toggle is shared. */
  alsoIn: string[];
  /** True for a real screen that exists but was taken out of the sidebar (reachable by URL). */
  offMenu?: boolean;
}

export interface PermissionSectionRow {
  /** Sidebar section label, e.g. "Academics". */
  label: string;
  /** The sidebar's own caption above this section ("Operations", "Administration", ...). */
  caption?: string;
  screens: PermissionScreenRow[];
}

/** A group of permissions that no CRM screen claims. Rendered after the sections. */
export interface PermissionExtraRow {
  id: string;
  label: string;
  description: string;
  permissions: PermissionActionRow[];
}

export interface PermissionModel {
  sections: PermissionSectionRow[];
  extras: PermissionExtraRow[];
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Which permissions belong to which screen.
//
// Keyed by the nav leaf's gate permission. A key listed here is claimed: it renders as an
// action under that screen and is removed from the leftover pool. Keys are listed in the
// order they should read, not alphabetically.
//
// Several entries deliberately cross module boundaries, because the CRM screen does:
//   - Leads owns `activities.*` and `bookings.*` — the follow-up log and the counselling
//     slots are tabs of the My Work cockpit, not screens of their own.
//   - Courses owns `lessons.*` and `videos.*` — curriculum is authored inside a course.
//   - Assignments owns `submissions.*` and `projects.review` — the review queue lives there.
//   - Audit Logs owns `dpdp.erasure.execute` — erasure redacts a person out of the trail.
// ─────────────────────────────────────────────────────────────────────────────────────
const SCREEN_ACTIONS: Record<string, string[]> = {
  "leads.view": [
    "leads.create",
    "leads.edit",
    "leads.delete",
    "leads.export",
    "leads.approve",
    "leads.convert",
    "bulk.leads",
    "activities.view",
    "activities.create",
    "activities.edit",
    "activities.delete",
    "activities.export",
    "activities.approve",
    "activities.convert",
    "bookings.view",
    "bookings.create",
    "bookings.edit",
    "bookings.delete",
    "bookings.export",
    "bookings.approve",
  ],
  "students.view": [
    "students.create",
    "students.edit",
    "students.delete",
    "students.export",
    "students.approve",
    "bulk.students",
    "enrollments.view",
    "enrollments.create",
    "enrollments.edit",
    "enrollments.delete",
    "enrollments.export",
    "enrollments.approve",
    "progress.view",
    "progress.create",
    "progress.edit",
    "progress.delete",
    "progress.export",
  ],
  "onboarding.view": ["onboarding.edit", "onboarding.delete", "onboarding.fields.manage"],
  "courses.view": [
    "courses.create",
    "courses.edit",
    "courses.delete",
    "courses.export",
    "courses.approve",
    "lessons.view",
    "lessons.create",
    "lessons.edit",
    "lessons.delete",
    "lessons.export",
    "videos.view",
    "videos.create",
    "videos.edit",
    "videos.delete",
    "videos.export",
  ],
  "faculty.view": ["faculty.create", "faculty.edit", "faculty.delete", "faculty.export", "faculty.approve"],
  "mentors.view": ["mentors.create", "mentors.edit", "mentors.delete", "mentors.assign"],
  "batches.view": [
    "batches.create",
    "batches.edit",
    "batches.delete",
    "batches.export",
    "batches.approve",
    "batches.markComplete",
  ],
  "assignments.view": [
    "assignments.create",
    "assignments.edit",
    "assignments.grade",
    "submissions.view",
    "submissions.grade",
    "projects.review",
  ],
  "assessments.view": ["assessments.create", "assessments.edit", "attempts.view", "attempts.grade"],
  "videolib.view": ["videolib.upload", "videolib.edit", "videolib.delete"],
  "content.view": [
    "content.create",
    "content.edit",
    "content.delete",
    "content.publish",
    "resources.view",
    "resources.create",
    "resources.edit",
    "resources.delete",
    "resources.export",
    "resources.stream",
  ],
  "certificates.view": ["certificates.recommend", "certificates.issue", "certificates.revoke"],
  "payments.view": ["payments.create", "payments.edit", "payments.delete", "payments.export", "payments.approve"],
  "orders.view": ["orders.create", "orders.edit", "orders.delete", "orders.export", "orders.approve"],
  "invoices.view": ["invoices.create", "invoices.edit", "invoices.delete", "invoices.export", "invoices.approve"],
  "refunds.view": ["refunds.create", "refunds.edit", "refunds.delete", "refunds.export", "refunds.approve"],
  "coupons.view": ["coupons.create", "coupons.edit", "coupons.delete", "coupons.export", "coupons.approve"],
  "emi.view": ["emi.create", "emi.edit", "emi.charge"],
  "campaigns.view": ["campaigns.create", "campaigns.edit", "campaigns.send", "campaigns.delete"],
  "referrals.view": ["referrals.create", "referrals.edit", "referrals.approve"],
  "site_settings.view": ["site_settings.edit"],
  "landing_pages.view": ["landing_pages.edit", "lead_forms.view", "lead_forms.edit"],
  "tickets.view": ["tickets.create", "tickets.edit", "tickets.assign", "tickets.close", "canned_responses.manage"],
  "kb.view": ["kb.edit"],
  "reports.export": ["reports.schedule"],
  "careers.view": ["careers.review", "careers.openings.manage"],
  "leave.view": ["leave.request"],
  "users.view": [
    "users.create",
    "users.edit",
    "users.delete",
    "users.remove",
    "users.reset_password",
    "users.export",
    "twofa.reset",
  ],
  "roles.view": ["roles.create", "roles.edit", "roles.delete", "roles.export", "roles.approve"],
  "branches.view": ["branches.create", "branches.edit", "branches.delete", "branches.export", "branches.approve"],
  "audit_logs.view": ["dpdp.erasure.execute"],
  "settings.view": ["settings.edit"],
};

/** Verb per action segment. The row already sits under its screen, so the verb alone reads. */
const ACTION_VERBS: Record<string, string> = {
  view: "View",
  create: "Add",
  edit: "Edit",
  delete: "Delete",
  export: "Export",
  approve: "Approve",
  convert: "Convert",
  grade: "Grade",
  review: "Review",
  send: "Send",
  publish: "Publish",
  charge: "Charge",
  assign: "Assign",
  upload: "Upload",
  cancel: "Cancel",
  close: "Close",
  moderate: "Moderate",
  manage: "Manage",
  recommend: "Recommend",
  issue: "Issue",
  revoke: "Revoke",
  reset: "Reset",
  remove: "Delete permanently",
  schedule: "Schedule",
  stream: "Open files",
  take: "Take",
  read: "Read",
  post: "Post",
  join: "Join",
  use: "Use",
  request: "Request",
  execute: "Run",
  builder: "Edit pages",
  verify: "Verify",
  headline: "Set",
  markComplete: "Mark complete",
  reset_password: "Reset password",
};

/**
 * Labels that the verb-plus-noun rule gets wrong or leaves ambiguous. Kept small on
 * purpose: an override here is a claim that the generated label would mislead.
 */
const ACTION_LABEL_OVERRIDES: Record<string, string> = {
  // The nav's Import leaf is gated on `.create`, so this one toggle is both routes in.
  "leads.create": "Add or import leads",
  "students.create": "Add or import students",
  "leads.convert": "Convert a lead into a student",
  "activities.convert": "Convert a logged activity into a lead",
  "batches.markComplete": "Mark the internship complete",
  "onboarding.edit": "Accept or reject a submission",
  "onboarding.fields.manage": "Edit the live form's questions",
  "careers.review": "Decide an application (shortlist, offer, reject)",
  "careers.openings.manage": "Publish and close job openings",
  "campaigns.send": "Send to real people",
  "users.remove": "Delete an account permanently",
  "users.reset_password": "Reset someone's password",
  "twofa.reset": "Clear someone's two-factor",
  "dpdp.erasure.execute": "Run a data-erasure request",
  "certificates.issue": "Issue the certificate",
  "emi.charge": "Charge or reconcile an instalment",
  "leave.request": "Apply for your own leave",
  "bulk.leads": "Bulk-edit many leads at once",
  "bulk.students": "Bulk-edit many students at once",
  "roles.edit": "Change what a role may do",
  "resources.stream": "Open a protected file",
};

/**
 * Where a gate used by more than one sidebar section should live.
 *
 * The default is "the section with the most leaves for it", which puts `content.view`
 * under Website (three screens) rather than Content ▸ Resources (one). An override is only
 * needed to break a tie the wrong way: `students.view` opens Search Engine and Students ▸
 * Directory, one leaf each, and Students is plainly where somebody looks for it.
 */
const GATE_HOME_SECTION: Record<string, string> = {
  "students.view": "Students",
};

/**
 * Real screens that still exist and are reachable by URL, but were deliberately taken out
 * of the sidebar (see nav-config.ts, "NAV SLIMMED"). They are permission-gated exactly
 * like the ones still on the menu, so leaving them out of this editor would file working
 * reports under "not tied to a CRM screen", which is simply untrue.
 */
const OFF_MENU_SCREENS: Record<string, Array<{ gate: string; label: string; path: string }>> = {
  Analytics: [
    { gate: "reports.engagement.view", label: "Course Engagement", path: "/analytics/engagement" },
    { gate: "reports.forum.view", label: "Forum Health", path: "/analytics/forum" },
    { gate: "reports.gamification.view", label: "Gamification", path: "/analytics/gamification" },
  ],
};

/**
 * Keys the seed generated as part of a `module × action` grid that no screen and no
 * endpoint ever used — "convert an invoice", "stream a progress record". They are real
 * catalog rows, so they must stay toggleable (full-replace saves), but filing them beside
 * working permissions would imply they do something.
 */
const UNUSED_COMBINATIONS = new Set([
  "orders.convert",
  "payments.convert",
  "invoices.convert",
  "refunds.convert",
  "coupons.convert",
  "bookings.convert",
  "lessons.stream",
  "videos.stream",
  "progress.stream",
]);

/** Modules whose leftover keys belong to the student's own LMS, not to any CRM screen. */
const STUDENT_APP_MODULES = new Set([
  "attempts",
  "bookmarks",
  "forum",
  "gamification",
  "notes",
  "notifications",
  "notification_prefs",
  "search",
  "submissions",
  "twofa",
  "marketing_targets",
  "mentor",
]);

/** Modules for features that were built and then removed from the product. */
const RETIRED_MODULES = new Set(["liveclass", "stats"]);

function splitKey(key: string): { module: string; action: string } {
  const parts = key.split(".");
  return { module: parts[0] ?? key, action: parts[parts.length - 1] ?? "" };
}

/**
 * The label for one action row. Verb only when the action lives in the same module as the
 * screen's gate ("Edit"), verb plus noun when it crosses into another one ("Grade
 * submissions"), so a row never reads as if it applied to the screen it is nested under.
 */
export function actionLabel(key: string, gateKey: string, fallbackLabel: string): string {
  const override = ACTION_LABEL_OVERRIDES[key];
  if (override) return override;

  const { module, action } = splitKey(key);
  const verb = ACTION_VERBS[action];
  if (!verb) return fallbackLabel;

  if (module === splitKey(gateKey).module) return verb;
  return `${verb} ${describeModule(module).title.toLowerCase()}`;
}

/** Which leftover bucket a key falls into, and in what order the buckets render. */
function extraBucketFor(key: string): { id: string; label: string; description: string; order: number } {
  const { module } = splitKey(key);

  if (UNUSED_COMBINATIONS.has(key)) {
    return {
      id: "unused",
      label: "Generated combinations nothing uses",
      description:
        "The catalog was seeded as a grid of every module crossed with every action, which produced some pairings the product never had, such as converting an invoice. No screen or endpoint reads these.",
      order: 2,
    };
  }
  if (isLegacyScaffoldModule(module)) {
    return {
      id: "legacy",
      label: "Legacy keys that grant nothing",
      description:
        "Left over from the platform's original scaffold. Nothing in the product checks these, so switching one on has no effect. They are shown only so a role's saved grants are never silently dropped.",
      order: 4,
    };
  }
  if (RETIRED_MODULES.has(module)) {
    return {
      id: "retired",
      label: "Removed features",
      description: "Permissions for features that were built and then taken out of the product. Nothing reads them now.",
      order: 3,
    };
  }
  if (STUDENT_APP_MODULES.has(module)) {
    return {
      id: "student",
      label: "Student portal and personal settings",
      description:
        "Held by students, mentors and by every member of staff for their OWN account. None of these open a CRM screen, which is why they are not in the sections above.",
      order: 0,
    };
  }
  return {
    id: "other",
    label: "Not tied to a CRM screen",
    description: "Permissions that no screen in the sidebar uses. Usually a backend endpoint or a public route.",
    order: 1,
  };
}

/**
 * Build the whole editor model from the live catalog.
 *
 * Every catalog entry lands in exactly one place: a screen's gate, a screen's action, or
 * one of the extra groups. Nothing is dropped (see the file header on full-replace saves),
 * and nothing is invented — a key the map names but the catalog does not contain is
 * skipped, so a stale entry here renders a dead row rather than an unsaveable one.
 */
export function buildPermissionModel(catalog: PermissionCatalogEntry[]): PermissionModel {
  const byKey = new Map(catalog.map((entry) => [entry.key, entry]));
  const claimed = new Set<string>();

  // A leaf gated on something that is really another screen's ACTION (Leads ▸ Import is
  // gated on `leads.create`) must not become a screen of its own — it would render the
  // same toggle twice, once as a parent and once as a child of the screen it belongs to.
  const actionKeys = new Set(Object.values(SCREEN_ACTIONS).flat());

  // Pass 1: collect every (gate, section) pairing the sidebar declares, before any row is
  // built. A gate can appear in several sections — `content.view` opens Content ▸ Resources
  // AND three Website screens — and it is ONE permission, so it must render as ONE toggle.
  // Two toggles for one key would disagree with each other the moment either is pressed.
  interface GateUse {
    sections: Map<string, { leaves: string[]; path?: string }>;
  }
  const gateUses = new Map<string, GateUse>();
  const noteGate = (
    gate: string | undefined,
    sectionLabel: string,
    leafLabel: string,
    path: string | undefined,
  ): void => {
    if (!gate) return; // Dashboard and Analytics ▸ Overview need no permission at all.
    if (!byKey.has(gate)) return; // Not in the seeded catalog — there is nothing to toggle.
    if (actionKeys.has(gate)) return; // Belongs to another screen as an action.
    const use = gateUses.get(gate) ?? { sections: new Map() };
    const inSection = use.sections.get(sectionLabel) ?? { leaves: [], path };
    if (!inSection.leaves.includes(leafLabel)) inSection.leaves.push(leafLabel);
    use.sections.set(sectionLabel, inSection);
    gateUses.set(gate, use);
  };

  for (const section of NAV_SECTIONS) {
    // A section with no children IS the screen (Onboarding, Search Engine, Two-Factor Auth).
    if (!section.children) {
      noteGate(section.permission, section.label, section.label, section.to);
      continue;
    }
    for (const leaf of section.children) noteGate(leaf.permission, section.label, leaf.label, leaf.to);
  }
  for (const [sectionLabel, screens] of Object.entries(OFF_MENU_SCREENS)) {
    for (const screen of screens) noteGate(screen.gate, sectionLabel, screen.label, screen.path);
  }

  // Pass 2: give each gate exactly one home section — the one holding most of its leaves,
  // overridden where that tie-breaks wrongly — and build the row there.
  const offMenuGates = new Set(Object.values(OFF_MENU_SCREENS).flat().map((screen) => screen.gate));
  const rowsBySection = new Map<string, PermissionScreenRow[]>();

  for (const [gate, use] of gateUses) {
    const uses = [...use.sections.entries()];
    const override: string | undefined = GATE_HOME_SECTION[gate];
    const overridden = override === undefined ? undefined : uses.find(([label]) => label === override);
    const home =
      overridden ??
      uses.reduce((best, current) => (current[1].leaves.length > best[1].leaves.length ? current : best));

    claimed.add(gate);
    const actions: PermissionActionRow[] = [];
    for (const actionKey of SCREEN_ACTIONS[gate] ?? []) {
      const entry = byKey.get(actionKey);
      if (!entry || claimed.has(actionKey)) continue;
      claimed.add(actionKey);
      actions.push({ key: actionKey, label: actionLabel(actionKey, gate, entry.label) });
    }

    const rows = rowsBySection.get(home[0]) ?? [];
    rows.push({
      gate,
      screens: home[1].leaves,
      path: home[1].path,
      actions,
      // Named as "Section ▸ Leaf" so the warning is actionable: this one toggle also
      // controls a screen filed somewhere else, and turning it off will remove that too.
      alsoIn: uses
        .filter(([label]) => label !== home[0])
        .flatMap(([label, value]) => value.leaves.map((leaf) => (leaf === label ? label : `${label} ▸ ${leaf}`))),
      offMenu: offMenuGates.has(gate) || undefined,
    });
    rowsBySection.set(home[0], rows);
  }

  // Pass 3: emit sections in sidebar order, skipping any left with no rows.
  const sectionOrder = [...NAV_SECTIONS.map((section) => section.label), ...Object.keys(OFF_MENU_SCREENS)];
  const sections: PermissionSectionRow[] = [];
  const seenSections = new Set<string>();
  for (const label of sectionOrder) {
    if (seenSections.has(label)) continue;
    seenSections.add(label);
    const rows = rowsBySection.get(label);
    if (!rows?.length) continue;
    sections.push({
      label,
      caption: NAV_SECTIONS.find((section) => section.label === label)?.group,
      screens: rows,
    });
  }

  // Pass 4: whatever the sidebar never claimed. Grouped so the reason it is here is on
  // screen, rather than left as an unexplained tail of keys.
  const buckets = new Map<string, PermissionExtraRow & { order: number }>();
  for (const entry of catalog) {
    if (claimed.has(entry.key)) continue;
    const bucket = extraBucketFor(entry.key);
    const existing = buckets.get(bucket.id);
    const row: PermissionActionRow = {
      key: entry.key,
      // No gate to sit under, so these read as verb + noun ("Read forum"), never a bare verb.
      label: actionLabel(entry.key, "", entry.label),
    };
    if (existing) {
      existing.permissions.push(row);
    } else {
      buckets.set(bucket.id, { ...bucket, permissions: [row] });
    }
  }

  const extras = [...buckets.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...rest }) => rest);

  return { sections, extras };
}
