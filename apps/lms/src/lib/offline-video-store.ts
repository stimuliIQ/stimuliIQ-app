// Offline lesson-video store — the OTT "download inside the app" model, with the
// stored bytes ENCRYPTED AT REST.
//
// WHY NOT A FILE DOWNLOAD:
//   Handing the student a file (or leaving the browser's native Download button on
//   the player) puts a redistributable MP4 in their Downloads folder. Instead the
//   bytes live in this origin's IndexedDB — app-managed storage that is not a file
//   they can attach to WhatsApp or re-upload.
//
// WHY ENCRYPTED (this is the part that matters):
//   Storing a raw Blob was still weak: open devtools → export the IndexedDB value →
//   you have a playable MP4. So every video is encrypted with AES-GCM under a
//   per-device key created with `extractable: false`.
//
//   A non-extractable CryptoKey can be persisted in IndexedDB (structured clone) but
//   its raw bytes can NEVER be read back by JavaScript — `crypto.subtle.exportKey`
//   throws, and there is no devtools path to the material either. So an exported
//   IndexedDB record is ciphertext with no recoverable key: useless to redistribute.
//
// LICENCE SEMANTICS (mirrors how OTT downloads behave):
//   · userId  — a download belongs to the student who saved it. Another account
//               signing in on the same device cannot see or play it.
//   · expiresAt — offline copies lapse (OFFLINE_LICENCE_DAYS) and are purged on
//               access, so a device that goes permanently offline can't hoard
//               content forever.
//   · purgeAllOffline() — called on sign-out, so a shared/lab device doesn't leave
//               a student's library behind.
//
// HONEST BOUNDARY (do not oversell):
//   This is strong friction, NOT DRM. At playback the video must be decrypted into
//   a blob the <video> element can read, so someone determined can still capture it
//   there or screen-record. Extraction-proof delivery needs real DRM
//   (Widevine/FairPlay via EME) from the video provider — Cloudflare Stream and Mux
//   both offer it, and this app's VideoProvider seam is ready for that swap.
//
// MEMORY NOTE: encryption/decryption run over the whole file in memory, which is
//   fine for lesson-length videos. OFFLINE_MAX_BYTES caps what we accept so a
//   multi-GB source can't OOM a low-end phone.

const DB_NAME = "stimuliiq-offline-video";
// v2: records are now { ciphertext, iv, userId, expiresAt } instead of a raw blob.
const DB_VERSION = 2;
const STORE = "lessons";
const KEY_STORE = "keys";
const MASTER_KEY_ID = "master";

/** How long an offline copy stays playable before it must be refreshed online. */
export const OFFLINE_LICENCE_DAYS = 30;

/** Largest video we will hold offline (memory ceiling for encrypt/decrypt). */
export const OFFLINE_MAX_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB

/** Stored shape — the bytes are ciphertext; there is no plaintext blob on disk. */
interface StoredLesson {
  lessonId: string;
  /** Owner. Downloads are not shared between accounts on one device. */
  userId: string;
  title: string;
  programTitle: string;
  ciphertext: ArrayBuffer;
  /** AES-GCM nonce — unique per record, stored alongside (safe, not secret). */
  iv: Uint8Array;
  sizeBytes: number;
  durationS: number | null;
  savedAt: string;
  expiresAt: string;
}

/** Listing shape — never carries bytes. */
export interface OfflineLessonMeta {
  lessonId: string;
  title: string;
  programTitle: string;
  sizeBytes: number;
  durationS: number | null;
  savedAt: string;
  expiresAt: string;
}

function toMeta(row: StoredLesson): OfflineLessonMeta {
  return {
    lessonId: row.lessonId,
    title: row.title,
    programTitle: row.programTitle,
    sizeBytes: row.sizeBytes,
    durationS: row.durationS,
    savedAt: row.savedAt,
    expiresAt: row.expiresAt,
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Offline storage is not available in this browser."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // v1 stored plaintext blobs. There is no safe migration (and no reason to
      // keep unencrypted copies around), so drop and recreate.
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE, { keyPath: "lessonId" });
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open offline storage."));
  });
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const req = run(transaction.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Offline storage operation failed."));
        transaction.oncomplete = () => db.close();
      }),
  );
}

/**
 * Returns this device's AES-GCM key, creating it on first use.
 *
 * `extractable: false` is the crux: the key object can be persisted and used to
 * encrypt/decrypt, but its raw bytes cannot be exported by any script — so an
 * attacker who dumps IndexedDB gets ciphertext they cannot decrypt elsewhere.
 */
async function getMasterKey(): Promise<CryptoKey> {
  const existing = await tx<{ id: string; key: CryptoKey } | undefined>(KEY_STORE, "readonly", (s) =>
    s.get(MASTER_KEY_ID),
  );
  if (existing?.key) return existing.key;

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await tx(KEY_STORE, "readwrite", (s) => s.put({ id: MASTER_KEY_ID, key }));
  return key;
}

function isExpired(row: { expiresAt: string }): boolean {
  return new Date(row.expiresAt).getTime() < Date.now();
}

/** True when this lesson is saved, unexpired, and owned by this student. */
export async function hasOfflineLesson(lessonId: string, userId: string): Promise<boolean> {
  try {
    const row = await tx<StoredLesson | undefined>(STORE, "readonly", (s) => s.get(lessonId));
    if (!row || row.userId !== userId) return false;
    if (isExpired(row)) {
      await removeOfflineLesson(lessonId);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists this student's saved lessons (metadata only). Expired entries are purged
 * as a side effect, so the list a student sees is always actually playable.
 */
export async function listOfflineLessons(userId: string): Promise<OfflineLessonMeta[]> {
  try {
    const all = await tx<StoredLesson[]>(STORE, "readonly", (s) => s.getAll());
    const mine = all.filter((r) => r.userId === userId);

    const expired = mine.filter(isExpired);
    await Promise.all(expired.map((r) => removeOfflineLesson(r.lessonId)));

    return mine
      .filter((r) => !isExpired(r))
      .map(toMeta)
      .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  } catch {
    return [];
  }
}

/**
 * Fetches a signed stream URL and stores the video ENCRYPTED for offline playback.
 * `onProgress` reports 0–1 for the download phase (null when the server sends no
 * Content-Length); encryption happens after the transfer completes.
 */
export async function saveLessonOffline(
  record: {
    lessonId: string;
    userId: string;
    title: string;
    programTitle: string;
    durationS: number | null;
  },
  signedUrl: string,
  onProgress?: (fraction: number | null) => void,
  signal?: AbortSignal,
): Promise<OfflineLessonMeta> {
  const res = await fetch(signedUrl, { signal });
  if (!res.ok) throw new Error(`Couldn't fetch the video (${res.status}).`);

  const total = Number(res.headers.get("Content-Length") ?? 0);
  if (total > OFFLINE_MAX_BYTES) {
    throw new Error("This video is too large to save for offline viewing.");
  }

  let bytes: ArrayBuffer;
  if (res.body && total > 0) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        if (received > OFFLINE_MAX_BYTES) {
          await reader.cancel();
          throw new Error("This video is too large to save for offline viewing.");
        }
        onProgress?.(Math.min(1, received / total));
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    bytes = merged.buffer;
  } else {
    onProgress?.(null);
    bytes = await res.arrayBuffer();
  }

  // Encrypt under the device's non-extractable key. A fresh IV per record — never
  // reuse a nonce with the same key under AES-GCM.
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + OFFLINE_LICENCE_DAYS * 24 * 60 * 60 * 1000);

  const row: StoredLesson = {
    ...record,
    ciphertext,
    iv,
    sizeBytes: bytes.byteLength,
    savedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  try {
    await tx(STORE, "readwrite", (s) => s.put(row));
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === "QuotaExceededError"
        ? "Not enough offline storage space. Remove a downloaded lesson and try again."
        : "Couldn't save this lesson for offline viewing.",
    );
  }

  return toMeta(row);
}

/**
 * Decrypts a saved lesson into an ephemeral object URL for playback.
 * Returns null when missing, expired, or owned by a different account.
 *
 * CALLER MUST `URL.revokeObjectURL(url)` when done — the object URL pins the
 * decrypted bytes in memory until revoked.
 */
export async function getOfflineLessonUrl(lessonId: string, userId: string): Promise<string | null> {
  const row = await tx<StoredLesson | undefined>(STORE, "readonly", (s) => s.get(lessonId));
  if (!row || row.userId !== userId) return null;
  if (isExpired(row)) {
    await removeOfflineLesson(lessonId);
    return null;
  }

  try {
    const key = await getMasterKey();
    // Copy into a fresh ArrayBuffer-backed view: the value read back from IndexedDB
    // is typed against ArrayBufferLike (possibly SharedArrayBuffer), which WebCrypto's
    // BufferSource does not accept.
    const iv = new Uint8Array(row.iv);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, row.ciphertext);
    return URL.createObjectURL(new Blob([plaintext], { type: "video/mp4" }));
  } catch {
    // Key rotated / storage tampered with → the copy is unusable. Drop it so the
    // student can simply re-download instead of hitting a silent dead end.
    await removeOfflineLesson(lessonId);
    return null;
  }
}

export async function removeOfflineLesson(lessonId: string): Promise<void> {
  await tx(STORE, "readwrite", (s) => s.delete(lessonId));
}

/**
 * Wipes every offline copy on this device. Called on sign-out so a shared or lab
 * machine never keeps one student's library available to the next person.
 */
export async function purgeAllOffline(): Promise<void> {
  try {
    await tx(STORE, "readwrite", (s) => s.clear());
  } catch {
    /* best-effort — sign-out must never fail because of storage */
  }
}

/** Best-effort origin storage usage, for the "X used" hint on the downloads page. */
export async function getOfflineUsage(): Promise<{ usedBytes: number; quotaBytes: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usedBytes: usage ?? 0, quotaBytes: quota ?? 0 };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Days remaining on an offline copy's licence (0 = expires today). */
export function daysUntilExpiry(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}
