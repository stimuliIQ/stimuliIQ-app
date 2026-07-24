// Unit tests for the local (dev) storage helpers: signature round-trip + expiry, and
// path-traversal safety.

import { resolve as resolvePath } from "node:path";

import {
  signStorageToken,
  verifyStorageToken,
  resolveObjectPath,
  contentTypeForKey,
  resolveLocalStorageDir,
} from "./local-storage.lib";

const SECRET = "a".repeat(32);
const KEY = "mentor_photos/tenant-1/uuid-photo.png";

describe("local-storage.lib", () => {
  describe("sign/verify token", () => {
    it("verifies a freshly signed, unexpired token", () => {
      const exp = Math.floor(Date.now() / 1000) + 300;
      const sig = signStorageToken(SECRET, "upload", KEY, exp);
      expect(verifyStorageToken(SECRET, "upload", KEY, exp, sig)).toBe(true);
    });

    it("rejects an expired token", () => {
      const exp = Math.floor(Date.now() / 1000) - 1;
      const sig = signStorageToken(SECRET, "upload", KEY, exp);
      expect(verifyStorageToken(SECRET, "upload", KEY, exp, sig)).toBe(false);
    });

    it("rejects a tampered key, op, or signature", () => {
      const exp = Math.floor(Date.now() / 1000) + 300;
      const sig = signStorageToken(SECRET, "upload", KEY, exp);
      expect(verifyStorageToken(SECRET, "upload", "mentor_photos/other/x.png", exp, sig)).toBe(false);
      expect(verifyStorageToken(SECRET, "download", KEY, exp, sig)).toBe(false); // op mismatch
      expect(verifyStorageToken(SECRET, "upload", KEY, exp, "deadbeef")).toBe(false);
      expect(verifyStorageToken("b".repeat(32), "upload", KEY, exp, sig)).toBe(false); // wrong secret
    });
  });

  describe("resolveObjectPath", () => {
    it("maps a key deterministically inside the base dir", () => {
      const p1 = resolveObjectPath("/tmp/store", KEY);
      const p2 = resolveObjectPath("/tmp/store", KEY);
      expect(p1).toBe(p2);
      expect(p1.includes("mentor_photos")).toBe(true);
    });

    it("rejects path traversal outside the storage root", () => {
      // `..` segments are stripped, so the escape attempt resolves back inside root.
      const p = resolveObjectPath("/tmp/store", "../../etc/passwd");
      expect(p.startsWith(resolvePath("/tmp/store"))).toBe(true);
      expect(p.includes("passwd")).toBe(true); // filename kept, traversal segments neutralised
    });
  });

  describe("contentTypeForKey", () => {
    it("maps image extensions", () => {
      expect(contentTypeForKey("a/b/x.png")).toBe("image/png");
      expect(contentTypeForKey("a/b/x.jpg")).toBe("image/jpeg");
      expect(contentTypeForKey("a/b/x.webp")).toBe("image/webp");
      expect(contentTypeForKey("a/b/x.bin")).toBe("application/octet-stream");
    });
  });

  describe("resolveLocalStorageDir", () => {
    it("uses the override when provided, else a cwd-relative default", () => {
      expect(resolveLocalStorageDir("/custom/dir")).toBe(resolvePath("/custom/dir"));
      expect(resolveLocalStorageDir(undefined)).toContain(".local-storage");
    });
  });
});
