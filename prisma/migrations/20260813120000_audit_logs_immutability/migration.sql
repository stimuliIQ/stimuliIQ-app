-- Hardens `audit_logs` against direct DB-level tampering (owner report: "super admin can
-- edit/delete audit logs directly from the DB"). Adds a nullable `redacted_at` marker for
-- the one sanctioned edit, then a trigger that makes the table append-only at the Postgres
-- level — enforced regardless of caller (Prisma extended client, Prisma base client, a
-- Supabase dashboard SQL editor session, psql, anything). This is a defence-in-depth layer
-- underneath apps/api/src/prisma/audit.extension.ts's `guardAuditLogMutation`, which blocks
-- the same operations at the Prisma-client layer but only for callers going through Prisma.

-- Visible marker for the one sanctioned edit (DPDP erasure redaction of before/after,
-- ADR-0049, dpdp.repository.ts `redactAuditRow`). Null means "never redacted".
ALTER TABLE "audit_logs" ADD COLUMN "redacted_at" TIMESTAMP(3);

-- BEFORE trigger function: rejects every DELETE outright (except under the disposable-
-- test-teardown escape hatch below), and rejects any UPDATE that changes a column other
-- than before/after/redacted_at.
CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Escape hatch for disposable local integration-test teardown ONLY. Session-scoped
    -- (SET LOCAL, inside the same transaction as the delete) so it never leaks across
    -- connections or into any other session, and there is no way to set it from SQL run
    -- through the ordinary application connection string without deliberately opting in.
    -- See apps/api/test/fixtures/purge-audit-logs.ts.
    IF current_setting('app.allow_audit_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'audit_logs is append-only: DELETE is not permitted (id=%)', OLD.id
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
      OR NEW.entity IS DISTINCT FROM OLD.entity
      OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
      OR NEW.action IS DISTINCT FROM OLD.action
      OR NEW.ip IS DISTINCT FROM OLD.ip
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'audit_logs rows are immutable except before/after/redacted_at (id=%)', OLD.id
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_guard_trigger ON "audit_logs";

CREATE TRIGGER audit_logs_guard_trigger
  BEFORE DELETE OR UPDATE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_guard();
