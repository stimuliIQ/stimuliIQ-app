// OwnerSelect — the single control for "who owns this lead", used everywhere a lead
// changes hands: the detail drawer, the create form, the pipeline's bulk toolbar, and
// (in filter mode) the pipeline's owner filter.
//
// WHY THIS EXISTS: every one of those places previously asked the user to type a raw
// user UUID into a text box. That is not a small UX wrinkle — it made correct assignment
// practically impossible without a database query, so in practice leads were left with
// whoever the round-robin picked and reassignment never happened. A picker is the whole
// feature; the API endpoint behind it (GET /crm/leads/assignable-users, gated on
// `leads.view` rather than admin-only `users.view`) exists specifically so the people who
// assign leads can see the list.
//
// The open-lead count next to each name is the other half: handing a lead to whoever is
// top of the alphabet is how one rep ends up with 200 leads and another with 12.
import * as React from "react";
import { Select, SelectItem } from "@repo/ui";

import { useAssignableUsers } from "../../hooks/use-leads";

/**
 * Radix Select cannot hold an empty-string item value, so the two "not a user" choices
 * need sentinels. They are module-level constants rather than inline strings so a typo
 * in one branch cannot silently create a third, unhandled option.
 */
const UNASSIGNED_VALUE = "__unassigned__";
const ANY_OWNER_VALUE = "__any__";
/** "Assigned to me" — resolved to the caller server-side, so no user id is needed here. */
export const MINE_VALUE = "__mine__";

export interface OwnerSelectProps {
  /** Selected user id, or null for "unassigned"/"any" depending on `mode`. */
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  disabled?: boolean;
  wrapperClassName?: string;
  "data-testid"?: string;
  /**
   * `assign` — picking a person is the point; offers "Unassigned" to clear ownership.
   * `filter` — offers "All owners", "Assigned to me", and "Unassigned" as filter values.
   */
  mode?: "assign" | "filter";
  /** Filter mode only: the current selection when it is the MINE sentinel. */
  mineSelected?: boolean;
  /** Filter mode only: called when the user picks "Assigned to me". */
  onSelectMine?: () => void;
  /** Filter mode only: called when the user picks "Unassigned". */
  onSelectUnassigned?: () => void;
  /** Filter mode only: true when the "Unassigned" filter is active. */
  unassignedSelected?: boolean;
}

/** "Priya Sharma · counsellor · 12 open" — role and load in the option itself, since a bare name tells you nothing about who to pick. */
function describeUser(user: { name: string; roleKeys: string[]; openLeadCount: number }): string {
  const role = user.roleKeys[0] ?? "staff";
  return `${user.name} · ${role} · ${user.openLeadCount} open`;
}

export function OwnerSelect({
  value,
  onChange,
  label = "Owner",
  disabled,
  wrapperClassName,
  "data-testid": testId = "owner-select",
  mode = "assign",
  mineSelected = false,
  onSelectMine,
  onSelectUnassigned,
  unassignedSelected = false,
}: OwnerSelectProps): React.JSX.Element {
  const { data: users, isLoading, isError } = useAssignableUsers();

  const selectValue = React.useMemo(() => {
    if (mode === "filter") {
      if (mineSelected) return MINE_VALUE;
      if (unassignedSelected) return UNASSIGNED_VALUE;
      return value ?? ANY_OWNER_VALUE;
    }
    return value ?? UNASSIGNED_VALUE;
  }, [mode, mineSelected, unassignedSelected, value]);

  function handleChange(next: string) {
    if (next === MINE_VALUE) {
      onSelectMine?.();
      return;
    }
    if (next === UNASSIGNED_VALUE) {
      if (mode === "filter") {
        onSelectUnassigned?.();
        return;
      }
      onChange(null);
      return;
    }
    if (next === ANY_OWNER_VALUE) {
      onChange(null);
      return;
    }
    onChange(next);
  }

  // A failed staff lookup must not present an empty dropdown that reads as "nobody can
  // own a lead" — that would invite the user to unassign a lead to "fix" it. Say what
  // actually happened instead, and disable the control.
  const errorText = isError ? "Couldn't load the team list — refresh to try again." : undefined;

  return (
    <Select
      label={label}
      value={selectValue}
      onValueChange={handleChange}
      disabled={disabled || isLoading || isError}
      error={errorText}
      wrapperClassName={wrapperClassName}
      data-testid={testId}
      placeholder={isLoading ? "Loading team…" : mode === "filter" ? "All owners" : "Unassigned"}
    >
      {mode === "filter" ? <SelectItem value={ANY_OWNER_VALUE}>All owners</SelectItem> : null}
      {mode === "filter" && onSelectMine ? <SelectItem value={MINE_VALUE}>Assigned to me</SelectItem> : null}
      <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
      {(users ?? []).map((user) => (
        <SelectItem key={user.id} value={user.id}>
          {describeUser(user)}
        </SelectItem>
      ))}
    </Select>
  );
}
