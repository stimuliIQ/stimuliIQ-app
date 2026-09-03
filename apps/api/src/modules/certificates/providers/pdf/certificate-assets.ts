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
  artworkCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Artwork mode — the asset the page IS, so its proportions matter
// ─────────────────────────────────────────────────────────────────────────────

/** An approved artwork plus the pixel size that fixes the page's proportions. */
export interface CertificateArtwork {
  src: string;
  widthPx: number;
  heightPx: number;
}

const artworkCache = new Map<string, CertificateArtwork | undefined>();

/**
 * Read the intrinsic pixel size out of the image header.
 *
 * Needed because the artwork IS the page in artwork mode: printing a 3:2 design onto A4
 * landscape (1.414:1) stretches it about 6% vertically, which is small enough to pass a
 * glance and large enough to be wrong — the seal turns into an ellipse and every letter
 * of the approved wordmark gets taller. The caller sizes the page from these numbers
 * instead, so the design is reproduced at its own proportions whatever they are.
 *
 * PNG: the IHDR is at a fixed offset. JPEG: walk the segment chain to the frame header —
 * worth the dozen lines, because the silent failure otherwise is a distorted certificate
 * whenever somebody exports a .jpg.
 */
function imageDimensions(bytes: Buffer): { widthPx: number; heightPx: number } | undefined {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return undefined; // Not a segment boundary — give up.
      const marker = bytes[offset + 1] ?? 0;
      // SOF0-SOF15, excluding the four that are not frame headers (DHT/JPG/DAC/RST).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { heightPx: bytes.readUInt16BE(offset + 5), widthPx: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
  }
  return undefined;
}

/**
 * Load the approved artwork as a data URI plus its intrinsic size.
 *
 * Separate from `loadCertificateAsset` because only this one caller needs the dimensions,
 * and they must not be paid for on every logo/badge read. Same untrusted-input posture and
 * the same degrade-quietly contract: an absent or unreadable file returns `undefined` and
 * the adapter falls back to the code-drawn certificate rather than failing an issuance.
 */
export async function loadCertificateArtwork(
  candidate: string | undefined,
): Promise<CertificateArtwork | undefined> {
  const name = safeAssetName(candidate);
  if (!name) return undefined;
  if (artworkCache.has(name)) return artworkCache.get(name);

  let artwork: CertificateArtwork | undefined;
  try {
    const bytes = await readFile(join(ASSET_DIR, name));
    const size = imageDimensions(bytes);
    if (size) {
      const mime = MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? "image/png";
      artwork = { src: `data:${mime};base64,${bytes.toString("base64")}`, ...size };
    }
  } catch {
    artwork = undefined;
  }

  artworkCache.set(name, artwork);
  return artwork;
}

/**
 * Font files the renderer may register. Kept separate from image extensions.
 *
 * DELIBERATELY NOT `.woff2`, and it took a wrong turn to learn why. @react-pdf accepts a
 * web font, reports no error, and embeds it — the PDF even names the right face in its font
 * table — but the glyphs come out with no outlines, so every line set in it renders as
 * BLANK SPACE. Nothing upstream catches that: the render succeeds, the bytes are a valid
 * PDF, and the certificate is simply missing its paragraph. Refusing the extension turns
 * that into the visible degrade this file promises everywhere else (fall back to the
 * built-in face) instead of an invisible one.
 */
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
