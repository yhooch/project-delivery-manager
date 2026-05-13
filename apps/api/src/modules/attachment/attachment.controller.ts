import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  AttachmentListQuerySchema,
  AttachmentIdPathParamsSchema,
  CreateAttachmentRequestSchema,
  PresignAttachmentRequestSchema,
  type Attachment,
  type AttachmentTargetType,
  type CreateAttachmentRequest,
  type GetAttachmentDownloadUrlResponse,
  type PageResult,
  type PresignAttachmentRequest,
  type PresignAttachmentResponse,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { AttachmentService } from "./attachment.service";

@Controller("attachments")
@UseGuards(RequireSessionGuard)
export class AttachmentController {
  constructor(
    @Inject(AttachmentService)
    private readonly attachments: AttachmentService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Post("presign")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async presign(
    @Body(new ZodValidationPipe(PresignAttachmentRequestSchema))
    body: PresignAttachmentRequest,
    @Req() request: RequestWithContext,
  ): Promise<PresignAttachmentResponse> {
    const session = this.currentUser.requireSession(request);

    return this.attachments.presign(session.userId, body);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async create(
    @Body(new ZodValidationPipe(CreateAttachmentRequestSchema))
    body: CreateAttachmentRequest,
    @Req() request: RequestWithContext,
  ): Promise<Attachment> {
    const session = this.currentUser.requireSession(request);

    return this.attachments.create(session.userId, body);
  }

  @Get()
  async list(
    @Query(new ZodValidationPipe(AttachmentListQuerySchema))
    query: {
      page: number;
      pageSize: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      targetId: string;
      targetType: AttachmentTargetType;
    },
    @Req() request: RequestWithContext,
  ): Promise<PageResult<Attachment>> {
    const session = this.currentUser.requireSession(request);

    return this.attachments.list(session.userId, query);
  }

  @Get(":attachmentId/download-url")
  async getDownloadUrl(
    @Param(new ZodValidationPipe(AttachmentIdPathParamsSchema))
    params: { attachmentId: string },
    @Req() request: RequestWithContext,
  ): Promise<GetAttachmentDownloadUrlResponse> {
    const session = this.currentUser.requireSession(request);

    return this.attachments.getDownloadUrl(session.userId, params.attachmentId);
  }
}
