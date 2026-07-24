// apps/api/src/modules/auth/interceptors/scope.interceptor.ts
//
// Publishes the data-scope context resolved by `PermissionsGuard` (`req.scope`) into the
// `scopeContextStorage` AsyncLocalStorage (lib/scope-context.ts) for the duration of the
// request, so repositories — which never see the HTTP request, per the controller →
// service → repository layering (docs/04 §2.1) — can read it via `getScopeContext()` and
// translate it into a model-specific Prisma `where` filter.
//
// Runs as a NestJS interceptor (after guards, before the controller handler) so it only
// ever sees a `req.scope` that `PermissionsGuard` has already validated. For routes with
// no `@RequirePermission` (e.g. `/me`), `req.scope` is undefined and this interceptor is
// a no-op passthrough — `getScopeContext()` returns undefined in repositories for such
// routes, which is correct since there is no permission-derived scope to narrow by.

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request } from "express";
import { Observable } from "rxjs";
import { scopeContextStorage } from "../lib/scope-context";

@Injectable()
export class ScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();

    if (!req.scope || !req.user) {
      return next.handle();
    }

    const store = {
      permissionKey: req.scope.permissionKey,
      scope: req.scope.scope,
      actorId: req.user.id,
      tenantId: req.user.tenantId,
    };

    let result$: Observable<unknown>;
    scopeContextStorage.run(store, () => {
      result$ = next.handle();
    });
    // `next.handle()` is synchronous in construction (it returns an Observable
    // immediately; the actual controller method body runs on subscription, which
    // RxJS/Nest performs later). Capturing it inside `.run()` is sufficient here because
    // we want the ALS context active for as long as the Observable is *subscribed to*
    // within this request — Nest subscribes synchronously as part of the same
    // microtask chain this interceptor was invoked from, while the ALS scope set up by
    // the audit-context middleware (an outer, broader scope already covering this same
    // call stack) ensures nested awaits keep correct context regardless.
    return result$!;
  }
}
