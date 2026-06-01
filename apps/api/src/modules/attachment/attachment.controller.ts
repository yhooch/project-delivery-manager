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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  AttachmentListQuerySchema,
  AttachmentIdPathParamsSchema,
  type Attachment,
  type AttachmentTargetType,
  type PageResult,
  UploadAttachmentRequestSchema,
} from "@project-delivery/shared";

import { ApiException } from "../../http/api-exception";
import { SkipApiResponse } from "../../http/api-response.interceptor";
import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { getRequestMetadata } from "../auth/request-metadata";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { AttachmentService } from "./attachment.service";

type UploadedAttachmentFile = {
  buffer?: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
};

type RawDownloadResponse = {
  end(body: Buffer): void;
  setHeader(name: string, value: string | number): void;
  status(statusCode: number): RawDownloadResponse;
};

@Controller("attachments")
@UseGuards(RequireSessionGuard)
export class AttachmentController {
  constructor(
    @Inject(AttachmentService)
    private readonly attachments: AttachmentService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @Body(new ZodValidationPipe(UploadAttachmentRequestSchema))
    body: { targetId: string; targetType: AttachmentTargetType },
    @UploadedFile() file: UploadedAttachmentFile | undefined,
    @Req() request: RequestWithContext,
  ): Promise<Attachment> {
    const session = this.currentUser.requireSession(request);
    const uploadFile = requireUploadedFile(file);

    return this.attachments.upload(
      session.userId,
      body,
      uploadFile,
      getRequestMetadata(request),
    );
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

  @Get(":attachmentId/download")
  @SkipApiResponse()
  async download(
    @Param(new ZodValidationPipe(AttachmentIdPathParamsSchema))
    params: { attachmentId: string },
    @Req() request: RequestWithContext,
    @Res() response: RawDownloadResponse,
  ): Promise<void> {
    const session = this.currentUser.requireSession(request);
    const download = await this.attachments.download(
      session.userId,
      params.attachmentId,
    );

    response.status(HttpStatus.OK);
    response.setHeader(
      "Content-Type",
      formatAttachmentDownloadContentType(download.mimeType),
    );
    response.setHeader("Content-Length", download.size);
    response.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(download.attachment.fileName)}`,
    );
    response.end(download.body);
  }
}

function requireUploadedFile(file: UploadedAttachmentFile | undefined) {
  if (
    !file?.buffer ||
    !file.originalname ||
    !file.mimetype ||
    typeof file.size !== "number"
  ) {
    throw new ApiException(
      "VALIDATION_ERROR",
      "Attachment file is required",
      HttpStatus.BAD_REQUEST,
    );
  }

  return {
    buffer: file.buffer,
    fileName: normalizeUploadedFileName(file.originalname),
    mimeType: file.mimetype,
    size: file.size,
  };
}

function normalizeUploadedFileName(fileName: string): string {
  const decoded = Buffer.from(fileName, "latin1").toString("utf8");

  return decoded.includes("\uFFFD") ? fileName : decoded;
}

export function formatAttachmentDownloadContentType(mimeType: string): string {
  if (!/^text\//iu.test(mimeType) || /;\s*charset=/iu.test(mimeType)) {
    return mimeType;
  }

  return `${mimeType}; charset=utf-8`;
}
