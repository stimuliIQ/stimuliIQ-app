# ADR 0027: StorageProvider interface, Noop, fail-closed, and `useFactory` binding

## Status
Accepted

## Context
Phase 4 introduces three new surfaces that require object-storage access: submission file
uploads (student → S3/R2), certificate PDFs (backend → S3/R2), and the opportunistic
wiring of the P2 invoice-gen and P3 resource-download stubs that were left with
`storageKey: null` / "Coming Soon" pending a storage provider. A single cohesive
`StorageProvider` interface was the right abstraction — exactly the VideoProvider /
PaymentProvider pattern from ADRs 0006, 0013, and 0023.

Storage differs from the video provider in one important way: it must handle **signed
uploads** (presigned PUT URLs for direct-to-storage browser uploads) in addition to
signed downloads. Upload is a fresh attack surface — the scoping, content-type
enforcement, and size caps on upload URLs must be enforced server-side, not relied on
from the client.

The `VIDEO_PROVIDER` → `useFactory` lesson (ADR-0023) was applied immediately: the
`NoopStorageProvider`'s constructor takes an optional options object, which would cause
NestJS's `useClass` DI to attempt to inject `Object` and crash `AppModule` at boot (the
DEFECT-1 pattern). `useFactory` bypasses that inspection entirely.

Key scoping is security-critical. Without server-side enforcement a malicious student
could request an upload URL for `certificates/{tenant}/…` and overwrite or fabricate
PDF files. The server must sanitise every key it mints and reject any key not prefixed
by the appropriate namespace for the calling context.

## Decision

**Interface: `StorageProvider`** (`STORAGE_PROVIDER` DI token)

```typescript
interface StorageProvider {
  getSignedUploadUrl(params: {
    key: string;            // server-scoped; validated before call
    contentType: string;
    maxBytes: number;
    ttlSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }>;

  getSignedDownloadUrl(params: {
    key: string;
    ttlSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }>;

  delete(params: { key: string }): Promise<void>;
  head(params: { key: string }): Promise<{ size: number; contentType: string } | null>;
}
```

**Key namespaces** (enforced at the service layer before calling the provider):
- `submissions/{tenantId}/{enrollmentId}/…` — submission file uploads
- `certificates/{tenantId}/…` — certificate PDFs
- `invoices/{tenantId}/…` — invoice PDFs (opportunistic wire)
- `resources/{tenantId}/…` — lesson resource downloads (opportunistic wire)

The submission upload path (task #6) validates that every `files[]` key supplied by the
client on `POST /assignments/:id/submit` is prefixed `submissions/{tenant}/{enrollment}/`.
Any key that fails this prefix check is rejected 422 before the submission row is
created. This closes the H-1 storage-key IDOR that was found and fixed by the Wave 7
security review.

**Adapters:**

1. **`S3StorageProvider`** — wraps AWS SDK v3 (`@aws-sdk/client-s3` +
   `@aws-sdk/s3-request-presigner`). Used for both `STORAGE_PROVIDER=s3` (AWS) and
   `STORAGE_PROVIDER=r2` (Cloudflare R2, which is S3-compatible; set
   `STORAGE_ENDPOINT` to `https://<accountId>.r2.cloudflarestorage.com`). Raw bucket
   URLs are never returned — every response is a presigned URL.
2. **`NoopStorageProvider`** — returns deterministic fake presigned URLs for local
   dev and CI (`https://noop.storage.local/…?X-Amz-Signature=noop`). No real network
   call. Injected by default when `STORAGE_PROVIDER` is not set or is set to `noop`.

**Fail-closed:** When `STORAGE_PROVIDER` is `s3` or `r2` but the corresponding
credential vars (`STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY`) are absent,
`S3StorageProvider` logs a startup warning and throws a 503 at call time. The API
never falls back to returning a raw bucket URL or a Noop URL for a real-provider
configuration.

**`useFactory` binding** (same as ADR-0023):

```typescript
{
  provide: STORAGE_PROVIDER,
  useFactory: (env: Env) => {
    if (env.STORAGE_PROVIDER === 's3' || env.STORAGE_PROVIDER === 'r2') {
      return new S3StorageProvider({
        bucket:          env.STORAGE_BUCKET,
        region:          env.STORAGE_REGION,
        endpoint:        env.STORAGE_ENDPOINT,
        accessKeyId:     env.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      });
    }
    return new NoopStorageProvider();
  },
  inject: [ENV],
}
```

**Env vars** (all optional; provider is Noop until set):
- `STORAGE_PROVIDER` — `noop` | `s3` | `r2` (default `noop`)
- `STORAGE_BUCKET` — bucket name (never returned to clients)
- `STORAGE_REGION` — AWS region or `auto` for R2
- `STORAGE_ENDPOINT` — leave empty for AWS S3; set for R2 or S3-compatible
- `STORAGE_ACCESS_KEY_ID` — IAM / R2 access key
- `STORAGE_SECRET_ACCESS_KEY` — IAM / R2 secret key

## Consequences
- Submission file uploads, certificate PDFs, invoice PDFs, and resource downloads all
  flow through a single interface; swapping providers requires only a DI binding change.
- The `NoopStorageProvider` keeps all P4 paths (submit/grade/certificate/download)
  fully exercisable in local dev and CI without real cloud credentials.
- `useFactory` avoids the DEFECT-1 crash pattern (ADR-0023) for any adapter whose
  constructor takes optional objects.
- The H-1 security finding (storage-key IDOR) is fixed at the service layer — the
  provider interface itself is key-agnostic; the scoped-key enforcement is the
  calling service's responsibility and is tested in the integration suite.
- Raw bucket URLs are structurally impossible to return — the interface returns only
  `{ url, expiresAt }` pairs, and the real adapter always calls `getSignedUrl`.

## Alternatives considered
- **Per-feature storage helpers** (separate S3 clients per module): rejected — a
  single interface centralises the security invariants (no raw URL, key scoping) and
  makes the provider swappable without touching feature modules.
- **Returning the storage key to the client** and generating a signed URL client-side:
  rejected — the signing secret would need to be exposed to the client, eliminating
  the access-control benefit.
- **Long-lived public URLs** (public-read ACL): rejected — certificate PDFs contain PII
  (holder name) and must be access-controlled; submission files contain student work and
  must not be publicly readable.
