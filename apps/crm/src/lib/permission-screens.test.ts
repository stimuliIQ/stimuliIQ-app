import { describe, expect, it } from "vitest";
import type { PermissionCatalogEntry } from "@repo/types";

import { actionLabel, buildPermissionModel } from "./permission-screens";

function catalog(...keys: string[]): PermissionCatalogEntry[] {
  return keys.map((key) => ({
    key,
    module: key.split(".")[0]!,
    action: key.split(".").pop()! as PermissionCatalogEntry["action"],
    label: key,
  }));
}

function findScreen(model: ReturnType<typeof buildPermissionModel>, gate: string) {
  return model.sections.flatMap((section) => section.screens).find((screen) => screen.gate === gate);
}

describe("buildPermissionModel", () => {
  it("files a screen under its sidebar section and hangs its actions off it", () => {
    const model = buildPermissionModel(catalog("batches.view", "batches.create", "batches.delete"));
    const section = model.sections.find((s) => s.label === "Academics");

    expect(section).toBeDefined();
    const batches = section?.screens.find((s) => s.gate === "batches.view");
    expect(batches?.screens).toEqual(["Batches"]);
    expect(batches?.actions.map((a) => a.key)).toEqual(["batches.create", "batches.delete"]);
  });

  it("renders a gate used by two sections as ONE toggle, and says where else it applies", () => {
    // `content.view` opens Content ▸ Resources and three Website screens. Two toggles for
    // one key would disagree with each other the moment either was pressed.
    const model = buildPermissionModel(catalog("content.view"));
    const rows = model.sections.flatMap((s) => s.screens).filter((s) => s.gate === "content.view");

    expect(rows).toHaveLength(1);
    expect(model.sections.find((s) => s.screens.includes(rows[0]!))?.label).toBe("Website");
    expect(rows[0]?.alsoIn).toContain("Content ▸ Resources");
  });

  it("does not turn a leaf gated on another screen's action into a screen of its own", () => {
    // Leads ▸ Import is gated on `leads.create`, which is already an action of Leads.
    const model = buildPermissionModel(catalog("leads.view", "leads.create"));
    expect(findScreen(model, "leads.create")).toBeUndefined();
    expect(findScreen(model, "leads.view")?.actions.map((a) => a.key)).toEqual(["leads.create"]);
  });

  it("keeps every catalog key exactly once, because saving is a full replace", () => {
    // A key this model drops is not hidden on save, it is REVOKED. Anything the sidebar
    // does not claim has to land in an extra group instead.
    const keys = [
      "batches.view",
      "batches.create",
      "content.view",
      "leads.view",
      "leads.create",
      "forum.read",
      "liveclass.view",
      "user.update",
      "invoices.convert",
      "something.entirely.new",
    ];
    const model = buildPermissionModel(catalog(...keys));

    const rendered = [
      ...model.sections.flatMap((s) => s.screens).flatMap((s) => [s.gate, ...s.actions.map((a) => a.key)]),
      ...model.extras.flatMap((e) => e.permissions.map((p) => p.key)),
    ];
    expect([...rendered].sort()).toEqual([...keys].sort());
    expect(new Set(rendered).size).toBe(keys.length);
  });

  it("sorts leftovers into buckets that say why they are not on a screen", () => {
    const model = buildPermissionModel(
      catalog("forum.read", "liveclass.view", "user.update", "invoices.convert", "certificates.verify"),
    );
    const bucketOf = (key: string) => model.extras.find((e) => e.permissions.some((p) => p.key === key))?.id;

    expect(bucketOf("forum.read")).toBe("student");
    expect(bucketOf("liveclass.view")).toBe("retired");
    expect(bucketOf("user.update")).toBe("legacy");
    expect(bucketOf("invoices.convert")).toBe("unused");
    expect(bucketOf("certificates.verify")).toBe("other");
  });

  it("shows reports that exist but were taken off the menu, rather than filing them as orphans", () => {
    const model = buildPermissionModel(catalog("reports.forum.view"));
    const row = findScreen(model, "reports.forum.view");

    expect(row?.screens).toEqual(["Forum Health"]);
    expect(row?.offMenu).toBe(true);
    expect(model.extras).toHaveLength(0);
  });

  it("skips a mapped key the catalog does not actually contain", () => {
    const model = buildPermissionModel(catalog("batches.view"));
    expect(findScreen(model, "batches.view")?.actions).toEqual([]);
  });

  it("omits a section once nothing in it survives", () => {
    const model = buildPermissionModel(catalog("batches.view"));
    expect(model.sections.map((s) => s.label)).toEqual(["Academics"]);
  });
});

describe("actionLabel", () => {
  it("uses the bare verb when the action lives in the screen's own module", () => {
    expect(actionLabel("batches.create", "batches.view", "Create batches")).toBe("Add");
  });

  it("adds the noun when the action crosses into another module", () => {
    // Under Assignments, a bare "Grade" would read as grading the assignment itself.
    expect(actionLabel("submissions.grade", "assignments.view", "Grade Submissions")).toBe("Grade submissions");
  });

  it("prefers a hand-written label where the generated one would mislead", () => {
    expect(actionLabel("leads.create", "leads.view", "Create leads")).toBe("Add or import leads");
  });

  it("falls back to the catalog's own label for a verb it does not know", () => {
    expect(actionLabel("widgets.frobnicate", "widgets.view", "Frobnicate widgets")).toBe("Frobnicate widgets");
  });
});
