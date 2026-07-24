// FirstLoginGate (lifecycle-redesign P3) — enforces the forced first-login password
// change client-side. When /me reports `user.mustChangePassword`, the student is
// redirected to /change-password and cannot reach any learning content until they set a
// new password. Server-side the temporary password is a real (rotatable) credential, so
// this is a UX gate on top of the real control, not the control itself.
//
// Rendered inside LmsShell, which wraps every authenticated page — so the gate covers the
// whole authenticated surface. /change-password is NOT shelled, so the gate never fires
// on the page it redirects to (no loop).
"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

import { useMe } from "../../hooks/use-me";

export function FirstLoginGate(): null {
  const { me } = useMe();
  const router = useRouter();
  const pathname = usePathname();

  const mustChange = me?.user.mustChangePassword ?? false;

  React.useEffect(() => {
    if (mustChange && pathname !== "/change-password") {
      router.replace("/change-password");
    }
  }, [mustChange, pathname, router]);

  return null;
}
