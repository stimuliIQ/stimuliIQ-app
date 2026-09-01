// Typed org-hierarchy SDK (CRM). Spec: docs/specs/org-teams.md, ADR-0069.
// Exposed on the SDK as `client.crm.org.*`.
//
// Reads are gated on `org.teams.view` and writes on `org.teams.manage`. Callers must hide
// the write buttons behind that permission — the API is the real enforcement
// (CLAUDE.md §3.5) — and `org.teams.manage` is narrower than it looks: because the approval
// rule is uniform and the hierarchy is data, whoever can edit teams decides who signs off
// whose leave.
//
// `myPosition()` needs no permission beyond being signed in. It takes no user id at all, so
// the subject is always the session user and there is nothing to tamper with — the same
// structural own-scope as `client.crm.marketingTargets.mine()`.

import type {
  CreateTeamRequest,
  ListTeamsQuery,
  MyOrgPosition,
  SetTeamMembersRequest,
  Team,
  TeamDetail,
  UpdateTeamRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

/** A staff member offered in the manager / lead / member pickers. */
export interface AssignableStaff {
  id: string;
  name: string;
  email: string;
  /** Their current team, so the picker can say "already on Sales" rather than hiding them. */
  teamId: string | null;
}

export class OrgApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/org/teams */
  async listTeams(query: ListTeamsQuery) {
    return this.client.requestPaginated<Team>("GET", `/api/v1/crm/org/teams${toQueryString(query)}`);
  }

  /** GET /api/v1/crm/org/teams/:id — the team plus its roster. */
  async getTeam(id: string): Promise<TeamDetail> {
    return this.client.request<TeamDetail>("GET", `/api/v1/crm/org/teams/${id}`);
  }

  /** GET /api/v1/crm/org/staff — the pool for the manager / lead / member pickers. */
  async listStaff(): Promise<AssignableStaff[]> {
    return this.client.request<AssignableStaff[]>("GET", "/api/v1/crm/org/staff");
  }

  /** POST /api/v1/crm/org/teams */
  async createTeam(body: CreateTeamRequest): Promise<Team> {
    return this.client.request<Team>("POST", "/api/v1/crm/org/teams", { body });
  }

  /** PATCH /api/v1/crm/org/teams/:id */
  async updateTeam(id: string, body: UpdateTeamRequest): Promise<Team> {
    return this.client.request<Team>("PATCH", `/api/v1/crm/org/teams/${id}`, { body });
  }

  /**
   * PUT /api/v1/crm/org/teams/:id/members — the WHOLE roster in one call, not add/remove.
   * A partial API would need the client to diff, and a dropped request would leave the team
   * half-changed with nothing saying so.
   */
  async setTeamMembers(id: string, body: SetTeamMembersRequest): Promise<TeamDetail> {
    return this.client.request<TeamDetail>("PUT", `/api/v1/crm/org/teams/${id}/members`, { body });
  }

  /** DELETE /api/v1/crm/org/teams/:id — disbands it and detaches every member. */
  async deleteTeam(id: string): Promise<void> {
    await this.client.request<void>("DELETE", `/api/v1/crm/org/teams/${id}`);
  }

  /** GET /api/v1/crm/org/me/position — where the signed-in person sits. */
  async myPosition(): Promise<MyOrgPosition> {
    return this.client.request<MyOrgPosition>("GET", "/api/v1/crm/org/me/position");
  }
}
