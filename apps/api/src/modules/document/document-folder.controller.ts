import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CreateDocumentFolderRequestSchema,
  MoveDocumentFolderRequestSchema,
  ReorderDocumentFolderRequestSchema,
  ReorderDocumentFoldersRequestSchema,
  SpaceIdPathParamsSchema,
  UpdateDocumentFolderRequestSchema,
  type CreateDocumentFolderRequest,
  type DocumentFolder,
  type DocumentFolderTreeNode,
  type MoveDocumentFolderRequest,
  type ReorderDocumentFolderRequest,
  type ReorderDocumentFoldersRequest,
  type UpdateDocumentFolderRequest,
} from "@project-delivery/shared";
import { z } from "zod";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { getRequestMetadata } from "../auth/request-metadata";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { DocumentFolderService } from "./document-folder.service";

const DocumentFolderIdPathParamsSchema = z
  .object({
    folderId: SpaceIdPathParamsSchema.shape.spaceId,
  })
  .strict();

@Controller()
@UseGuards(RequireSessionGuard)
export class DocumentFolderController {
  constructor(
    @Inject(DocumentFolderService)
    private readonly folders: DocumentFolderService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("spaces/:spaceId/document-folders")
  async list(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Req() request: RequestWithContext,
  ): Promise<{ items: DocumentFolderTreeNode[] }> {
    const session = this.currentUser.requireSession(request);

    return this.folders.list(session.userId, params.spaceId);
  }

  @Post("spaces/:spaceId/document-folders")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async create(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(CreateDocumentFolderRequestSchema))
    body: CreateDocumentFolderRequest,
    @Req() request: RequestWithContext,
  ): Promise<DocumentFolder> {
    const session = this.currentUser.requireSession(request);

    return this.folders.create(
      session.userId,
      params.spaceId,
      body,
      getRequestMetadata(request),
    );
  }

  @Post("spaces/:spaceId/document-folders/reorder")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async reorderMany(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(ReorderDocumentFoldersRequestSchema))
    body: ReorderDocumentFoldersRequest,
    @Req() request: RequestWithContext,
  ): Promise<{ items: DocumentFolderTreeNode[] }> {
    const session = this.currentUser.requireSession(request);

    return this.folders.reorderMany(
      session.userId,
      params.spaceId,
      body,
      getRequestMetadata(request),
    );
  }

  @Patch("document-folders/:folderId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async update(
    @Param(new ZodValidationPipe(DocumentFolderIdPathParamsSchema))
    params: { folderId: string },
    @Body(new ZodValidationPipe(UpdateDocumentFolderRequestSchema))
    body: UpdateDocumentFolderRequest,
    @Req() request: RequestWithContext,
  ): Promise<DocumentFolder> {
    const session = this.currentUser.requireSession(request);

    return this.folders.update(
      session.userId,
      params.folderId,
      body,
      getRequestMetadata(request),
    );
  }

  @Post("document-folders/:folderId/move")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async move(
    @Param(new ZodValidationPipe(DocumentFolderIdPathParamsSchema))
    params: { folderId: string },
    @Body(new ZodValidationPipe(MoveDocumentFolderRequestSchema))
    body: MoveDocumentFolderRequest,
    @Req() request: RequestWithContext,
  ): Promise<DocumentFolder> {
    const session = this.currentUser.requireSession(request);

    return this.folders.move(
      session.userId,
      params.folderId,
      body,
      getRequestMetadata(request),
    );
  }

  @Post("document-folders/:folderId/reorder")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async reorder(
    @Param(new ZodValidationPipe(DocumentFolderIdPathParamsSchema))
    params: { folderId: string },
    @Body(new ZodValidationPipe(ReorderDocumentFolderRequestSchema))
    body: ReorderDocumentFolderRequest,
    @Req() request: RequestWithContext,
  ): Promise<DocumentFolder> {
    const session = this.currentUser.requireSession(request);

    return this.folders.reorder(
      session.userId,
      params.folderId,
      body,
      getRequestMetadata(request),
    );
  }

  @Delete("document-folders/:folderId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async delete(
    @Param(new ZodValidationPipe(DocumentFolderIdPathParamsSchema))
    params: { folderId: string },
    @Req() request: RequestWithContext,
  ): Promise<Record<string, never>> {
    const session = this.currentUser.requireSession(request);

    return this.folders.delete(
      session.userId,
      params.folderId,
      getRequestMetadata(request),
    );
  }
}
