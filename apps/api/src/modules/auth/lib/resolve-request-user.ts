// apps/api/src/modules/auth/lib/resolve-request-user.ts
//
// Shared "verify access_token cookie -> load RBAC profile" logic used by BOTH the
// audit-context middleware (best-effort, never throws) and `JwtAuthGuard` (throws
// UnauthorizedException on failure for protected routes). Single implementation so the
// two call sites can never drift on what counts as "authenticated".
//
// AUDIENCE SLOTS (see cookies.ts header): when the request declares its app via the
// `X-App-Audience` header, ONLY that app's cookie slot is consulted — a CRM tab must
// never ride an LMS session that happens to share the browser's cookie jar. Header-less
// callers fall back across legacy → lms → crm slots, first token that verifies wins.

import { TokenService } from "./token.service";
import { AuthRepository } from "../auth.repository";
import type { RequestUser } from "./request-user";
import type { AppAudience } from "@repo/types";
import { accessTokenCandidates } from "./cookies";
import { AccessTokenRevocationStore } from "./access-token-revocation";

export async function resolveRequestUser(
  cookies: Record<string, string> | undefined,
  tokenService: TokenService,
  authRepository: AuthRepository,
  accessTokenRevocation: AccessTokenRevocationStore,
  audience?: AppAudience,
): Promise<RequestUser | undefined> {
  for (const accessToken of accessTokenCandidates(cookies, audience)) {
    try {
      const claims = await tokenService.verifyAccessToken(accessToken);
      const user = await authRepository.findUserById(claims.sub);
      if (!user || user.status !== "active") continue;

      // A valid signature is not the same as a current credential. Revoking a user's
      // sessions marks the `sessions` rows, and those govern REFRESH only — this token
      // carries no session id, so without this check a stolen access token outlived the
      // password reset, 2FA recovery or admin rotation that was meant to kill it, by the
      // remainder of its 15 minutes. See lib/access-token-revocation.ts.
      if (await accessTokenRevocation.isRevoked(claims.sub, claims.iat)) continue;

      const { roleKeys, permissions } = await authRepository.getRbacProfile(user.id);
      return {
        id: user.id,
        tenantId: claims.tenant_id,
        roles: roleKeys,
        permissions,
        mustChangePassword: user.mustChangePassword,
      };
    } catch {
      // Invalid/expired token in this slot — try the next candidate (if any).
    }
  }
  return undefined;
}
