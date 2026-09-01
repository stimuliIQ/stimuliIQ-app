// Typed onboarding SDK (CRM) — both halves of the Onboarding screen:
//   `client.crm.onboarding.fields.*`      author the question set (no deploy needed)
//   `client.crm.onboarding.submissions.*` read + triage what students sent
//
// The public form itself is `client.public.onboarding.*`.

import type {
  ApproveOnboardingSubmissionRequest,
  ApproveOnboardingSubmissionResponse,
  CreateOnboardingFieldRequest,
  DeleteOnboardingFieldResponse,
  DeleteOnboardingSubmissionResponse,
  ListOnboardingFieldsQuery,
  ListOnboardingSubmissionsQuery,
  OnboardingApprovableBatch,
  OnboardingTaggableStaff,
  OnboardingField,
  OnboardingSubmissionDetail,
  OnboardingSubmissionSummary,
  RejectOnboardingSubmissionRequest,
  ReorderOnboardingFieldsRequest,
  UpdateOnboardingFieldRequest,
  UpdateOnboardingSubmissionRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class OnboardingFieldsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/onboarding/fields — omit `active` for the full authoring view. */
  async list(query: ListOnboardingFieldsQuery = {}): Promise<OnboardingField[]> {
    return this.client.request<OnboardingField[]>("GET", `/api/v1/crm/onboarding/fields${toQueryString(query)}`);
  }

  /** POST /api/v1/crm/onboarding/fields — a new question goes to the bottom by default. */
  async create(body: CreateOnboardingFieldRequest, idempotencyKey: string = crypto.randomUUID()): Promise<OnboardingField> {
    return this.client.request<OnboardingField>("POST", "/api/v1/crm/onboarding/fields", { body, idempotencyKey });
  }

  /**
   * PATCH /api/v1/crm/onboarding/fields/:id.
   *
   * There is no `key` in the body by design: it is the join key inside every answer
   * snapshot ever collected, so renaming it would detach historical answers from the
   * question that produced them. Edit `label` instead.
   */
  async update(id: string, body: UpdateOnboardingFieldRequest, idempotencyKey: string = crypto.randomUUID()): Promise<OnboardingField> {
    return this.client.request<OnboardingField>("PATCH", `/api/v1/crm/onboarding/fields/${id}`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/onboarding/fields/:id — soft-delete; existing answers are untouched. */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<DeleteOnboardingFieldResponse> {
    return this.client.request<DeleteOnboardingFieldResponse>("DELETE", `/api/v1/crm/onboarding/fields/${id}`, { idempotencyKey });
  }

  /** POST /api/v1/crm/onboarding/fields/reorder — send EVERY field id in its new order. */
  async reorder(body: ReorderOnboardingFieldsRequest, idempotencyKey: string = crypto.randomUUID()): Promise<OnboardingField[]> {
    return this.client.request<OnboardingField[]>("POST", "/api/v1/crm/onboarding/fields/reorder", { body, idempotencyKey });
  }
}

export class OnboardingSubmissionsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/onboarding/submissions — search spans name/email/phone. */
  async list(query: ListOnboardingSubmissionsQuery) {
    return this.client.requestPaginated<OnboardingSubmissionSummary>(
      "GET",
      `/api/v1/crm/onboarding/submissions${toQueryString(query)}`,
    );
  }

  /**
   * GET /api/v1/crm/onboarding/submissions/:id — every answer, plus `attachmentUrls`:
   * short-lived SIGNED download URLs minted per request. Never cache or persist them.
   */
  async get(id: string): Promise<OnboardingSubmissionDetail> {
    return this.client.request<OnboardingSubmissionDetail>("GET", `/api/v1/crm/onboarding/submissions/${id}`);
  }

  /**
   * PATCH /api/v1/crm/onboarding/submissions/:id — notes, plus the two side-effect-free
   * decisions (reject / hold). Answers are never editable.
   *
   * Approving is NOT available here — see `approve()`.
   */
  async update(id: string, body: UpdateOnboardingSubmissionRequest, idempotencyKey: string = crypto.randomUUID()): Promise<OnboardingSubmissionDetail> {
    return this.client.request<OnboardingSubmissionDetail>("PATCH", `/api/v1/crm/onboarding/submissions/${id}`, { body, idempotencyKey });
  }

  /**
   * GET /api/v1/crm/onboarding/submissions/:id/batches — the open cohorts of the program
   * this student picked. Empty when the form captured no program.
   */
  async listBatches(id: string): Promise<OnboardingApprovableBatch[]> {
    return this.client.request<OnboardingApprovableBatch[]>("GET", `/api/v1/crm/onboarding/submissions/${id}/batches`);
  }

  /**
   * GET /api/v1/crm/onboarding/submissions/taggable-staff — who an applicant can be tagged
   * to on approval.
   *
   * Not submission-scoped (no `:id`): the candidate set is the same for every applicant, so
   * the CRM fetches it once for the screen rather than per row.
   */
  async listTaggableStaff(): Promise<OnboardingTaggableStaff[]> {
    return this.client.request<OnboardingTaggableStaff[]>("GET", `/api/v1/crm/onboarding/submissions/taggable-staff`);
  }

  /**
   * POST /api/v1/crm/onboarding/submissions/:id/approve — the decision that ACTIVATES a
   * student: creates or matches them by email, enrols them into `batchId`, promotes them to
   * Active, and emails their LMS login.
   *
   * Idempotent server-side: a submission that already carries a student is refused with
   * `onboarding.already_approved` rather than enrolling anyone twice.
   */
  async approve(id: string, body: ApproveOnboardingSubmissionRequest, idempotencyKey: string = crypto.randomUUID()): Promise<ApproveOnboardingSubmissionResponse> {
    return this.client.request<ApproveOnboardingSubmissionResponse>("POST", `/api/v1/crm/onboarding/submissions/${id}/approve`, { body, idempotencyKey });
  }

  /** POST /api/v1/crm/onboarding/submissions/:id/reject — no side effects beyond the record. */
  async reject(id: string, body: RejectOnboardingSubmissionRequest, idempotencyKey: string = crypto.randomUUID()): Promise<OnboardingSubmissionDetail> {
    return this.client.request<OnboardingSubmissionDetail>("POST", `/api/v1/crm/onboarding/submissions/${id}/reject`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/onboarding/submissions/:id — soft-delete. */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<DeleteOnboardingSubmissionResponse> {
    return this.client.request<DeleteOnboardingSubmissionResponse>("DELETE", `/api/v1/crm/onboarding/submissions/${id}`, { idempotencyKey });
  }
}

/** Namespace holder so the CRM SDK reads `client.crm.onboarding.fields` / `.submissions`. */
export class OnboardingApi {
  readonly fields: OnboardingFieldsApi;
  readonly submissions: OnboardingSubmissionsApi;

  constructor(client: ApiClient) {
    this.fields = new OnboardingFieldsApi(client);
    this.submissions = new OnboardingSubmissionsApi(client);
  }
}
