// Learning depth resource aggregator — Phase 4, Wave 2 (docs/plans/phase-4.md task #2).
//
// Exposed on the SDK as `client.learning.*`. Each resource API is a thin typed
// wrapper over the shared ApiClient http core (cookie + CSRF + envelope
// unwrap + onUnauthorized refresh) — never hand-write fetches (CLAUDE.md §3.2).
//
// Namespace layout:
//   client.learning.assignments.*    — assignments + projects + submissions (CRM + LMS)
//   client.learning.assessments.*    — assessments + attempts (CRM + LMS)
//   client.learning.certificates.*   — certificates (CRM + LMS + public verify)
//   client.learning.storage.*        — signed upload URL (shared FE utility)
//
// Key security contracts:
//   - Answer key NEVER in any response to students:
//       client.learning.assessments.startAttempt() returns AssessmentQuestionPublic[]
//       (structurally omits answerKey; type-level assertion in @repo/types proves this).
//   - Public verify is unauthenticated: client.learning.certificates.verify(certUid)
//       requires no auth, returns minimal VerifyResult (no PII beyond holderName).
//   - Download URLs are signed, short-lived: client.learning.certificates.getDownloadUrl(id)
//       returns SignedUploadResponse.url — NEVER a raw bucket URL.
//   - Grade changes are audited: client.learning.assignments.gradeSubmission() triggers
//       server-side audit log with before/after values.
//   - Eligibility gates issuance: client.learning.certificates.issue() triggers eligibility
//       engine server-side (422 NOT_ELIGIBLE with reasons if any gate fails).

import type { ApiClient } from "../http/client.js";
import { AssignmentsApi } from "./assignments.api.js";
import { AssessmentsApi } from "./assessments.api.js";
import { CertificatesApi } from "./certificates.api.js";
import { StorageApi } from "./storage.api.js";

export class LearningApi {
  readonly assignments: AssignmentsApi;
  readonly assessments: AssessmentsApi;
  readonly certificates: CertificatesApi;
  readonly storage: StorageApi;

  constructor(client: ApiClient) {
    this.assignments = new AssignmentsApi(client);
    this.assessments = new AssessmentsApi(client);
    this.certificates = new CertificatesApi(client);
    this.storage = new StorageApi(client);
  }
}

export * from "./assignments.api.js";
export * from "./assessments.api.js";
export * from "./certificates.api.js";
export * from "./storage.api.js";
