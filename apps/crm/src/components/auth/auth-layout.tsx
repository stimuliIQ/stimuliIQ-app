// Shared chrome for every signed-out CRM screen (login, forgot-password,
// reset-password): the green gradient shell, the centred wordmark above the
// card, and the staff-only footnote. The card itself stays with each form so
// its copy, testid and fields remain local — pass `auth-card` on it to get the
// glass treatment (see ../../index.css).
import * as React from "react";

export interface AuthLayoutProps {
  children: React.ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps): React.JSX.Element {
  return (
    <div
      className="auth-shell flex min-h-screen flex-col items-center justify-center px-4 py-10"
      data-density="compact"
      data-testid="auth-shell"
    >
      <div className="w-full max-w-sm">
        <img
          src="/stimuliiq-logo.png"
          alt="Stimuli IQ"
          className="mx-auto mb-7 h-9 w-auto"
          data-testid="auth-logo"
        />
        {children}
        <p className="mt-6 text-center text-xs text-fg-muted">Staff access only · Stimuli IQ admin</p>
      </div>
    </div>
  );
}
