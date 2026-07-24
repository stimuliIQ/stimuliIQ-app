# ADR 0018: Lead own/assigned scope via owner_id — fail-closed, IDOR returns 404

## Status
Accepted

## Context
`docs/03-prd-crm.md §9` specifies four data scopes for CRM modules including the leads
pipeline: `all`, `branch`, `assigned`, and `own`. ADR-0009 implemented this for the P1
CRM modules (students, faculty, batches) but deferred counsellor scope on leads because
the leads table did not yet exist.

Phase-2 introduces the `leads` table and the `Counsellor` role. The scope requirement
for counsellors is: a counsellor should only see leads they own or are assigned to.
Without a concrete column to enforce this, the options are a separate assignment table
or a direct column on `leads`.

A related security requirement: reading a lead by ID (`GET /crm/leads/:id`) must not
reveal whether a lead exists to a counsellor who doesn't own it — leaking existence is
an IDOR (Insecure Direct Object Reference) vulnerability.

## Decision

### owner_id column on leads
`leads.owner_id` is a nullable FK to `users.id` representing the counsellor currently
responsible for the lead. Assigning a lead to a counsellor sets `owner_id`.

This makes "own/assigned" scope concrete for counsellors: a counsellor's grant for
`leads.read` uses `own` scope, resolved as `WHERE owner_id = :currentUserId`. A
`BranchMgr` with `branch` scope sees all leads where `branch_id = :userBranchId`.
An `all`-scope admin sees all leads within the tenant.

The column is **fail-closed**: if a counsellor requests the list endpoint and no
`owner_id` filter resolves to any leads, they receive an empty list — never a full
tenant list. If `owner_id` is somehow null (bug) and the scope is `own`, zero rows
are returned (the `NULL != userId` predicate filters out unowned leads).

### IDOR → 404 on by-id
`LeadsService.findOne` applies the same scope filter to the by-id query. If the
requesting counsellor does not own the lead (or the lead doesn't exist), the response
is `404 Not Found` — identical in both cases. This prevents an attacker from probing
for the existence of leads they don't own by observing 403 vs 404.

The scope filter is applied on **both** the list endpoint and the by-id endpoint,
not just the list. This is the same pattern as ADR-0009's fail-closed posture.

### Stage moves and owner assignment
`PATCH /crm/leads/:id/stage` and `PATCH /crm/leads/:id/assign` are similarly scope-
gated. A counsellor cannot move a lead they don't own; a BranchMgr can reassign leads
within their branch.

## Consequences
- Counsellor scope on leads is now real (not deferred); the P1 follow-up in
  `docs/phase-1-followups.md` is resolved by this decision.
- A lead without an `owner_id` is visible only to `all`-scope roles (admins, managers)
  until it is assigned. This is the correct business rule: unassigned leads should not
  appear in a counsellor's pipeline.
- The by-id 404 posture is consistent with the IDOR→404 pattern used in P1 for
  students and enrollments (ADR-0009).
- Future "team lead" or "supervisor" scope (sees own team's leads) can be added by
  extending the scope filter without schema changes — `owner_id` remains the anchor.

## Alternatives considered
- **Separate `lead_assignments` join table**: supports multi-owner leads and full
  assignment history. Rejected for P2 — single counsellor ownership is the business
  rule now; a join table would add complexity without a use case.
- **Tag-based assignment (no FK, just a string)**: not referentially integrity-safe.
  Rejected.
- **Return 403 instead of 404 for IDOR**: leaks existence. Rejected — 404 is the
  correct posture per `docs/03-prd-crm.md §9` security requirements and standard
  IDOR mitigation guidance.
