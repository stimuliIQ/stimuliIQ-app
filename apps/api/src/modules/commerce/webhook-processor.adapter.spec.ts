// apps/api/src/modules/commerce/webhook-processor.adapter.spec.ts
//
// Unit tests for SyncWebhookProcessorAdapter — focuses on H-2 strict-match fix:
//   - refund.processed with an unmatched providerRefundId → no-op (no wrong row mutated)
//   - refund.processed with correct providerRefundId → processed + payment refunded (full)
//   - refund.processed with correct providerRefundId but partial amount → payment stays captured
//   - refund already processed → idempotent no-op (early return)

import { SyncWebhookProcessorAdapter } from "./webhook-processor.adapter";
import type { CommerceRepository, PaymentRow, RefundRow } from "./commerce.repository";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const PAYMENT_ID = "22222222-2222-2222-2222-222222222222";
const ORDER_ID = "33333333-3333-3333-3333-333333333333";
const REFUND_ID = "44444444-4444-4444-4444-444444444444";
const PROVIDER_PAYMENT_ID = "pay_rzp_abc";
const PROVIDER_REFUND_ID = "rfnd_rzp_xyz";

function makePaymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: PAYMENT_ID,
    tenantId: TENANT_ID,
    orderId: ORDER_ID,
    provider: "razorpay",
    providerPaymentId: PROVIDER_PAYMENT_ID,
    providerOrderId: "order_rzp_123",
    amountPaise: 100000,
    status: "captured",
    method: "upi",
    signatureVerified: true,
    isManual: false,
    paidAt: new Date("2026-01-01"),
    reference: null,
    notes: null,
    studentId: "student-1",
    studentName: "Test Student",
    programId: "program-1",
    programTitle: "Test Program",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    ...overrides,
  };
}

function makeRefundRow(overrides: Partial<RefundRow> = {}): RefundRow {
  return {
    id: REFUND_ID,
    tenantId: TENANT_ID,
    paymentId: PAYMENT_ID,
    orderId: ORDER_ID,
    amountPaise: 100000, // full refund by default
    reason: "Customer requested",
    status: "approved",
    requestedById: "user-requester",
    requestedByName: "Requester",
    approvedById: "user-approver",
    approvedByName: "Approver",
    providerRefundId: PROVIDER_REFUND_ID,
    processedAt: null,
    studentId: "student-1",
    studentName: "Test Student",
    programTitle: "Test Program",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    ...overrides,
  };
}

function makeRepository(): Mocked<CommerceRepository> {
  return {
    findPaymentByProviderPaymentId: jest.fn(),
    listRefunds: jest.fn(),
    transaction: jest.fn(),
    updateRefundApprove: jest.fn(),
    updatePaymentStatus: jest.fn(),
    // other repo methods not used by the webhook processor — add minimal stubs
    findOrderByIdempotencyKey: jest.fn(),
    findOrderById: jest.fn(),
    listOrders: jest.fn(),
    createOrder: jest.fn(),
    updateOrderStatus: jest.fn(),
    findProgramById: jest.fn(),
    findBatchById: jest.fn(),
    countBatchEnrollments: jest.fn(),
    findStudentById: jest.fn(),
    findPaymentById: jest.fn(),
    findPaymentByProviderOrderId: jest.fn(),
    listPayments: jest.fn(),
    createPayment: jest.fn(),
    updatePaymentCapture: jest.fn(),
    sumCapturedPayments: jest.fn(),
    sumProcessedRefunds: jest.fn(),
    sumPaidOrders: jest.fn(),
    findInvoiceById: jest.fn(),
    findInvoiceByOrderId: jest.fn(),
    listInvoices: jest.fn(),
    generateInvoiceNumber: jest.fn(),
    createInvoice: jest.fn(),
    updateInvoiceStatus: jest.fn(),
    findRefundById: jest.fn(),
    createRefund: jest.fn(),
    updateRefundStatus: jest.fn(),
    findCouponById: jest.fn(),
    findCouponByCode: jest.fn(),
    listCoupons: jest.fn(),
    createCoupon: jest.fn(),
    updateCoupon: jest.fn(),
    softDeleteCoupon: jest.fn(),
    incrementCouponUsed: jest.fn(),
    findExistingEnrollment: jest.fn(),
    createEnrollment: jest.fn(),
    restoreEnrollment: jest.fn(),
    findEnrollmentByOrderId: jest.fn(),
    listCallerBranchIds: jest.fn(),
  } as unknown as Mocked<CommerceRepository>;
}

describe("SyncWebhookProcessorAdapter — refund.processed (H-2 strict match)", () => {
  let adapter: SyncWebhookProcessorAdapter;
  let repository: Mocked<CommerceRepository>;
  const mockInvoiceGen = { enqueue: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    repository = makeRepository();
    // Direct instantiation — no NestJS DI needed for unit tests on this class
    adapter = new SyncWebhookProcessorAdapter(
      repository as unknown as CommerceRepository,
      mockInvoiceGen as never,
      { provisionForStudentProfile: jest.fn().mockResolvedValue(false) } as never,
    );
    jest.clearAllMocks();
  });

  function refundPayload(overrides: {
    providerRefundId?: string;
    providerPaymentId?: string;
    amount?: number;
  } = {}) {
    return {
      event: "refund.processed",
      payload: {
        refund: {
          entity: {
            id: overrides.providerRefundId ?? PROVIDER_REFUND_ID,
            payment_id: overrides.providerPaymentId ?? PROVIDER_PAYMENT_ID,
            amount: overrides.amount ?? 100000,
          },
        },
      },
    };
  }

  // H-2: No row matches providerRefundId → strict no-op, no mutation
  it("H-2: unmatched providerRefundId → no-op, does NOT mutate any wrong refund row", async () => {
    repository.findPaymentByProviderPaymentId.mockResolvedValue(makePaymentRow());

    // The approved refunds list has a row with a DIFFERENT providerRefundId
    const wrongRefund = makeRefundRow({ providerRefundId: "rfnd_DIFFERENT" });
    repository.listRefunds.mockResolvedValue({ rows: [wrongRefund], total: 1 });

    // Process with a providerRefundId that doesn't match any row
    await adapter.process(refundPayload({ providerRefundId: "rfnd_UNMATCHED" }));

    // Must not mutate anything
    expect(repository.transaction).not.toHaveBeenCalled();
    expect(repository.updateRefundApprove).not.toHaveBeenCalled();
    expect(repository.updatePaymentStatus).not.toHaveBeenCalled();
  });

  // H-2: Correct match → processed + full refund flips payment to refunded
  it("H-2: matched providerRefundId (full refund) → refund processed + payment=refunded (via txn)", async () => {
    const payment = makePaymentRow({ amountPaise: 100000 });
    repository.findPaymentByProviderPaymentId.mockResolvedValue(payment);

    const refund = makeRefundRow({ providerRefundId: PROVIDER_REFUND_ID, amountPaise: 100000 });
    repository.listRefunds.mockResolvedValue({ rows: [refund], total: 1 });

    const fakeTx = {
      refund: { update: jest.fn().mockResolvedValue({}) },
      payment: { update: jest.fn().mockResolvedValue({}) },
    };
    repository.transaction.mockImplementation(async (fn) => fn(fakeTx as never));

    await adapter.process(refundPayload({ amount: 100000 }));

    expect(repository.transaction).toHaveBeenCalledTimes(1);
    // Refund row must be updated
    expect(fakeTx.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: REFUND_ID },
        data: expect.objectContaining({ status: "processed", providerRefundId: PROVIDER_REFUND_ID }),
      }),
    );
    // Full refund → payment flipped to refunded
    expect(fakeTx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID },
        data: { status: "refunded" },
      }),
    );
  });

  // H-2: Partial refund → payment stays "captured" (no partially_refunded enum value)
  it("H-2: matched providerRefundId (partial refund) → refund processed, payment stays captured", async () => {
    const payment = makePaymentRow({ amountPaise: 100000 });
    repository.findPaymentByProviderPaymentId.mockResolvedValue(payment);

    // Partial refund: 50000 < 100000
    const refund = makeRefundRow({ providerRefundId: PROVIDER_REFUND_ID, amountPaise: 50000 });
    repository.listRefunds.mockResolvedValue({ rows: [refund], total: 1 });

    const fakeTx = {
      refund: { update: jest.fn().mockResolvedValue({}) },
      payment: { update: jest.fn().mockResolvedValue({}) },
    };
    repository.transaction.mockImplementation(async (fn) => fn(fakeTx as never));

    await adapter.process(refundPayload({ amount: 50000 }));

    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(fakeTx.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "processed" }) }),
    );
    // Partial refund → payment.update must NOT have been called (payment stays captured)
    expect(fakeTx.payment.update).not.toHaveBeenCalled();
  });

  // Idempotency: already-processed refund → early return, no second transaction
  it("H-2: already-processed refund → early return, no mutation (idempotent)", async () => {
    const payment = makePaymentRow();
    repository.findPaymentByProviderPaymentId.mockResolvedValue(payment);

    // The matching row is already processed
    const alreadyProcessed = makeRefundRow({
      providerRefundId: PROVIDER_REFUND_ID,
      status: "processed",
    });
    repository.listRefunds.mockResolvedValue({ rows: [alreadyProcessed], total: 1 });

    await adapter.process(refundPayload());

    // Must be a no-op
    expect(repository.transaction).not.toHaveBeenCalled();
    expect(repository.updateRefundApprove).not.toHaveBeenCalled();
    expect(repository.updatePaymentStatus).not.toHaveBeenCalled();
  });

  // Payment not found → no-op
  it("payment not found → no-op", async () => {
    repository.findPaymentByProviderPaymentId.mockResolvedValue(null);

    await adapter.process(refundPayload());

    expect(repository.listRefunds).not.toHaveBeenCalled();
    expect(repository.transaction).not.toHaveBeenCalled();
  });
});
