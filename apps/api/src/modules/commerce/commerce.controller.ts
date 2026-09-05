// apps/api/src/modules/commerce/commerce.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/commerce/* (matches @repo/api-client commerce methods exactly).
//
// Permission keys (prisma/seed.ts P2 matrix):
//   orders.view/create/edit/delete (Finance=all; Owner/Admin=all; BranchMgr=branch view)
//   payments.view/create          (Finance=all; Owner/Admin=all; BranchMgr=branch view)
//   invoices.view                 (Finance=all; Owner/Admin=all)
//   refunds.view/create/approve   (Finance=all; Owner/Admin=all; refunds.approve = Finance+Owner only)
//   coupons.view/create/edit/delete (Marketing=all; Finance=view; Owner/Admin=all)
//
// WEBHOOK ROUTE: POST /commerce/payments/webhook — see webhook.controller.ts (a SEPARATE
//   file/class, deliberately decoupled from this file's @repo/types DTO imports so it
//   stays directly unit-testable — see that file's header comment for why).
//
// IDEMPOTENCY KEYS:
//   - Passed via `Idempotency-Key` header on create/mutating endpoints.
//   - Required for: create order, initiate checkout, verify payment, manual payment,
//     request refund, approve/reject refund, create coupon.

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  OrderDetail,
  OrderSummary,
  PaymentDetail,
  PaymentSummary,
  InvoiceDetail,
  InvoiceSummary,
  InvoiceDownloadResponse,
  ReceiptDownloadResponse,
  RefundDetail,
  RefundSummary,
  CouponDetail,
  CouponSummary,
  ValidateCouponResponse,
  LedgerReconciliation,
  CreateRazorpayOrderResponse,
  CreatePaymentLinkResponse,
  SendPaymentLinksRequest,
  SendPaymentLinksResponse,
  UpdateOrderPriceRequest,
} from "@repo/types";
// Value import: a zod schema is runtime code, and the block above is `import type`.
import { UpdateOrderPriceRequestSchema } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { CommerceService } from "./commerce.service";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./providers/payment/payment-provider.interface";
import { Inject } from "@nestjs/common";
import {
  CreateOrderRequestSchema,
  type CreateOrderRequest,
  SendPaymentLinksRequestSchema,
  ListOrdersQuerySchema,
  type ListOrdersQuery,
  VerifyPaymentRequestSchema,
  type VerifyPaymentRequest,
  ManualPaymentRequestSchema,
  type ManualPaymentRequest,
  ListPaymentsQuerySchema,
  type ListPaymentsQuery,
  ListInvoicesQuerySchema,
  type ListInvoicesQuery,
  RequestRefundRequestSchema,
  type RequestRefundRequest,
  ApproveRefundRequestSchema,
  type ApproveRefundRequest,
  RejectRefundRequestSchema,
  type RejectRefundRequest,
  ListRefundsQuerySchema,
  type ListRefundsQuery,
  CreateCouponRequestSchema,
  type CreateCouponRequest,
  UpdateCouponRequestSchema,
  type UpdateCouponRequest,
  ListCouponsQuerySchema,
  type ListCouponsQuery,
  ValidateCouponRequestSchema,
  type ValidateCouponRequest,
} from "./dto";

// ─────────────────────────────────────────────────────────────────────────────
// Helper to extract idempotency key from header
// ─────────────────────────────────────────────────────────────────────────────

function extractIdempotencyKey(header: string | undefined): string {
  // If no header provided, generate a random one (not truly idempotent from client side,
  // but prevents server-side crash). Per docs/04 §2.14: header is required on unsafe mutations.
  // The SDK always sends one (see api-client order/payments methods).
  return header ?? `auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Controller
// ─────────────────────────────────────────────────────────────────────────────

@Controller("commerce")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CommerceController {
  constructor(
    private readonly commerceService: CommerceService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  // ─── ORDERS ──────────────────────────────────────────────────────────────

  @Get("orders")
  @RequirePermission("orders.view")
  async listOrders(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListOrdersQuerySchema)) query: ListOrdersQuery,
  ): Promise<PaginatedResult<OrderSummary>> {
    return this.commerceService.listOrders(user.tenantId, user.id, query);
  }

  @Get("orders/:id")
  @RequirePermission("orders.view")
  async getOrder(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<OrderDetail> {
    return this.commerceService.getOrderById(user.tenantId, user.id, id);
  }

  @Post("orders")
  @HttpCode(201)
  @RequirePermission("orders.create")
  async createOrder(
    @CurrentUser() user: RequestUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(CreateOrderRequestSchema)) body: CreateOrderRequest,
  ): Promise<OrderDetail> {
    return this.commerceService.createOrder(
      user.tenantId,
      user.id,
      extractIdempotencyKey(idempotencyKey),
      body,
    );
  }

  /**
   * Cancel an UNPAID order (un-assign a program opened by mistake). Soft-delete
   * + coupon release; 422 for any non-`created` order (paid → refund flow).
   */
  /**
   * PATCH /api/v1/crm/orders/:id/price — sell a programme below its list price.
   *
   * Permission: `orders.edit`, the same key that already gates cancelling an order and
   * starting its checkout. A dedicated `orders.discount` was considered and rejected: a new
   * key does nothing until it is seeded on the live database, so the feature would ship
   * 403ing for everyone, and the audience is the same people either way. If discounting ever
   * needs to be restricted more tightly than cancelling, that is the moment to split it.
   *
   * Refuses once the order is paid or has any live payment — see the service for why. Every
   * successful change notifies the other active super admins; the audit row is written by the
   * Prisma extension regardless.
   */
  @Patch("orders/:id/price")
  @RequirePermission("orders.edit")
  async updateOrderPrice(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateOrderPriceRequestSchema)) body: UpdateOrderPriceRequest,
  ): Promise<OrderDetail> {
    return this.commerceService.updateOrderPrice(user.tenantId, user.id, id, body);
  }

  @Delete("orders/:id")
  @HttpCode(204)
  @RequirePermission("orders.edit")
  async cancelOrder(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.commerceService.cancelOrder(user.tenantId, user.id, id);
  }

  @Post("orders/:id/pay")
  @HttpCode(200)
  @RequirePermission("orders.edit")
  async initiateRazorpayCheckout(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CreateRazorpayOrderResponse> {
    return this.commerceService.initiateRazorpayCheckout(user.tenantId, user.id, id);
  }

  /**
   * POST /commerce/orders/:id/payment-link — mint a signed public pay link for an
   * OPEN order to send to the student (lifecycle-redesign). The link points at the
   * public web app's /pay/:token page; the token itself is the authorization (HMAC
   * over tenant+order+expiry — see pay-link.util.ts). payments.create-gated: the
   * same staff who may record a payment may solicit one.
   */
  @Post("orders/:id/payment-link")
  @HttpCode(200)
  @RequirePermission("payments.create")
  async createPaymentLink(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CreatePaymentLinkResponse> {
    return this.commerceService.mintPaymentLink(user.tenantId, user.id, id);
  }

  /**
   * Email payment link(s) straight to the student — one order or several (same
   * student, all payable); a multi-order send is ONE email with a Pay button per
   * program plus the total. Same gate as minting a link.
   */
  @Post("orders/payment-links/send")
  @HttpCode(200)
  @RequirePermission("payments.create")
  async sendPaymentLinks(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(SendPaymentLinksRequestSchema)) body: SendPaymentLinksRequest,
  ): Promise<SendPaymentLinksResponse> {
    return this.commerceService.sendPaymentLinks(user.tenantId, user.id, body);
  }

  // ─── PAYMENTS ────────────────────────────────────────────────────────────

  @Get("payments")
  @RequirePermission("payments.view")
  async listPayments(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListPaymentsQuerySchema)) query: ListPaymentsQuery,
  ): Promise<PaginatedResult<PaymentSummary>> {
    return this.commerceService.listPayments(user.tenantId, user.id, query);
  }

  @Get("payments/reconciliation")
  @RequirePermission("payments.view")
  async reconciliation(
    @CurrentUser() user: RequestUser,
    @Query("from") from: string,
    @Query("to") to: string,
  ): Promise<LedgerReconciliation> {
    if (!from || !to) {
      throw new NotFoundException({
        code: "commerce.reconciliation_missing_params",
        title: "Missing required query params: from and to",
      });
    }
    return this.commerceService.getLedgerReconciliation(user.tenantId, from, to);
  }

  @Get("payments/:id")
  @RequirePermission("payments.view")
  async getPayment(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<PaymentDetail> {
    return this.commerceService.getPaymentById(user.tenantId, user.id, id);
  }

  /**
   * GET /api/v1/commerce/payments/:id/receipt — T27 (docs/plans/phase-9-completion.md).
   * Owner (own-scope) or Finance/Admin (all-scope); IDOR -> 404 (see CommerceService).
   */
  @Get("payments/:id/receipt")
  @RequirePermission("payments.view")
  async getReceipt(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<ReceiptDownloadResponse> {
    return this.commerceService.getReceiptDownloadUrl(user.tenantId, user.id, id);
  }

  @Post("payments/verify")
  @HttpCode(200)
  @RequirePermission("payments.create")
  async verifyPayment(
    @CurrentUser() user: RequestUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(VerifyPaymentRequestSchema)) body: VerifyPaymentRequest,
  ): Promise<PaymentDetail> {
    return this.commerceService.verifyPayment(user.tenantId, user.id, body);
  }

  @Post("payments/manual")
  @HttpCode(200)
  @RequirePermission("payments.create")
  async recordManualPayment(
    @CurrentUser() user: RequestUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(ManualPaymentRequestSchema)) body: ManualPaymentRequest,
  ): Promise<PaymentDetail> {
    return this.commerceService.recordManualPayment(
      user.tenantId,
      user.id,
      extractIdempotencyKey(idempotencyKey),
      body,
    );
  }

  // ─── INVOICES ────────────────────────────────────────────────────────────

  @Get("invoices")
  @RequirePermission("invoices.view")
  async listInvoices(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListInvoicesQuerySchema)) query: ListInvoicesQuery,
  ): Promise<PaginatedResult<InvoiceSummary>> {
    return this.commerceService.listInvoices(user.tenantId, user.id, query);
  }

  @Get("invoices/:id")
  @RequirePermission("invoices.view")
  async getInvoice(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<InvoiceDetail> {
    return this.commerceService.getInvoiceById(user.tenantId, user.id, id);
  }

  @Get("invoices/:id/download")
  @RequirePermission("invoices.view")
  async downloadInvoice(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<InvoiceDownloadResponse> {
    return this.commerceService.getInvoiceDownloadUrl(user.tenantId, user.id, id);
  }

  // ─── REFUNDS ─────────────────────────────────────────────────────────────

  @Get("refunds")
  @RequirePermission("refunds.view")
  async listRefunds(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListRefundsQuerySchema)) query: ListRefundsQuery,
  ): Promise<PaginatedResult<RefundSummary>> {
    return this.commerceService.listRefunds(user.tenantId, user.id, query);
  }

  @Get("refunds/:id")
  @RequirePermission("refunds.view")
  async getRefund(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<RefundDetail> {
    return this.commerceService.getRefundById(user.tenantId, user.id, id);
  }

  @Post("refunds")
  @HttpCode(201)
  @RequirePermission("refunds.create")
  async requestRefund(
    @CurrentUser() user: RequestUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(RequestRefundRequestSchema)) body: RequestRefundRequest,
  ): Promise<RefundDetail> {
    return this.commerceService.requestRefund(
      user.tenantId,
      user.id,
      extractIdempotencyKey(idempotencyKey),
      body,
    );
  }

  @Post("refunds/:id/approve")
  @HttpCode(200)
  @RequirePermission("refunds.approve")
  async approveRefund(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ApproveRefundRequestSchema)) body: ApproveRefundRequest,
  ): Promise<RefundDetail> {
    return this.commerceService.approveRefund(user.tenantId, user.id, id, body);
  }

  @Post("refunds/:id/reject")
  @HttpCode(200)
  @RequirePermission("refunds.approve")
  async rejectRefund(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(RejectRefundRequestSchema)) body: RejectRefundRequest,
  ): Promise<RefundDetail> {
    return this.commerceService.rejectRefund(user.tenantId, user.id, id, body);
  }

  // ─── COUPONS ─────────────────────────────────────────────────────────────

  @Get("coupons")
  @RequirePermission("coupons.view")
  async listCoupons(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListCouponsQuerySchema)) query: ListCouponsQuery,
  ): Promise<PaginatedResult<CouponSummary>> {
    return this.commerceService.listCoupons(user.tenantId, user.id, query);
  }

  @Get("coupons/:id")
  @RequirePermission("coupons.view")
  async getCoupon(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CouponDetail> {
    return this.commerceService.getCouponById(user.tenantId, user.id, id);
  }

  @Post("coupons")
  @HttpCode(201)
  @RequirePermission("coupons.create")
  async createCoupon(
    @CurrentUser() user: RequestUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(CreateCouponRequestSchema)) body: CreateCouponRequest,
  ): Promise<CouponDetail> {
    return this.commerceService.createCoupon(
      user.tenantId,
      user.id,
      extractIdempotencyKey(idempotencyKey),
      body,
    );
  }

  @Patch("coupons/:id")
  @RequirePermission("coupons.edit")
  async updateCoupon(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateCouponRequestSchema)) body: UpdateCouponRequest,
  ): Promise<CouponDetail> {
    return this.commerceService.updateCoupon(user.tenantId, user.id, id, body);
  }

  @Delete("coupons/:id")
  @RequirePermission("coupons.delete")
  async deleteCoupon(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CouponDetail> {
    return this.commerceService.deleteCoupon(user.tenantId, user.id, id);
  }

  @Post("coupons/validate")
  @HttpCode(200)
  @RequirePermission("coupons.view")
  async validateCoupon(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(ValidateCouponRequestSchema)) body: ValidateCouponRequest,
  ): Promise<ValidateCouponResponse> {
    return this.commerceService.validateCoupon(user.tenantId, body);
  }
}

// WebhookController (POST /commerce/payments/webhook) now lives in webhook.controller.ts
// (see that file's header for why it was extracted out of this one).
