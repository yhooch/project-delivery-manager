import {
  Body,
  BadRequestException,
  CallHandler,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NestInterceptor,
  Param,
  PayloadTooLargeException,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  AppendDocumentContentRequestSchema,
  DocumentIdPathParamsSchema,
  DocumentLinksByTargetQuerySchema,
  DocumentListQuerySchema,
  ImportDocxDocumentRequestSchema,
  ImportMarkdownDocumentRequestSchema,
  PageQuerySchema,
  PasteDocumentRequestSchema,
  ReimportDocumentRequestSchema,
  ReplaceDocumentLinksRequestSchema,
  SpaceIdPathParamsSchema,
  UpdateDocumentContentRequestSchema,
  UpdateDocumentMetadataRequestSchema,
  DocumentMaxImportSizeBytes,
  type AppendDocumentContentRequest,
  type Document,
  type DocumentDetail,
  type DocumentLink,
  type DocumentLinksByTargetQuery,
  type DocumentListQuery,
  type PageResult,
  type PasteDocumentRequest,
  type ReimportDocumentRequest,
  type ReplaceDocumentLinksRequest,
  type UpdateDocumentContentRequest,
  type UpdateDocumentMetadataRequest,
} from "@project-delivery/shared";
import { catchError, throwError, type Observable } from "rxjs";

import { ApiException } from "../../http/api-exception";
import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { getRequestMetadata } from "../auth/request-metadata";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import {
  normalizeUploadedFileName,
  type UploadedDocumentFile,
} from "./document-content";
import { DocumentService } from "./document.service";

type UploadedFileInput = {
  buffer?: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
};

export const documentImportMulterOptions = {
  limits: {
    fileSize: DocumentMaxImportSizeBytes,
    files: 1,
  },
};

type MultipartDocumentMetadata = {
  links?: string;
  tagIds?: string;
  title?: string;
};

@Injectable()
export class DocumentImportUploadErrorInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> | Promise<Observable<unknown>> {
    return next.handle().pipe(
      catchError((error: unknown) =>
        throwError(() => mapDocumentImportUploadException(error)),
      ),
    );
  }
}

@Controller()
@UseGuards(RequireSessionGuard)
export class DocumentController {
  constructor(
    @Inject(DocumentService)
    private readonly documents: DocumentService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("spaces/:spaceId/documents")
  async list(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(DocumentListQuerySchema))
    query: DocumentListQuery,
    @Req() request: RequestWithContext,
  ): Promise<PageResult<Document>> {
    const session = this.currentUser.requireSession(request);

    return this.documents.list(session.userId, params.spaceId, query);
  }

  @Post("spaces/:spaceId/documents/paste")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async paste(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(PasteDocumentRequestSchema))
    body: PasteDocumentRequest,
    @Req() request: RequestWithContext,
  ): Promise<Document> {
    const session = this.currentUser.requireSession(request);

    return this.documents.paste(
      session.userId,
      params.spaceId,
      body,
      getRequestMetadata(request),
    );
  }

  @Post("spaces/:spaceId/documents/import-markdown")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  @UseInterceptors(
    DocumentImportUploadErrorInterceptor,
    FileInterceptor("file", documentImportMulterOptions),
  )
  async importMarkdown(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body() body: MultipartDocumentMetadata,
    @UploadedFile() file: UploadedFileInput | undefined,
    @Req() request: RequestWithContext,
  ): Promise<Document> {
    const session = this.currentUser.requireSession(request);

    return this.documents.importMarkdown(
      session.userId,
      params.spaceId,
      parseMultipartMetadata(body, ImportMarkdownDocumentRequestSchema),
      requireUploadedFile(file),
      getRequestMetadata(request),
    );
  }

  @Post("spaces/:spaceId/documents/import-docx")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  @UseInterceptors(
    DocumentImportUploadErrorInterceptor,
    FileInterceptor("file", documentImportMulterOptions),
  )
  async importDocx(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body() body: MultipartDocumentMetadata,
    @UploadedFile() file: UploadedFileInput | undefined,
    @Req() request: RequestWithContext,
  ): Promise<Document> {
    const session = this.currentUser.requireSession(request);

    return this.documents.importDocx(
      session.userId,
      params.spaceId,
      parseMultipartMetadata(body, ImportDocxDocumentRequestSchema),
      requireUploadedFile(file),
      getRequestMetadata(request),
    );
  }

  @Get("documents/:documentId")
  async get(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Req() request: RequestWithContext,
  ): Promise<DocumentDetail> {
    const session = this.currentUser.requireSession(request);

    return this.documents.get(session.userId, params.documentId);
  }

  @Patch("documents/:documentId/metadata")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async updateMetadata(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Body(new ZodValidationPipe(UpdateDocumentMetadataRequestSchema))
    body: UpdateDocumentMetadataRequest,
    @Req() request: RequestWithContext,
  ): Promise<Document> {
    const session = this.currentUser.requireSession(request);

    return this.documents.updateMetadata(
      session.userId,
      params.documentId,
      body,
      getRequestMetadata(request),
    );
  }

  @Patch("documents/:documentId/content")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async updateContent(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Body(new ZodValidationPipe(UpdateDocumentContentRequestSchema))
    body: UpdateDocumentContentRequest,
    @Req() request: RequestWithContext,
  ): Promise<Document> {
    const session = this.currentUser.requireSession(request);

    return this.documents.updateContent(
      session.userId,
      params.documentId,
      body,
      getRequestMetadata(request),
    );
  }

  @Post("documents/:documentId/content/append")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async appendContent(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Body(new ZodValidationPipe(AppendDocumentContentRequestSchema))
    body: AppendDocumentContentRequest,
    @Req() request: RequestWithContext,
  ): Promise<Document> {
    const session = this.currentUser.requireSession(request);

    return this.documents.appendContent(
      session.userId,
      params.documentId,
      body,
      getRequestMetadata(request),
    );
  }

  @Post("documents/:documentId/reimport")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  @UseInterceptors(
    DocumentImportUploadErrorInterceptor,
    FileInterceptor("file", documentImportMulterOptions),
  )
  async reimport(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Body(new ZodValidationPipe(ReimportDocumentRequestSchema))
    body: ReimportDocumentRequest,
    @UploadedFile() file: UploadedFileInput | undefined,
    @Req() request: RequestWithContext,
  ): Promise<Document> {
    const session = this.currentUser.requireSession(request);

    return this.documents.reimport(
      session.userId,
      params.documentId,
      body,
      requireUploadedFile(file),
      getRequestMetadata(request),
    );
  }

  @Post("documents/:documentId/archive")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async archive(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Req() request: RequestWithContext,
  ): Promise<Document> {
    const session = this.currentUser.requireSession(request);

    return this.documents.archive(
      session.userId,
      params.documentId,
      getRequestMetadata(request),
    );
  }

  @Post("documents/:documentId/restore")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async restore(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Req() request: RequestWithContext,
  ): Promise<Document> {
    const session = this.currentUser.requireSession(request);

    return this.documents.restore(
      session.userId,
      params.documentId,
      getRequestMetadata(request),
    );
  }

  @Delete("documents/:documentId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async delete(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Req() request: RequestWithContext,
  ): Promise<Record<string, never>> {
    const session = this.currentUser.requireSession(request);

    return this.documents.delete(
      session.userId,
      params.documentId,
      getRequestMetadata(request),
    );
  }

  @Get("documents/:documentId/revisions")
  async listRevisions(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Query(new ZodValidationPipe(PageQuerySchema))
    query: { page: number; pageSize: number },
    @Req() request: RequestWithContext,
  ) {
    const session = this.currentUser.requireSession(request);

    return this.documents.listRevisions(session.userId, params.documentId, query);
  }

  @Get("documents/:documentId/links")
  async listLinks(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Req() request: RequestWithContext,
  ): Promise<{ items: DocumentLink[] }> {
    const session = this.currentUser.requireSession(request);

    return this.documents.listLinks(session.userId, params.documentId);
  }

  @Patch("documents/:documentId/links")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async replaceLinks(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Body(new ZodValidationPipe(ReplaceDocumentLinksRequestSchema))
    body: ReplaceDocumentLinksRequest,
    @Req() request: RequestWithContext,
  ): Promise<{ items: DocumentLink[] }> {
    const session = this.currentUser.requireSession(request);

    return this.documents.replaceLinks(
      session.userId,
      params.documentId,
      body,
      getRequestMetadata(request),
    );
  }

  @Get("documents/:documentId/chunks")
  async listChunks(
    @Param(new ZodValidationPipe(DocumentIdPathParamsSchema))
    params: { documentId: string },
    @Query(new ZodValidationPipe(PageQuerySchema))
    query: { page: number; pageSize: number },
    @Req() request: RequestWithContext,
  ) {
    const session = this.currentUser.requireSession(request);

    return this.documents.listChunks(session.userId, params.documentId, query);
  }

  @Get("document-links")
  async listLinksByTarget(
    @Query(new ZodValidationPipe(DocumentLinksByTargetQuerySchema))
    query: DocumentLinksByTargetQuery,
    @Req() request: RequestWithContext,
  ) {
    const session = this.currentUser.requireSession(request);

    return this.documents.listLinksByTarget(session.userId, query);
  }
}

export function mapDocumentImportUploadException(error: unknown): unknown {
  if (isMulterDocumentFileLimitError(error)) {
    return new ApiException(
      "FILE_TOO_LARGE",
      "File is too large",
      HttpStatus.BAD_REQUEST,
    );
  }

  return error;
}

function requireUploadedFile(file: UploadedFileInput | undefined): UploadedDocumentFile {
  if (
    !file?.buffer ||
    !file.originalname ||
    !file.mimetype ||
    typeof file.size !== "number"
  ) {
    throw new ApiException(
      "VALIDATION_ERROR",
      "Document file is required",
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

function parseMultipartMetadata<T>(
  body: MultipartDocumentMetadata,
  schema: { parse(value: unknown): T },
): T {
  return schema.parse({
    title: body.title,
    tagIds: parseJsonField(body.tagIds),
    links: parseJsonField(body.links),
  });
}

function parseJsonField(value: string | undefined): unknown {
  if (value === undefined || value === "") {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new ApiException(
      "VALIDATION_ERROR",
      "Multipart JSON field is invalid",
      HttpStatus.BAD_REQUEST,
    );
  }
}

function isMulterDocumentFileLimitError(error: unknown): boolean {
  if (error instanceof PayloadTooLargeException) {
    return true;
  }
  if (!(error instanceof BadRequestException)) {
    return false;
  }

  const message = getHttpExceptionMessage(error);

  return (
    message === "Too many files" ||
    message === "Unexpected field - file" ||
    message === "File too large"
  );
}

function getHttpExceptionMessage(error: HttpException): string {
  const response = error.getResponse();

  if (typeof response === "string") {
    return response;
  }
  if (
    typeof response === "object" &&
    response !== null &&
    "message" in response
  ) {
    const message = response.message;

    if (typeof message === "string") {
      return message;
    }
    if (Array.isArray(message) && typeof message[0] === "string") {
      return message[0];
    }
  }

  return error.message;
}
