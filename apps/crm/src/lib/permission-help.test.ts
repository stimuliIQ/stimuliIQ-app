import { describe, expect, it } from "vitest";

import { describeModule, describePermission } from "./permission-help";

describe("describeModule", () => {
  it("gives a known module a human title instead of its raw key", () => {
    expect(describeModule("liveclass").title).toBe("Live classes");
    expect(describeModule("marketing_targets").title).toBe("Marketing targets");
  });

  it("flags the phase-0 scaffold modules as granting nothing, and points at the live key", () => {
    const help = describeModule("user");
    expect(help.summary).toContain("granting them has no effect");
    expect(help.summary).toContain("Users permissions");
  });

  it("still returns a usable title and summary for a module it has never heard of", () => {
    const help = describeModule("some_future_thing");
    expect(help.title).toBe("Some future thing");
    expect(help.summary.length).toBeGreaterThan(0);
  });
});

describe("describePermission", () => {
  it("returns the hand-written sentence when there is one", () => {
    expect(describePermission("activities.convert", "Convert activities")).toContain("into a lead");
  });

  it("falls back to an action template for a key nobody has written help for", () => {
    // The point of the fallback: a permission seeded by a future phase must not
    // render an empty popover just because this file was not updated with it.
    expect(describePermission("widgets.create", "Create widgets")).toBe("Lets this role add new widgets.");
    expect(describePermission("widgets.export", "Export widgets")).toBe(
      "Lets this role download widgets as a spreadsheet or PDF.",
    );
  });

  it("reads the action off the LAST segment, so three-part keys are not misread", () => {
    // `careers.openings.manage` splits into module "careers" + action "openings" in the
    // API's own catalog grouping, which would describe it as neither "manage" nor useful.
    expect(describePermission("careers.openings.manage", "Manage Job Openings")).toContain("job openings");
    expect(describePermission("something.nested.view", "View nested")).toBe(
      "Lets this role open and read something.",
    );
  });

  it("marks a scaffold key as inert even when it has no hand-written entry", () => {
    expect(describePermission("program.update", "Update program")).toContain("granting it has no effect");
  });

  it("never returns an empty string, whatever the key looks like", () => {
    for (const key of ["", "weird", "a.b.c.d", "batches.markComplete"]) {
      expect(describePermission(key, "Fallback label").trim().length).toBeGreaterThan(0);
    }
  });
});
