"use client";

/**
 * VerifyEntryForm — the certificate-ID input on `/verify` (go-live blocker B10a).
 *
 * On submit it normalizes the entered ID and navigates to `/verify/<id>`, where the
 * server component calls the public verify endpoint and renders the result. No
 * validity logic here — the API is the source of truth (CLAUDE.md §3: no business
 * logic in components).
 *
 * A11y: labelled input, inline validation message with aria-live, visible focus
 * (inherited from @repo/ui tokens), submit disabled while empty.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { normalizeCertificateSerial } from "@repo/types";
import { Button, Input } from "@repo/ui";

export function VerifyEntryForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Drop any accidental full-URL paste, then normalise: a typed serial is folded to
    // upper-case (STMQ-…) so casing/spacing typos still resolve; a long base64url cert_uid
    // is left byte-for-byte (it is case-sensitive) — normalizeCertificateSerial only
    // touches serial-shaped input.
    const withoutUrl = value.trim().replace(/^.*\/verify\//i, "");
    const raw = normalizeCertificateSerial(withoutUrl);
    if (raw.length === 0) {
      setError("Enter the certificate ID printed on the certificate.");
      return;
    }
    setError(null);
    router.push(`/verify/${encodeURIComponent(raw)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <label htmlFor="cert-id" className="text-sm font-medium">
          Certificate ID
        </label>
        <Input
          id="cert-id"
          name="certId"
          inputMode="text"
          autoComplete="off"
          placeholder="e.g. STMQ-2026-XXXX-XXXX"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "cert-id-error" : undefined}
        />
        {error ? (
          <p id="cert-id-error" role="alert" aria-live="polite" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" className="w-full" disabled={value.trim().length === 0}>
        Verify certificate
      </Button>
    </form>
  );
}
