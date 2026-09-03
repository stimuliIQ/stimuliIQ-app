# Certificate print assets (private — never served over HTTP)

Files the certificate PDF renderer reads from disk
(`src/modules/certificates/providers/pdf/`).

**This directory is deliberately not inside any app's `public/`.** The authorised
signature is the security-sensitive part of a certificate: a scan that is reachable by
URL can be lifted by anyone and pasted onto a forged document. Files here are read from
disk inside the API process at render time and embedded straight into the PDF bytes, so
the only way to obtain the signature is to already hold a genuine certificate.

## The certificate IS the approved artwork

The renderer has two modes and **artwork mode is the live one**. The approved export is
printed full-bleed as the page, and only the four values that differ per student are drawn
on top:

| Drawn per student | Everything else |
|---|---|
| holder name, body paragraph, certificate ID, issue date | frame, ornaments, ribbon, seal, wordmark, ISO/MSME lockups, signature block, the "Verify this certificate at" line |

Everything in the right-hand column is **pixel-exact**, because it is the approved file
rather than a drawing of it.

The other mode — `sync-certificate-pdf.adapter.ts` reproducing the certificate in code —
still exists as the fallback for a template whose `certificateKind` is the neutral
`course`, and for a server where the blanks below are missing. It is a careful copy, and a
copy is the problem: the typeface, the ornament geometry and the spacing are all drawn by
that file, so it can resemble the approved artwork but never equal it, and every visual
change means editing TypeScript.

## Files

| File | Purpose | Required |
|------|---------|----------|
| `training-certificate-blank.png` | The approved training artwork, values erased. Full-bleed page background. | for artwork mode |
| `internship-certificate-blank.png` | The same for the internship award. | for artwork mode |
| `Parisienne-Regular.ttf` | The script the holder's name is set in. | for artwork mode |
| `Outfit-Medium.ttf` / `Outfit-SemiBold.ttf` | The sans for the paragraph, the certificate ID and the date. | for artwork mode |
| `ceo-signature.png` | Authorised signature. **Code-drawn mode only** — the approved artwork carries its own. | no |
| `logo.png` | Issuer wordmark. Code-drawn mode only. | no |
| `iso-badge.png` / `msme-badge.png` | Accreditation marks. Code-drawn mode only. | no |

Every file is optional in the sense that nothing here throws: a missing asset degrades to
the typeset fallback rather than failing an issuance, because a certificate that has been
earned must still be issuable. That is also the trap — a missing font does not fail, it
prints the approved certificate with Helvetica across the middle of it. The spec
`artwork-certificate.spec.ts` asserts every file named above is on disk for exactly that
reason.

### The blanks are BUILT, not hand-edited

```bash
node scripts/build-certificate-artwork.cjs          # rebuild from the approved specimens
node scripts/build-certificate-artwork.cjs --check  # fail if the committed blanks are stale
```

The script reads `docs/sample certificate/*.png`, masks the ink of the four values, and
fills each masked pixel from the paper around it. Deriving the blanks rather than editing
them by hand is what keeps them honest: re-approve a design, re-run the script, and the
blanks follow. A hand-erased PNG committed once drifts from the specimen the first time
the specimen changes, silently, in a file nobody diffs.

Re-run it whenever `docs/sample certificate/` changes, and commit the result.

### Which fonts, and why those

Both were identified by MEASURING the specimen, not by eye — there are hundreds of
candidates and the wrong one is not obviously wrong:

- **Parisienne** for the name, from the proportion of the specimen's "Your Name"
  (363 × 85 px, aspect 4.271; Parisienne is 4.266). Size is a free parameter and a
  connected script cannot be tracked, so aspect is a fingerprint nothing downstream can
  fake. Great Vibes — the obvious guess — is 3.47, which renders a name half again too
  tall for its width.
- **Outfit** for everything else, from single-glyph widths as a fraction of cap height
  (O 1.000, F 0.677, C 0.903, M 1.032, E 0.645, measured off "OF COMPLETION"). A single
  glyph is the fingerprint because tracking moves a whole line but never one letter.
  Poppins is 3× the measurement error out on F and E, which at a matched cap height makes
  its words about 15% too wide.

Both are SIL Open Font Licence; `outfit-OFL.txt` and `parisienne-OFL.txt` ship beside them.

**Never a `.woff2`.** @react-pdf accepts a web font, reports no error, embeds it, names the
right face in the PDF's font table — and renders every line set in it as **blank space**.
`certificate-assets.ts` refuses the extension so that failure cannot happen invisibly.
Outfit publishes only a variable font upstream; the static instances here came from
`gwfh.mranftl.com` (google-webfonts-helper), which serves real TrueType instances.

### Checking a render against the approved design

```bash
node scripts/check-certificate-render.cjs --strict --out ./tmp
```

Renders both awards with the specimen's own placeholder values, rasterises page 1, and
reports how far each drawn value sits from the specimen's own ink. This is the only check
that catches the failures that do not throw — a name two points too large, a paragraph
wrapping into three lines where the design has four, a page stretched from 3:2 onto A4.
`--strict` fails over 4 px (of 1536).

To render a specimen without the comparison:

```bash
pnpm --filter @stimuliiq/api exec node -r ts-node/register -r tsconfig-paths/register \
  scripts/render-sample-certificate.ts --name "Your Name" --program "Domain" --out ./tmp
```

### Changing the design

Replace the two files in `docs/sample certificate/`, re-run
`scripts/build-certificate-artwork.cjs`, then re-run
`scripts/check-certificate-render.cjs` and adjust `DEFAULT_ARTWORK_FIELDS` in
`artwork-certificate.ts` until the offsets are small again. The erase regions in the build
script are measured in specimen pixels, so a design that moves its values needs those
updated too — they are commented with the ink boxes they were cut from.

No code change is needed for the artwork itself: the file names are defaulted per award in
`sync-certificate-pdf.adapter.ts`, and a template can still name its own via
`design.artworkFileName` / `design.artworkFonts` / `design.artworkFields`. Those names are
CRM-editable and therefore untrusted, so each is reduced to a basename inside this
directory before it can touch the filesystem — it cannot point anywhere else.

## Adding the signature

Only the code-drawn fallback stamps a signature; the approved artwork already carries the
signature block. Kept here because that fallback is still what a `course`-kind template
renders.

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

## Deployment

The directory ships with the repo, so committed assets deploy with a normal `git pull`
on the API host. A signature you would rather not commit can instead be copied onto the
server at `/srv/stimuliiq/apps/api/assets/certificate/ceo-signature.png` — the renderer
reads whatever is on disk at render time.
