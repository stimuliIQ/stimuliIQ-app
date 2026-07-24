// apps/api/src/modules/content/testimonials.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes (ADR-0019 pattern):
//   TestimonialsController       — /crm/testimonials admin CRUD.
//   PublicTestimonialsController — /public/testimonials anonymous read (published only).

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { TestimonialsService } from "./testimonials.service";
import {
  CreateTestimonialRequestSchema,
  type CreateTestimonialRequest,
  UpdateTestimonialRequestSchema,
  type UpdateTestimonialRequest,
  ListTestimonialsQuerySchema,
  type ListTestimonialsQuery,
  type Testimonial,
  ListPublicTestimonialsQuerySchema,
  type ListPublicTestimonialsQuery,
  type PublicTestimonial,
} from "./dto";

@Controller("crm/testimonials")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class TestimonialsController {
  constructor(private readonly service: TestimonialsService) {}

  @Get()
  @RequirePermission("content.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListTestimonialsQuerySchema)) query: ListTestimonialsQuery,
  ): Promise<PaginatedResult<Testimonial>> {
    return this.service.list(user.tenantId, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("content.create")
  @UsePipes(new ZodValidationPipe(CreateTestimonialRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateTestimonialRequest): Promise<Testimonial> {
    return this.service.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("content.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateTestimonialRequestSchema)) body: UpdateTestimonialRequest,
  ): Promise<Testimonial> {
    return this.service.update(user.tenantId, id, body);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequirePermission("content.publish")
  async publish(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<Testimonial> {
    return this.service.publish(user.tenantId, id);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("content.delete")
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<{ deleted: true }> {
    await this.service.softDelete(user.tenantId, id);
    return { deleted: true };
  }
}

@Controller("public/testimonials")
export class PublicTestimonialsController {
  constructor(private readonly service: TestimonialsService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(ListPublicTestimonialsQuerySchema)) query: ListPublicTestimonialsQuery): Promise<PublicTestimonial[]> {
    return this.service.listPublic(query.programId);
  }
}
