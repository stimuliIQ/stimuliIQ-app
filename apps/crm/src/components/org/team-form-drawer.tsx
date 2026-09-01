// Team editor — name, manager, team lead and the roster, in one drawer.
//
// Everything about a team is edited here rather than across a list screen and a detail page,
// because the four fields are one decision: naming a lead while somebody is still listed as
// a member is exactly the mistake `validateTeamAssignment` refuses, and splitting the form
// would let you make it in two steps and only discover it on the second.
//
// The assignment rules are checked HERE with the same shared function the API runs
// (`validateTeamAssignment`, @repo/types), so the problem is named before submit rather than
// coming back as a 422. The API is still the actual refuser — this is a preview, not the
// gate (CLAUDE.md §3.5).
import * as React from "react";
import {
  Alert,
  Button,
  CheckboxField,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  Input,
  Select,
  SelectItem,
  Skeleton,
  useToast,
} from "@repo/ui";
import type { Team, TeamAssignmentIssueCode } from "@repo/types";
import { validateTeamAssignment } from "@repo/types";

import {
  useAssignableStaff,
  useCreateTeam,
  useSetTeamMembers,
  useTeam,
  useUpdateTeam,
} from "../../hooks/use-org";
import { surfaceError } from "../../lib/surface-error";

/** Copy for each rule the shared validator can report. Mirrors the API's own wording. */
const ISSUE_TEXT: Record<TeamAssignmentIssueCode, string> = {
  manager_is_lead:
    "The manager and the team lead have to be different people — otherwise both approval steps are the same signature.",
  manager_is_member: "The manager can't also be a member of the team they manage.",
  lead_is_member: "The team lead can't also be listed as a member of their own team.",
};

/** The picker's "nobody" option. A real value, so clearing a lead is a choice, not a blank. */
const NONE = "__none__";

export interface TeamFormDrawerProps {
  team: Team | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TeamFormDrawer({ team, open, onOpenChange }: TeamFormDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const isEdit = Boolean(team);

  const { data: staff, isLoading: staffLoading } = useAssignableStaff();
  const { data: detail, isLoading: detailLoading } = useTeam(open && team ? team.id : null);
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const setMembers = useSetTeamMembers();

  const [name, setName] = React.useState("");
  const [managerUserId, setManagerUserId] = React.useState<string>(NONE);
  const [leadUserId, setLeadUserId] = React.useState<string>(NONE);
  const [memberIds, setMemberIds] = React.useState<string[]>([]);
  const [nameError, setNameError] = React.useState<string | null>(null);

  // Seed from the fetched team, and again when a different team is opened.
  React.useEffect(() => {
    if (!open) return;
    if (!team) {
      setName("");
      setManagerUserId(NONE);
      setLeadUserId(NONE);
      setMemberIds([]);
      setNameError(null);
      return;
    }
    if (!detail) return;
    setName(detail.name);
    setManagerUserId(detail.manager?.id ?? NONE);
    setLeadUserId(detail.lead?.id ?? NONE);
    setMemberIds(detail.members.map((m) => m.id));
    setNameError(null);
  }, [open, team, detail]);

  const people = staff ?? [];

  // Run the same rules the API will. Shown as you type, so the combination is refused before
  // anyone waits on a round trip to be told.
  const issues = validateTeamAssignment({
    managerUserId: managerUserId === NONE ? null : managerUserId,
    leadUserId: leadUserId === NONE ? null : leadUserId,
    memberUserIds: memberIds,
  });

  const busy = createTeam.isPending || updateTeam.isPending || setMembers.isPending;
  const loading = staffLoading || (isEdit && detailLoading);

  function toggleMember(userId: string): void {
    setMemberIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  async function handleSave(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Give the team a name");
      return;
    }
    if (issues.length > 0) return;

    const body = {
      name: trimmed,
      managerUserId: managerUserId === NONE ? null : managerUserId,
      leadUserId: leadUserId === NONE ? null : leadUserId,
    };

    try {
      if (team) {
        await updateTeam.mutateAsync({ id: team.id, body });
        // The roster is a separate call because it is a separate endpoint — one PUT for the
        // whole list, so a dropped request never leaves the team half-changed.
        await setMembers.mutateAsync({ id: team.id, body: { userIds: memberIds } });
        toast({ title: "Team updated", variant: "success" });
      } else {
        const created = await createTeam.mutateAsync({ ...body, active: true });
        if (memberIds.length > 0) {
          await setMembers.mutateAsync({ id: created.id, body: { userIds: memberIds } });
        }
        toast({
          title: `“${trimmed}” created`,
          description: "Its members' leave now goes to the team lead, then the manager.",
          variant: "success",
        });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, team ? "Couldn't update this team" : "Couldn't create this team");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={isEdit ? "Edit team" : "New team"}
        description={
          isEdit
            ? team?.name
            : "A team has one manager, one team lead and its members. It decides who approves their leave."
        }
        size="lg"
        data-testid="team-form-drawer"
      >
        <DrawerBody>
          {loading ? (
            <div className="flex flex-col gap-3" data-testid="team-form-loading">
              <Skeleton shape="line" />
              <Skeleton shape="line" />
              <Skeleton shape="block" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Input
                label="Team name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                error={nameError ?? undefined}
                placeholder="Sales, Support, Faculty…"
                data-testid="team-form-name"
              />

              <Select
                label="Manager"
                value={managerUserId}
                onValueChange={setManagerUserId}
                helperText="Confirms leave the team lead has already approved. Their own leave goes to the super admin."
                data-testid="team-form-manager"
              >
                <SelectItem value={NONE}>No manager yet</SelectItem>
                {people.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </Select>

              <Select
                label="Team lead"
                value={leadUserId}
                onValueChange={setLeadUserId}
                helperText="Approves their team's leave first. Their own leave goes straight to the manager."
                data-testid="team-form-lead"
              >
                <SelectItem value={NONE}>No team lead yet</SelectItem>
                {people.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </Select>

              {issues.length > 0 ? (
                <Alert tone="danger" title="That combination isn't allowed" data-testid="team-form-issues">
                  {issues.map((issue) => (
                    <p key={issue}>{ISSUE_TEXT[issue]}</p>
                  ))}
                </Alert>
              ) : null}

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-fg">Members</legend>
                <p className="text-xs text-fg-muted">
                  Somebody already on another team moves to this one when you save — a person is on
                  one team at a time.
                </p>
                <div className="max-h-72 overflow-y-auto rounded-md border border-border p-2">
                  {people.length === 0 ? (
                    <p className="p-2 text-sm text-fg-muted">No staff accounts to add yet.</p>
                  ) : (
                    people.map((person) => {
                      // Say WHERE they currently are rather than hiding them. A name missing
                      // from a list with no explanation reads as a broken dropdown.
                      const elsewhere =
                        person.teamId && person.teamId !== team?.id ? " · on another team" : "";
                      return (
                        <CheckboxField
                          key={person.id}
                          label={`${person.name}${elsewhere}`}
                          checked={memberIds.includes(person.id)}
                          onCheckedChange={() => toggleMember(person.id)}
                          data-testid={`team-member-${person.id}`}
                        />
                      );
                    })
                  )}
                </div>
              </fieldset>
            </div>
          )}
        </DrawerBody>
        <DrawerFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            loading={busy}
            disabled={loading || issues.length > 0}
            data-testid="team-form-save"
          >
            {isEdit ? "Save team" : "Create team"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
