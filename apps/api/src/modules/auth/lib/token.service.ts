// apps/api/src/modules/auth/lib/token.service.ts
//
// RS256 JWT signing/verification (CLAUDE.md §1, docs/04-trd-architecture.md §2.3).
// Access tokens (15m) carry `sub` (user id), `tenant_id`, `roles` (role keys). Refresh
// tokens (7d) carry `sub` + `sid` (session row id) + `jti` (a fresh random id per
// rotation — used only for traceability, NOT as the reuse-detection mechanism; reuse
// detection itself compares the *hash* of the presented refresh token against the
// session row's stored `refreshHash`, see auth.service.ts).
//
// No business logic here — purely token encode/decode. AuthService owns rotation,
// session lookup, and reuse-detection policy.

import { Injectable } from "@nestjs/common";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createHash } from "node:crypto";
import { validateEnv } from "../../../config/env";
import { JWT_ALG, loadPrivateKey, loadPublicKey } from "./jwt-keys";

const ISSUER = "stimuliiq-api";

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  tenant_id: string;
  roles: string[];
}

export interface RefreshTokenClaims extends JWTPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class TokenService {
  async signAccessToken(claims: { userId: string; tenantId: string; roles: string[] }): Promise<string> {
    const env = validateEnv();
    const privateKey = await loadPrivateKey();
    return new SignJWT({ tenant_id: claims.tenantId, roles: claims.roles })
      .setProtectedHeader({ alg: JWT_ALG, typ: "JWT" })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(env.JWT_ACCESS_TTL)
      .sign(privateKey);
  }

  async signRefreshToken(claims: { userId: string; sessionId: string }): Promise<string> {
    const env = validateEnv();
    const privateKey = await loadPrivateKey();
    return new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: JWT_ALG, typ: "JWT" })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setJti(createHash("sha256").update(`${claims.sessionId}:${Date.now()}:${Math.random()}`).digest("hex"))
      .setIssuedAt()
      .setExpirationTime(env.JWT_REFRESH_TTL)
      .sign(privateKey);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const env = validateEnv();
    const publicKey = await loadPublicKey();
    // `audience` REQUIRES the token's `aud` claim to match env.JWT_AUDIENCE — jose
    // throws JWTClaimValidationFailed for a missing/mismatched `aud` (P0 followups M-4).
    const { payload } = await jwtVerify(token, publicKey, { issuer: ISSUER, audience: env.JWT_AUDIENCE });
    return payload as AccessTokenClaims;
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    const env = validateEnv();
    const publicKey = await loadPublicKey();
    const { payload } = await jwtVerify(token, publicKey, { issuer: ISSUER, audience: env.JWT_AUDIENCE });
    return payload as RefreshTokenClaims;
  }

  /** Deterministic, non-reversible hash of a refresh token for at-rest storage (sessions.refresh_hash). */
  hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
