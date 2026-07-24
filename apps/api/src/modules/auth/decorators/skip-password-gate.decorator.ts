// apps/api/src/modules/auth/decorators/skip-password-gate.decorator.ts
//
// `@SkipPasswordGate()` — opts a route (or an entire controller) out of the global
// `MustChangePasswordGuard` (see guards/must-change-password.guard.ts). Same
// `SetMetadata`-based shape as `@RequirePermission` (require-permission.decorator.ts).
// Apply ONLY to the minimal set of routes a `mustChangePassword: true` session must be
// able to reach: change-password itself, logout, refresh, and GET /me (so the client can
// even discover the gate is up). Every other authenticated route stays gated by default —
// do NOT reach for this decorator to work around the gate elsewhere.

import { SetMetadata } from "@nestjs/common";

export const SKIP_PASSWORD_GATE_KEY = "stimuliiq:skipPasswordGate";

export const SkipPasswordGate = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_PASSWORD_GATE_KEY, true);
