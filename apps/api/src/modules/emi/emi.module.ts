// apps/api/src/modules/emi/emi.module.ts
//
// Wires the Phase-9 Completion EMI plans + dunning feature module (T11/T24,
// docs/plans/phase-9-completion.md).
//
// Imports:
//   AuthModule            — JwtAuthGuard, PermissionsGuard, ScopeInterceptor.
//   PaymentProviderModule — PAYMENT_PROVIDER (Razorpay TEST charge per installment).
//   MailProviderModule    — MAIL_PROVIDER (SyncEmiDunningAdapter's direct email send).
//   RedisModule           — RedisService (mark-paid Idempotency-Key belt-and-suspenders).
//
// QUEUE_DRIVER GATE (T18/R1, mirrors commerce.module.ts / live-classes.module.ts exactly):
//   EMI_DUNNING_PORT binds SyncEmiDunningAdapter (QUEUE_DRIVER=sync, default) or
//   BullMqEmiDunningAdapter (QUEUE_DRIVER=bullmq).

import { Module, Logger } from "@nestjs/common";
import { validateEnv } from "../../config/env";
import { AuthModule } from "../auth/auth.module";
import { RedisModule } from "../../redis/redis.module";
import { PaymentProviderModule } from "../commerce/providers/payment/payment-provider.module";
import { MailProviderModule } from "../notifications/providers/mail/mail-provider.module";
import { MAIL_PROVIDER, type MailProvider } from "../notifications/providers/mail/mail-provider.interface";
import { CrmEmiController, MyEmiController } from "./emi.controller";
import { EmiService } from "./emi.service";
import { EmiRepository } from "./emi.repository";
import { EmiDunningScheduler } from "./emi-dunning.scheduler";
import { EMI_DUNNING_PORT, SyncEmiDunningAdapter, BullMqEmiDunningAdapter, type EmiDunningPort } from "./dunning/emi-dunning.port";

const bootLogger = new Logger("EmiModule");

function createEmiDunningPort(mail: MailProvider): EmiDunningPort {
  const env = validateEnv();
  if (env.QUEUE_DRIVER === "bullmq") {
    bootLogger.log("[EmiModule] QUEUE_DRIVER=bullmq, binding BullMqEmiDunningAdapter.");
    return new BullMqEmiDunningAdapter();
  }
  return new SyncEmiDunningAdapter(mail);
}

@Module({
  imports: [AuthModule, RedisModule, PaymentProviderModule, MailProviderModule],
  controllers: [CrmEmiController, MyEmiController],
  providers: [
    EmiService,
    EmiRepository,
    EmiDunningScheduler,
    {
      provide: EMI_DUNNING_PORT,
      useFactory: createEmiDunningPort,
      inject: [MAIL_PROVIDER],
    },
  ],
  exports: [EmiService],
})
export class EmiModule {}
