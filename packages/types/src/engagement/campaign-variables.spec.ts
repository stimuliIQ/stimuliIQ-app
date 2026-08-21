// Campaign template variables, the shared contract between the sender and the editor.
//
// These two had drifted completely and nothing caught it: seeded templates were written
// with {{name}}, {{program_title}}, {{deadline}} and {{cta_url}}, the sender substituted
// only `to` and `campaignName`, and the renderer leaves unknown placeholders ALONE by
// design, so campaigns reached students reading "Hi {{name}},".
//
// The list is now one exported constant that the dispatch path builds from and the CRM
// editor advertises. These tests pin the piece a UI can't: that the detector agrees with
// that list, so the warning shown while someone types matches what the sender will do.

import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_TEMPLATE_VARIABLES,
  CAMPAIGN_TEMPLATE_VARIABLE_KEYS,
  findUnknownTemplateVariables,
} from "./campaigns.schemas.js";

describe("CAMPAIGN_TEMPLATE_VARIABLES", () => {
  it("every variable carries a description staff can act on", () => {
    for (const variable of CAMPAIGN_TEMPLATE_VARIABLES) {
      expect(variable.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(variable.description.length).toBeGreaterThan(5);
    }
  });

  it("exposes the keys the sender fills", () => {
    // If this list changes, CampaignsService#buildRecipientVariables must change with it,
    // a key here that the sender doesn't populate ships as literal braces again.
    expect([...CAMPAIGN_TEMPLATE_VARIABLE_KEYS].sort()).toEqual([
      "campaign_name",
      "name",
      "program_title",
      "to",
    ]);
  });
});

describe("findUnknownTemplateVariables", () => {
  it("passes a message using only supported variables", () => {
    expect(findUnknownTemplateVariables("Hi {{name}}, your {{program_title}} starts soon.")).toEqual([]);
  });

  it("flags a placeholder the sender will not replace", () => {
    expect(findUnknownTemplateVariables("Hi {{firstName}}, see you on {{date}}.")).toEqual([
      "firstName",
      "date",
    ]);
  });

  it("reports each unknown placeholder once, however often it appears", () => {
    expect(findUnknownTemplateVariables("{{deadline}} … {{deadline}} … {{deadline}}")).toEqual([
      "deadline",
    ]);
  });

  it("tolerates the whitespace people actually type", () => {
    expect(findUnknownTemplateVariables("Hi {{ name }}, {{  program_title  }}")).toEqual([]);
  });

  it("finds nothing in a message with no placeholders", () => {
    expect(findUnknownTemplateVariables("Enrollment closes on Friday. Reply to reserve a seat.")).toEqual([]);
  });

  // WhatsApp templates approved through Meta use positional {{1}}..{{n}}, which the PROVIDER
  // fills from its own parameters payload, not our renderer. They are correctly reported as
  // unknown here; the CRM shows that warning, and the seeded WhatsApp template documents why
  // it keeps them.
  it("treats Meta's positional placeholders as not-ours-to-substitute", () => {
    expect(findUnknownTemplateVariables("Hi {{1}}, the *{{2}}* batch starts {{3}}")).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});
