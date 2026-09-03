# Approved certificate artwork (the source of truth)

The two PNGs here are the **approved design specimens**, and they are not reference
material any more — they are the input the issued certificate is built from. They carry
placeholder values on purpose ("Your Name", "DOMAIN", `STIQ-2026-000001`), so nothing in
this folder is, or resembles, a real award.

## These files ARE the certificate

`scripts/build-certificate-artwork.cjs` derives a blank of each — the same image with the
four per-student values erased — into the API's private asset directory, and the renderer
prints that blank full-bleed as the page and draws only those four values onto it. So
every static mark on an issued certificate is these pixels, not a drawing of them.

**Change the design by replacing these two files**, then:

```bash
node scripts/build-certificate-artwork.cjs      # rebuild the blanks the renderer prints
node scripts/build-certificate-artwork.cjs --check   # …or just check they are current
node scripts/check-certificate-render.cjs --strict   # confirm the drawn values still land
node scripts/build-sample-certificates.cjs      # refresh the watermarked public specimens
```

A design that moves its values also needs the erase regions in the build script and the
placements in `artwork-certificate.ts` updated; both are commented with the ink boxes they
were measured from. See `apps/api/assets/certificate/README.md`.

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

`apps/web/public/images/` carries WebP copies of these two specimens with a small
**SAMPLE** watermark tiled across the whole document and burned into the pixels. They are
shown on `/verify`, `/about` and on every `/programs/[slug]` page. Regenerate them with:

```bash
node scripts/build-sample-certificates.cjs
```

Never publish an un-watermarked specimen: the public copy is the one an impostor would
reach for.
