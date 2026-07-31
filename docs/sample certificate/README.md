# Approved certificate artwork (reference only)

The two PNGs here are the **approved design specimens** the PDF renderer reproduces
(`apps/api/src/modules/certificates/providers/pdf/sync-certificate-pdf.adapter.ts`).
They carry placeholder values on purpose — "Your Name", "DOMAIN", `STIQ-2026-000001` —
so nothing in this folder is, or resembles, a real award.

| File | `design.certificateKind` | Ribbon label |
|------|--------------------------|--------------|
| `internship-certificate.png` | `internship` | INTERNSHIP CERTIFICATE |
| `training-certificate.png` | `training` | TRAINING CERTIFICATE |

Both certificates are issued to students — a programme awards the internship
certificate, the training certificate, or both. The kind is chosen by picking the
matching `CertificateTemplate` at issuance; see the seeded templates in `prisma/seed.ts`.

## The signature does NOT live here

The authorised signature scan is deliberately **not** in this folder, and must never be
put back. A signature image that sits in a browsable directory — or worse, gets copied
into an app's `public/` — can be lifted and pasted onto a forged document. It lives in
the API's private asset directory instead:

```
apps/api/assets/certificate/ceo-signature.png
```

It is read from disk inside the API process at render time and embedded straight into
the PDF bytes, so it never gets a URL. See `apps/api/assets/certificate/README.md`.

`.gitignore` blocks `*signature*` under this folder to stop it drifting back in.

## The public specimen on the marketing site

`apps/web/public/images/` carries WebP copies of these two specimens with a large
**SAMPLE** watermark burned in, shown on `/verify` and `/about`. Regenerate them with:

```bash
node scripts/build-sample-certificates.js
```

Never publish an un-watermarked specimen: the public copy is the one an impostor would
reach for.
