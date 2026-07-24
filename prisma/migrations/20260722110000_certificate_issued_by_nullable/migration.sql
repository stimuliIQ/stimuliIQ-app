-- Automatic certificate issuance (LmsProgressService.markComplete ->
-- CertificatesService.autoIssueOnCompletion): a certificate can now be issued by the
-- system (no staff actor) when a student reaches 100% progress. `issued_by` null means
-- "System (automatic)" — see certificates.repository.ts formatUserName/toCertificateRow.
ALTER TABLE "certificates" ALTER COLUMN "issued_by" DROP NOT NULL;
