// apps/api/src/modules/certificates/providers/pdf/certificate-assets.ts
//
// Private, server-side asset loader for the certificate renderer (logo, authorised
// signature, accreditation badges).
//
// WHY THIS EXISTS — the signature is the security-sensitive part of a certificate.
// A scanned CEO signature that is reachable over HTTP can be lifted by anyone and
// pasted onto a forged document, so it is deliberately NOT placed in any app's
// `public/` directory and never gets a URL. It lives in `apps/api/assets/certificate/`,
// is read from disk inside the API process at render time, and is embedded straight
// into the PDF bytes as a data URI. The only way to obtain it is to already hold a
// genuine certificate PDF.
//
// PATH-TRAVERSAL GUARD (load-bearing): `CertificateDesign` comes from the
// `certificate_templates.design` JSON column, which is CRM-editable. A file name
// arriving from there is therefore UNTRUSTED input. `safeAssetName()` reduces any
// candidate to its basename, rejects anything outside a strict charset, and requires a
// known image extension — so `../../.env` or an absolute path can never reach `readFile`.
// A caller that wants a different signature drops a differently-named PNG in the same
// directory; it cannot point the renderer anywhere else on the filesystem.
//
// MISSING FILES ARE NORMAL. Every asset here is optional: a fresh checkout has no
// signature image, and issuance must not break because of it. Each loader returns
// `undefined` when the file is absent and the renderer degrades to the typeset
// fallback (ruled line + printed signatory name).
//
// CACHING: assets are read once per process and memoised. They change only on deploy,
// and a certificate render should not hit the disk for a logo it has already loaded.

import { readFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";

/**
 * The private asset directory: `<apps/api>/assets/certificate`.
 *
 * Resolved from `__dirname` rather than `process.cwd()` so it is correct under both
 * run modes — `src/modules/certificates/providers/pdf` (ts-node dev) and
 * `dist/modules/certificates/providers/pdf` (compiled prod) are both exactly five
 * levels below `apps/api`, and neither depends on which directory the process was
 * started from.
 */
const ASSET_DIR = join(__dirname, "..", "..", "..", "..", "..", "assets", "certificate");

/** Image extensions the renderer can embed. @react-pdf/renderer supports PNG and JPEG. */
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

/** Conservative charset for an asset file name — letters, digits, dot, dash, underscore. */
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/**
 * Reduce an untrusted candidate to a safe file name inside ASSET_DIR, or `undefined`
 * if it cannot be made safe. `basename()` strips any directory component (including
 * `..` segments and Windows drive prefixes) BEFORE the charset check, so traversal
 * attempts collapse to a harmless name rather than escaping the directory.
 */
export function safeAssetName(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const name = basename(candidate.trim());
  if (!name || !SAFE_NAME.test(name)) return undefined;
  if (!ALLOWED_EXTENSIONS.has(extname(name).toLowerCase())) return undefined;
  return name;
}

/** name → data URI (or `undefined` when the file is absent/unsafe). Memoised per process. */
const cache = new Map<string, string | undefined>();

/**
 * Load a private certificate asset as a `data:` URI ready for `<Image src>`.
 *
 * Returns `undefined` — never throws — when the name is unsafe or the file does not
 * exist, because a missing decorative asset must not fail an earned certificate.
 */
export async function loadCertificateAsset(candidate: string | undefined): Promise<string | undefined> {
  const name = safeAssetName(candidate);
  if (!name) return undefined;
  if (cache.has(name)) return cache.get(name);

  let dataUri: string | undefined;
  try {
    const bytes = await readFile(join(ASSET_DIR, name));
    const mime = MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? "image/png";
    dataUri = `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    // ENOENT (asset not supplied yet) and permission errors alike: degrade quietly.
    dataUri = undefined;
  }

  cache.set(name, dataUri);
  return dataUri;
}

/** Test seam — clears the per-process memo so a spec can vary the on-disk assets. */
export function __clearCertificateAssetCache(): void {
  cache.clear();
  fontPathCache.clear();
}

/** Font files the renderer may register. Kept separate from image extensions. */
const ALLOWED_FONT_EXTENSIONS = new Set([".ttf", ".otf"]);
const fontPathCache = new Map<string, string | undefined>();

/**
 * Resolve a private font file to an absolute path for `Font.register`.
 *
 * Fonts are handed to @react-pdf/renderer as a PATH, not a data URI, which is why this
 * cannot reuse `loadCertificateAsset`. Same untrusted-input posture though: the name comes
 * from the CRM-editable `design` JSON, so it goes through the same basename + charset
 * reduction before it can touch the filesystem.
 *
 * Returns `undefined` — never throws — when the name is unsafe or the file is absent. A
 * missing font must degrade to the built-in face, never fail an earned certificate.
 */
export async function resolveCertificateFontPath(candidate: string | undefined): Promise<string | undefined> {
  if (!candidate) return undefined;
  const name = basename(candidate.trim());
  if (!name || !SAFE_NAME.test(name)) return undefined;
  if (!ALLOWED_FONT_EXTENSIONS.has(extname(name).toLowerCase())) return undefined;
  if (fontPathCache.has(name)) return fontPathCache.get(name);

  const path = join(ASSET_DIR, name);
  let resolved: string | undefined;
  try {
    await readFile(path);
    resolved = path;
  } catch {
    resolved = undefined;
  }
  fontPathCache.set(name, resolved);
  return resolved;
}

/** Default file names. Drop a file with one of these names into `apps/api/assets/certificate/`. */
export const DEFAULT_ASSETS = {
  /** Authorised signature (transparent PNG reads best over the ruled line). */
  signature: "ceo-signature.png",
  /** Issuer wordmark printed at the head of the certificate. */
  logo: "logo.png",
  /** Optional accreditation marks shown beside the certificate ID. */
  isoBadge: "iso-badge.png",
  msmeBadge: "msme-badge.png",
} as const;
