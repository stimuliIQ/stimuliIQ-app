// Typed staff-leave SDK (CRM), split the same way the API is — by audience, not by resource:
//   `client.crm.leave.requests.*`   what any member of staff does: apply, withdraw, look
//   `client.crm.leave.approvals.*`  the decisions — super_admin only
//   `client.crm.leave.setup.*`      types, allowances, holidays, the working week
//
// Note that the setup READS sit on `leave.view` server-side, not `leave.manage`: the apply
// form needs the leave types and the calendar needs the holidays, so ordinary staff can call
// `setup.listTypes` / `setup.listHolidays` / `setup.getSettings`. Only the writes 403.

import type {
  ApproveLeaveRequestRequest,
  CreateHolidayRequest,
  CreateLeaveRequestRequest,
  CreateLeaveTypeRequest,
  GetLeaveApplyContextQuery,
  GetLeaveBalancesQuery,
  GetLeaveCalendarQuery,
  Holiday,
  LeaveApplyContext,
  LeaveBalancesResponse,
  LeaveCalendarResponse,
  LeaveQuota,
  LeaveRequestDetail,
  LeaveRequestSummary,
  LeaveSetting,
  LeaveType,
  ListHolidaysQuery,
  ListLeaveQuotasQuery,
  ListLeaveRequestsQuery,
  ListLeaveTypesQuery,
  RejectLeaveRequestRequest,
  SaveLeaveQuotasRequest,
  UpdateHolidayRequest,
  UpdateLeaveSettingRequest,
  UpdateLeaveTypeRequest,
} from "@repo/types";
import type { OffsetPaginationMeta } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class LeaveRequestsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/crm/leave/apply-context — the working week, holidays, leave types and the
   * caller's balances in one call, so the apply form's live day count is computed against
   * exactly the data the API will use to check it.
   */
  async applyContext(query: GetLeaveApplyContextQuery = {}): Promise<LeaveApplyContext> {
    return this.client.request<LeaveApplyContext>(
      "GET",
      `/api/v1/crm/leave/apply-context${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/leave/balances — the caller's, or somebody else's at scope=all. */
  async balances(query: GetLeaveBalancesQuery = {}): Promise<LeaveBalancesResponse> {
    return this.client.request<LeaveBalancesResponse>(
      "GET",
      `/api/v1/crm/leave/balances${toQueryString(query)}`,
    );
  }

  /**
   * GET /api/v1/crm/leave/calendar — holidays, weekly offs and who is out.
   *
   * Team-wide at every permission level, and deliberately carries NO reason field: the
   * calendar answers "who is off on Thursday", never "why".
   */
  async calendar(query: GetLeaveCalendarQuery): Promise<LeaveCalendarResponse> {
    return this.client.request<LeaveCalendarResponse>(
      "GET",
      `/api/v1/crm/leave/calendar${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/leave/requests — own requests at scope=own, everybody's at scope=all. */
  async list(
    query: ListLeaveRequestsQuery,
  ): Promise<{ items: LeaveRequestSummary[]; meta: OffsetPaginationMeta }> {
    return this.client.requestPaginated<LeaveRequestSummary>(
      "GET",
      `/api/v1/crm/leave/requests${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/leave/requests/:id — 404 (not 403) for somebody else's row at own scope. */
  async get(id: string): Promise<LeaveRequestDetail> {
    return this.client.request<LeaveRequestDetail>("GET", `/api/v1/crm/leave/requests/${id}`);
  }

  /**
   * POST /api/v1/crm/leave/requests.
   *
   * There is no user id in the body by design — the applicant is always the session user, so
   * nobody can file leave in a colleague's name. The duration is not sent either: the server
   * recomputes it from its own holiday list.
   */
  async create(
    body: CreateLeaveRequestRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LeaveRequestDetail> {
    return this.client.request<LeaveRequestDetail>("POST", "/api/v1/crm/leave/requests", {
      body,
      idempotencyKey,
    });
  }

  /** POST /api/v1/crm/leave/requests/:id/cancel — withdraw your own request. */
  async cancel(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<LeaveRequestDetail> {
    return this.client.request<LeaveRequestDetail>(
      "POST",
      `/api/v1/crm/leave/requests/${id}/cancel`,
      { idempotencyKey },
    );
  }
}

export class LeaveApprovalsApi {
  constructor(private readonly client: ApiClient) {}

  /** POST /api/v1/crm/leave/approvals/:id/approve — `leave.approve`, super_admin only. */
  async approve(
    id: string,
    body: ApproveLeaveRequestRequest = {},
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LeaveRequestDetail> {
    return this.client.request<LeaveRequestDetail>(
      "POST",
      `/api/v1/crm/leave/approvals/${id}/approve`,
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/crm/leave/approvals/:id/reject.
   *
   * The reason is mandatory and is emailed to the applicant verbatim — a rejection with no
   * explanation is what makes people re-apply for the same dates.
   */
  async reject(
    id: string,
    body: RejectLeaveRequestRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LeaveRequestDetail> {
    return this.client.request<LeaveRequestDetail>(
      "POST",
      `/api/v1/crm/leave/approvals/${id}/reject`,
      { body, idempotencyKey },
    );
  }
}

export class LeaveSetupApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/leave/setup/types — `leave.view`; pass `activeOnly: false` for setup. */
  async listTypes(query: ListLeaveTypesQuery = { activeOnly: true }): Promise<LeaveType[]> {
    return this.client.request<LeaveType[]>("GET", `/api/v1/crm/leave/setup/types${toQueryString(query)}`);
  }

  async createType(
    body: CreateLeaveTypeRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LeaveType> {
    return this.client.request<LeaveType>("POST", "/api/v1/crm/leave/setup/types", { body, idempotencyKey });
  }

  /** No `key` in the body: it is immutable after create so historical rows stay joinable. */
  async updateType(
    id: string,
    body: UpdateLeaveTypeRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LeaveType> {
    return this.client.request<LeaveType>("PATCH", `/api/v1/crm/leave/setup/types/${id}`, {
      body,
      idempotencyKey,
    });
  }

  /** Refused with 409 once any request uses the type — deactivate it instead. */
  async deleteType(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/leave/setup/types/${id}`, {
      idempotencyKey,
    });
  }

  async listQuotas(query: ListLeaveQuotasQuery): Promise<LeaveQuota[]> {
    return this.client.request<LeaveQuota[]>("GET", `/api/v1/crm/leave/setup/quotas${toQueryString(query)}`);
  }

  /** PUT — the whole year's allowances at once, so a save can never land half-applied. */
  async saveQuotas(
    body: SaveLeaveQuotasRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LeaveQuota[]> {
    return this.client.request<LeaveQuota[]>("PUT", "/api/v1/crm/leave/setup/quotas", {
      body,
      idempotencyKey,
    });
  }

  async listHolidays(query: ListHolidaysQuery): Promise<Holiday[]> {
    return this.client.request<Holiday[]>("GET", `/api/v1/crm/leave/setup/holidays${toQueryString(query)}`);
  }

  async createHoliday(
    body: CreateHolidayRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<Holiday> {
    return this.client.request<Holiday>("POST", "/api/v1/crm/leave/setup/holidays", {
      body,
      idempotencyKey,
    });
  }

  async updateHoliday(
    id: string,
    body: UpdateHolidayRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<Holiday> {
    return this.client.request<Holiday>("PATCH", `/api/v1/crm/leave/setup/holidays/${id}`, {
      body,
      idempotencyKey,
    });
  }

  /** Deleting a holiday does NOT re-measure leave already taken across it (by design). */
  async deleteHoliday(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/leave/setup/holidays/${id}`, {
      idempotencyKey,
    });
  }

  async getSettings(): Promise<LeaveSetting> {
    return this.client.request<LeaveSetting>("GET", "/api/v1/crm/leave/setup/settings");
  }

  async updateSettings(
    body: UpdateLeaveSettingRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LeaveSetting> {
    return this.client.request<LeaveSetting>("PATCH", "/api/v1/crm/leave/setup/settings", {
      body,
      idempotencyKey,
    });
  }
}

/** Namespace holder so the CRM SDK reads `client.crm.leave.requests` / `.approvals` / `.setup`. */
export class LeaveApi {
  readonly requests: LeaveRequestsApi;
  readonly approvals: LeaveApprovalsApi;
  readonly setup: LeaveSetupApi;

  constructor(client: ApiClient) {
    this.requests = new LeaveRequestsApi(client);
    this.approvals = new LeaveApprovalsApi(client);
    this.setup = new LeaveSetupApi(client);
  }
}
