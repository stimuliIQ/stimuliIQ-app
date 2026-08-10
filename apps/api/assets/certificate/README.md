# Certificate print assets (private — never served over HTTP)

Images the certificate PDF renderer embeds
(`src/modules/certificates/providers/pdf/sync-certificate-pdf.adapter.ts`).

**This directory is deliberately not inside any app's `public/`.** The authorised
signature is the security-sensitive part of a certificate: a scan that is reachable by
URL can be lifted by anyone and pasted onto a forged document. Files here are read from
disk inside the API process at render time and embedded straight into the PDF bytes, so
the only way to obtain the signature is to already hold a genuine certificate.

## Files

| File | Drawn at | Purpose | Required |
|------|----------|---------|----------|
| `logo.png` | 34 pt tall | Issuer wordmark printed at the head of the certificate | no — falls back to typeset `orgName` |
| `ceo-signature.png` | 40 pt tall | Authorised signature, drawn over the ruled signature line | no — falls back to the ruled line + printed name |
| `iso-badge.png` | 42 × 42 pt | ISO 9001 accreditation mark beside the Certificate ID | no — omitted when absent |
| `msme-badge.png` | 34 × 86 pt | MSME / Ministry of MSME lockup | no — omitted when absent |

Every asset is optional. A missing file never fails issuance: the layout degrades to the
typeset fallback, because a certificate that has been earned must still be issuable.

## Artwork mode — how to get the approved design EXACTLY

The four files above decorate a certificate this repo **draws in code**. A drawing is a
copy: the typeface, the ornament geometry and the spacing are all produced by
`sync-certificate-pdf.adapter.ts`, so it can resemble the approved artwork but never equal
it, and every visual change means editing TypeScript.

Artwork mode replaces that. Drop the approved export in here, name it on the template, and
the PDF **is** that file with the student's values printed onto it.

| File | Used by | Notes |
|------|---------|-------|
| `training-certificate-blank.png` | the training template | full-bleed page background |
| `internship-certificate-blank.png` | the internship template | full-bleed page background |

Then set on the template's `design` JSON:

```json
{ "certificateKind": "training", "artworkFileName": "training-certificate-blank.png" }
```

### The artwork must be BLANK where values go

Leave out the holder name, the body paragraph, the certificate id value and the issue
date — those five are printed on top. Everything else (frame, corner ornaments, ribbon,
seal, wordmark, ISO/MSME marks, signature block, the "Verify this certificate at" line)
**stays in the image** and is therefore pixel-exact.

The body paragraph is printed rather than baked because the programme name and the date sit
mid-sentence: a baked sentence with a gap in it cannot fit both "AI" and "Clinical Neurology
Fellowship" without one of them looking wrong.

Export at **A4 landscape** (3508 × 2480 px at 300 dpi) so the image fills the page with no
distortion. The signature must NOT be baked in — it is stamped at render time from
`ceo-signature.png` above, which is the whole reason that file is private.

### Matching the typefaces

Positions come from `DEFAULT_ARTWORK_FIELDS` (measured from the approved specimens) and can
be overridden per template via `design.artworkFields`. To match the artwork's fonts rather
than falling back to Helvetica, drop the `.ttf`/`.otf` files here too and name them:

```json
{ "artworkFonts": { "script": "GreatVibes-Regular.ttf", "body": "Montserrat-Regular.ttf", "bodyBold": "Montserrat-Bold.ttf" } }
```

A missing or unreadable font degrades to the built-in face — it never fails an issuance.

All four are **transparent PNGs**. The certificate page is pure white while the approved
artwork is printed on a faintly warm paper, so any mark carried over from the artwork has
its background knocked out rather than kept — an opaque off-white rectangle sitting on a
white page is visible, and it is visible in exactly the place a reader is looking for a
seal.

The ISO and MSME marks are lifted from `docs/sample certificate/training-certificate.png`
(the approved artwork), which is why they carry the same crop and weight as the specimen.

## Adding the signature

1. Export the signature as a **PNG with a transparent background** — it is drawn directly
   over the ruled line, so a white box would blank the rule out.
2. Crop tight to the ink (no large empty margin), roughly **3:1 landscape**. The renderer
   scales it to 40 pt tall and preserves the aspect ratio, so a tight crop keeps the
   signature reading at its natural size; a loose crop makes the ink look small.
   Around **1100 × 330 px** is comfortable — enough for 300 dpi print, still a small file.
3. Save it here as `ceo-signature.png`.
4. Restart the API (assets are memoised per process, so a running API keeps serving the
   previously loaded set).

**Never** stage a signature anywhere else in the repo on the way here — not in `docs/`,
not in an app's `public/`. `.gitignore` blocks `docs/**/*signature*` for that reason.

## Seeing what you changed

Assets and layout have no cheap feedback loop through the API, so render a specimen
directly:

```bash
pnpm --filter @stimuliiq/api exec node -r ts-node/register -r tsconfig-paths/register \
  scripts/render-sample-certificate.ts --name "Your Name" --program "Domain" --out ./tmp
```

That writes one PDF per award (internship + training) without touching the database.

No code change is needed. To use a different file name, set `signatureFileName` on the
template's `design` JSON — the name is sanitised to a basename inside this directory,
so it cannot point anywhere else on the filesystem.

## Deployment

The directory ships with the repo, so committed assets deploy with a normal `git pull`
on the API host. A signature you would rather not commit can instead be copied onto the
server at `/srv/stimuliiq/apps/api/assets/certificate/ceo-signature.png` — the renderer
reads whatever is on disk at render time.
