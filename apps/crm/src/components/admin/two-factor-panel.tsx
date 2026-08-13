// Two-factor authentication (TOTP) enrol/verify/disable panel — Phase 9
// Completion T28/T40, promoted to the real SDK in Phase 9 (gap #8 follow-up).
//
// Uses `client.auth.twoFactor.*` (packages/api-client/src/auth/two-factor.api.ts)
// — the local stopgap client (lib/two-factor-api.ts) has been deleted.
//
// QR CODE: renders a real scannable QR from the enrolment `otpauthUrl` via the
// `qrcode` package (data-URL, generated client-side — the secret never leaves
// the browser beyond the API call that minted it). The raw secret is still
// shown as copyable text as a fallback for apps that can't scan.
import * as React from "react";
import QRCode from "qrcode";
import { Alert, Button, Input, useToast } from "@repo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TotpEnrollResponse, TotpVerifyEnrollResponse } from "@repo/types";

import { apiClient } from "../../lib/api-client";
import { surfaceError, errorCode } from "../../lib/surface-error";

const TWO_FACTOR_STATUS_KEY = ["two-factor", "status"] as const;

function CopyField({ label, value, testId }: { label: string; value: string; testId: string }): React.JSX.Element {
  const { toast } = useToast();
  return (
    <div className="flex items-end gap-2">
      <Input label={label} value={value} readOnly wrapperClassName="flex-1" data-testid={testId} />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          toast({ title: "Copied", variant: "success" });
        }}
      >
        Copy
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EnrollmentQrCode — renders `otpauthUrl` as a scannable QR code (data URL,
// generated client-side via the `qrcode` package). Shows a loading/error
// fallback so the secret + otpauth URL text fields remain usable even if QR
// generation fails for some reason.
// ---------------------------------------------------------------------------

function EnrollmentQrCode({ otpauthUrl }: { otpauthUrl: string }): React.JSX.Element {
  const [dataUrl, setDataUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);
    QRCode.toDataURL(otpauthUrl, { width: 200, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);

  if (failed) {
    return (
      <p className="text-sm text-fg-muted" data-testid="two-factor-qr-error">
        Couldn&apos;t generate a QR code — use the otpauth URL or secret below for manual entry.
      </p>
    );
  }

  if (!dataUrl) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Generating QR code"
        className="size-[200px] animate-pulse rounded-md bg-surface"
        data-testid="two-factor-qr-loading"
      />
    );
  }

  return (
    <img
      src={dataUrl}
      alt="Scan this QR code with your authenticator app to enrol in two-factor authentication"
      width={200}
      height={200}
      className="rounded-md border border-border"
      data-testid="two-factor-qr-code"
    />
  );
}

export function TwoFactorPanel(): React.JSX.Element {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: TWO_FACTOR_STATUS_KEY,
    queryFn: () => apiClient.auth.twoFactor.status(),
  });

  const [enrollment, setEnrollment] = React.useState<TotpEnrollResponse | null>(null);
  const [backupCodes, setBackupCodes] = React.useState<string[] | null>(null);
  const [verifyCode, setVerifyCode] = React.useState("");
  const [disableCode, setDisableCode] = React.useState("");

  const enroll = useMutation({ mutationFn: () => apiClient.auth.twoFactor.enroll() });
  const verifyEnroll = useMutation({
    mutationFn: (code: string) => apiClient.auth.twoFactor.verifyEnroll({ code }),
    onSuccess: (result: TotpVerifyEnrollResponse) => {
      setBackupCodes(result.backupCodes);
      setEnrollment(null);
      setVerifyCode("");
      void queryClient.invalidateQueries({ queryKey: TWO_FACTOR_STATUS_KEY });
    },
  });
  const disable = useMutation({
    mutationFn: (code: string) => apiClient.auth.twoFactor.disable({ code }),
    onSuccess: () => {
      setDisableCode("");
      void queryClient.invalidateQueries({ queryKey: TWO_FACTOR_STATUS_KEY });
    },
  });

  async function handleEnroll() {
    try {
      const result = await enroll.mutateAsync();
      setEnrollment(result);
    } catch (error) {
      surfaceError(toast, error, "Couldn't start 2FA enrolment");
    }
  }

  async function handleVerify() {
    try {
      await verifyEnroll.mutateAsync(verifyCode);
      toast({ title: "Two-factor authentication enabled", variant: "success" });
    } catch (error) {
      // "That code didn't verify" is only true for a genuine wrong/expired TOTP code
      // (TOTP_CODE_INVALID, 401). Everything else — TOTP_ENROLLMENT_EXPIRED, a network
      // failure, or a server error (e.g. the API's TWO_FACTOR_ENC_KEY misconfigured) —
      // is NOT the user's fault and must not be blamed on their authenticator app.
      if (errorCode(error) === "TOTP_CODE_INVALID") {
        surfaceError(toast, error, "That code didn't verify — check your authenticator app and try again");
      } else {
        surfaceError(toast, error, "Couldn't verify your code");
      }
    }
  }

  async function handleDisable() {
    try {
      await disable.mutateAsync(disableCode);
      toast({ title: "Two-factor authentication disabled", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't disable 2FA");
    }
  }

  if (status.isLoading) {
    return <p className="text-sm text-fg-muted">Checking your two-factor status…</p>;
  }
  if (status.isError) {
    return <p role="alert" className="text-sm text-danger">Couldn't load your two-factor status.</p>;
  }

  if (backupCodes) {
    return (
      <Alert tone="warning" title="Save your backup codes" data-testid="two-factor-backup-codes">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted">
            These are shown once. Store them somewhere safe — each can be used instead of a TOTP code if you lose your device.
          </p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm text-fg">
            {backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <Button size="sm" onClick={() => setBackupCodes(null)} className="self-start">
            Done
          </Button>
        </div>
      </Alert>
    );
  }

  if (status.data?.enabled) {
    return (
      <div className="flex flex-col gap-3" data-testid="two-factor-enabled">
        <p className="text-sm text-fg">
          Two-factor authentication is <strong>enabled</strong> on your account
          {status.data.remainingBackupCodes !== null ? ` (${status.data.remainingBackupCodes} backup codes remaining)` : ""}.
        </p>
        <div className="flex items-end gap-2">
          <Input
            label="Current TOTP or backup code, to disable"
            placeholder="123456"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            wrapperClassName="w-56"
            data-testid="two-factor-disable-code-input"
          />
          <Button variant="destructive" onClick={handleDisable} loading={disable.isPending} disabled={!disableCode.trim()} data-testid="two-factor-disable-button">
            Disable 2FA
          </Button>
        </div>
      </div>
    );
  }

  if (enrollment) {
    return (
      <div className="flex flex-col gap-3" data-testid="two-factor-enrolling">
        <p className="text-sm text-fg-muted">
          Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, …) — or enter the
          secret manually — then enter the 6-digit code it shows to finish enrolling.
        </p>
        <EnrollmentQrCode otpauthUrl={enrollment.otpauthUrl} />
        <CopyField label="otpauth URL" value={enrollment.otpauthUrl} testId="two-factor-otpauth-url" />
        <CopyField label="Secret (manual entry)" value={enrollment.secret} testId="two-factor-secret" />
        <div className="flex items-end gap-2">
          <Input
            label="6-digit code"
            placeholder="123456"
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value)}
            wrapperClassName="w-40"
            data-testid="two-factor-verify-code-input"
          />
          <Button onClick={handleVerify} loading={verifyEnroll.isPending} disabled={verifyCode.length !== 6} data-testid="two-factor-verify-button">
            Verify & enable
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="two-factor-disabled">
      <p className="text-sm text-fg-muted">Two-factor authentication is not enabled on your account.</p>
      <Button onClick={handleEnroll} loading={enroll.isPending} className="self-start" data-testid="two-factor-enroll-button">
        Enable two-factor authentication
      </Button>
    </div>
  );
}
