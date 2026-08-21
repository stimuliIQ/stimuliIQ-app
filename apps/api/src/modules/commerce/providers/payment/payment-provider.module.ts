// apps/api/src/modules/commerce/providers/payment/payment-provider.module.ts
//
// Binds PAYMENT_PROVIDER → RazorpayPaymentProvider via the DI token and
// exports it for consumption by the CommerceModule (Wave 4).
//
// Pattern mirrors AuthModule's binding of SMS_PROVIDER → Msg91SmsProvider
// (apps/api/src/modules/auth/auth.module.ts).
//
// Wave-4 CommerceModule wiring:
//
//   // apps/api/src/modules/commerce/commerce.module.ts
//   import { PaymentProviderModule } from './providers/payment/payment-provider.module';
//
//   @Module({
//     imports: [PaymentProviderModule],
//     providers: [CommerceService, CommerceRepository],
//     controllers: [CommerceController],
//   })
//   export class CommerceModule {}
//
//   // apps/api/src/modules/commerce/commerce.service.ts
//   import { Inject } from '@nestjs/common';
//   import { PAYMENT_PROVIDER, PaymentProvider } from './providers/payment/payment-provider.interface';
//
//   @Injectable()
//   export class CommerceService {
//     constructor(
//       @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
//       ...
//     ) {}
//   }
//
// Test wiring (unit tests — do not spin up the real provider):
//
//   const noopProvider = new NoopPaymentProvider();
//   const module = await Test.createTestingModule({
//     providers: [
//       CommerceService,
//       { provide: PAYMENT_PROVIDER, useValue: noopProvider },
//       // ...other deps...
//     ],
//   }).compile();
//
// Raw-body requirement for the webhook controller (see interface JSDoc):
//
//   IMPORTANT for backend-builder (Wave 4, task #5):
//   The Razorpay webhook endpoint (POST /api/v1/commerce/payments/webhook) MUST
//   receive the raw request body before any JSON parsing so that the HMAC computed
//   by verifyWebhookSignature matches Razorpay's. In NestJS/Express:
//
//   1. In apps/api/src/main.ts, enable rawBody:
//        const app = await NestFactory.create(AppModule, { rawBody: true });
//
//   2. In the webhook controller method, use RawBodyRequest:
//        import { RawBodyRequest } from '@nestjs/common';
//        import type { Request } from 'express';
//
//        @Post('payments/webhook')
//        @HttpCode(200)
//        async handleWebhook(
//          @Req() req: RawBodyRequest<Request>,
//          @Headers('x-razorpay-signature') sig: string,
//        ): Promise<{ received: boolean }> {
//          const rawBody = req.rawBody; // Buffer (available because rawBody: true in main.ts)
//          if (!rawBody) throw new BadRequestException('Raw body unavailable');
//          const verified = this.paymentProvider.verifyWebhookSignature({
//            rawBody,
//            signature: sig,
//          });
//          if (!verified) throw new UnauthorizedException('Webhook signature invalid');
//          // enqueue to BullMQ (invoice-gen, enrollment, etc.) — never process inline
//          await this.commerceService.enqueueWebhookEvent(req.body as Record<string, unknown>);
//          return { received: true };
//        }
//
//   3. The webhook route MUST be excluded from the CSRF middleware (it is called by
//      Razorpay servers, not the browser). Apply the CSRF middleware to all routes
//      EXCEPT /api/v1/commerce/payments/webhook (use forRoutes with a path exclusion
//      in CsrfMiddleware.configure(), or route it before CSRF is applied).
//
//   4. The webhook endpoint is UNAUTHENTICATED — the HMAC signature IS the auth.
//      Exclude it from JwtAuthGuard using @Public() decorator.

import { Module, Logger } from "@nestjs/common";
import { validateEnv, isProductionEnv, missingEnvVars } from "../../../../config/env";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./payment-provider.interface";
import { RazorpayPaymentProvider } from "./razorpay-payment.provider";
import { NoopPaymentProvider } from "./noop-payment.provider";

const bootLogger = new Logger("PaymentProviderModule");

/**
 * Binds PAYMENT_PROVIDER, failing closed in production.
 *
 * RazorpayPaymentProvider deliberately does NOT throw at construction — the app must
 * boot without payment config for local dev and for integration tests of unrelated
 * modules, so it validates lazily in requireKeys(). That is correct for the class, but
 * it meant a production deploy with no keys booted green and only 500'd at the moment a
 * student clicked Pay. This factory closes that gap at boot instead.
 *
 * Two distinct production failures are caught here:
 *   1. Missing keys — checkout 500s; and with no RAZORPAY_WEBHOOK_SECRET the webhook
 *      endpoint fails closed on EVERY request, so no payment ever becomes an enrollment.
 *   2. A TEST key in production — `rzp_test_*` silently accepts fake payments and
 *      enrolls students who never paid. Nothing else in the codebase inspects the prefix.
 */
function createPaymentProvider(): PaymentProvider {
  const env = validateEnv();
  const isProd = isProductionEnv(env);

  // PAYMENT_PROVIDER=disabled turns online payments OFF (mirrors LIVE_CLASS/VIDEO=disabled).
  // Bind Noop with NO production boot-throw — no Razorpay keys required. The checkout/enroll
  // funnel is inert (enrol students manually via the CRM). Use ONLY when you are not taking
  // online payments yet; set PAYMENT_PROVIDER=razorpay with live keys to enable checkout.
  if (env.PAYMENT_PROVIDER === "disabled") {
    bootLogger.log(
      "[PaymentProviderModule] PAYMENT_PROVIDER=disabled, online payments are off. " +
        "Binding NoopPaymentProvider (checkout/enroll funnel inert; enrol via the CRM).",
    );
    return new NoopPaymentProvider();
  }

  const missing = missingEnvVars({
    RAZORPAY_KEY_ID: env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: env.RAZORPAY_WEBHOOK_SECRET,
  });

  if (missing.length > 0) {
    if (isProd) {
      throw new Error(
        `[PaymentProviderModule] The following required Razorpay environment variables are ` +
          `not set: ${missing.join(", ")}. Checkout would fail, and without ` +
          `RAZORPAY_WEBHOOK_SECRET the webhook endpoint rejects every request, no payment ` +
          `would ever become an enrollment. ` +
          `The application will NOT start without them in production.`,
      );
    }
    bootLogger.warn(
      `[PaymentProviderModule] ${missing.join(", ")} not set (non-production). ` +
        `Payment operations will throw when invoked and webhooks fail closed. ` +
        `Set these before deploying to staging/prod.`,
    );
  }

  // A `rzp_test_*` key in production accepts fake payments and enrolls non-paying
  // students. Conversely a `rzp_live_*` key outside production takes REAL money during
  // testing — refuse both directions.
  const keyId = env.RAZORPAY_KEY_ID;
  if (keyId) {
    if (isProd && keyId.startsWith("rzp_test_")) {
      throw new Error(
        "[PaymentProviderModule] RAZORPAY_KEY_ID is a TEST key (rzp_test_*) in a production " +
          "environment. This would accept fake payments and enroll students who never paid. " +
          "Use a live key (rzp_live_*) in production. The application will NOT start.",
      );
    }
    if (!isProd && keyId.startsWith("rzp_live_")) {
      throw new Error(
        "[PaymentProviderModule] RAZORPAY_KEY_ID is a LIVE key (rzp_live_*) outside a " +
          "production environment. This would charge real customers real money during " +
          "development or testing. Use a test key (rzp_test_*). The application will NOT start.",
      );
    }
  }

  bootLogger.log(
    `[PaymentProviderModule] Binding RazorpayPaymentProvider` +
      (keyId
        ? ` (key: ${keyId.startsWith("rzp_live_") ? "LIVE" : "TEST"}).`
        : " (no key configured)."),
  );
  return new RazorpayPaymentProvider();
}

@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useFactory: createPaymentProvider,
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProviderModule {}
