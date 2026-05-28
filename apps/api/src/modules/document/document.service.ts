import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type {
  AppendDocumentContentRequest,
  Document,
  DocumentActorType,
  DocumentDetail,
  DocumentLinkTarget,
  DocumentLinksByTargetQuery,
  DocumentListQuery,
  ImportDocxDocumentRequest,
  ImportMarkdownDocumentRequest,
  MoveDocumentsToFolderRequest,
  MoveDocumentToFolderRequest,
  PageResult,
  PasteDocumentRequest,
  ReimportDocumentRequest,
  ReplaceDocumentLinksRequest,
  SpaceRole,
  UpdateDocumentContentRequest,
  UpdateDocumentMetadataRequest,
} from "@project-delivery/shared";
import mammoth from "mammoth";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import { TargetResolverService } from "../target/target-resolver.service";
import {
  ATTACHMENT_OBJECT_STORAGE,
  type AttachmentObjectStorage,
} from "../attachment/storage/attachment-object-storage";
import {
  assertDocxImportFile,
  assertMarkdownImportFile,
  assertMarkdownSize,
  assertSafeDocxZip,
  buildDocumentChunks,
  normalizeDocumentLinks,
  normalizeMarkdownSource,
  stripBase64Images,
  type UploadedDocumentFile,
} from "./document-content";
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepository,
} from "./document.repository";
import { DocumentFolderService } from "./document-folder.service";

const DOCUMENT_WRITER_DENIED_ROLES = new Set<SpaceRole>(["VIEWER"]);
const DOCUMENT_MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);
export const DocumentDocxConversionTimeoutMs = 10_000;

type DocumentActorContext = {
  actorType: DocumentActorType;
  mcpClientId?: string;
};

type ConvertToMarkdown = (
  input: { buffer: Buffer },
  options?: {
    convertImage?: unknown;
    externalFileAccess?: boolean;
  },
) => Promise<{ value: string; messages: Array<{ type: string; message: string }> }>;

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepository,
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
    @Inject(TargetResolverService)
    private readonly targets: TargetResolverService,
    @Inject(AuditService)
    private readonly audit: AuditService,
    @Inject(RealtimePublisherService)
    private readonly realtime: RealtimePublisherService,
    @Inject(ATTACHMENT_OBJECT_STORAGE)
    private readonly objectStorage: AttachmentObjectStorage,
    @Inject(DocumentFolderService)
    private readonly folders: DocumentFolderService,
  ) {}

  async list(
    actorUserId: string,
    spaceId: string,
    input: DocumentListQuery,
  ): Promise<PageResult<Document>> {
    const access = await this.requireSpaceReader(actorUserId, spaceId);

    if (input.folderId) {
      await this.folders.requireFolderInSpace(input.folderId, {
        organizationId: access.space.organizationId,
        spaceId,
      });
    }

    return this.documents.list({
      ...input,
      organizationId: access.space.organizationId,
      spaceId,
    });
  }

  async get(actorUserId: string, documentId: string): Promise<DocumentDetail> {
    const document = await this.requireReadableDocument(actorUserId, documentId);
    const detail = await this.documents.findDetailById(document.id);

    if (!detail) {
      throwDocumentNotFound();
    }

    return detail;
  }

  async paste(
    actorUserId: string,
    spaceId: string,
    input: PasteDocumentRequest,
    metadata: RequestMetadata = {},
  ): Promise<Document> {
    const access = await this.requireSpaceCreator(actorUserId, spaceId);
    const documentId = ulid();
    const normalized = normalizeMarkdownSource({
      contentMarkdown: input.contentMarkdown,
      fallbackTitle: "Pasted document",
      title: input.title,
    });
    const links = await this.validateLinks(actorUserId, {
      links: normalizeDocumentLinks(input.links),
      organizationId: access.space.organizationId,
      spaceId,
    });
    await this.validateFolder(input.folderId, {
      organizationId: access.space.organizationId,
      spaceId,
    });
    const document = await this.documents.create({
      ...normalized,
      actorType: "USER",
      actorUserId,
      chunks: buildDocumentChunks(normalized.contentMarkdown),
      folderId: input.folderId,
      id: documentId,
      links,
      organizationId: access.space.organizationId,
      requestId: metadata.requestId,
      sourceType: input.sourceType,
      spaceId,
      tagIds: input.tagIds,
    });

    await this.recordAudit("CREATE", actorUserId, document, undefined, metadata);
    this.publishDocumentRealtime(actorUserId, document, "CREATED", [
      "document-list",
      "document-directory",
      "document-detail",
      "document-timeline",
      "resource-documents",
    ]);

    return document;
  }

  async createFromMarkdown(
    actorUserId: string,
    spaceId: string,
    input: Pick<
      PasteDocumentRequest,
      "contentMarkdown" | "folderId" | "links" | "tagIds" | "title"
    >,
    metadata: RequestMetadata = {},
    actor: DocumentActorContext = userDocumentActor(),
  ): Promise<Document> {
    const access = await this.requireSpaceCreator(actorUserId, spaceId);
    const documentId = ulid();
    const normalized = normalizeMarkdownSource({
      contentMarkdown: input.contentMarkdown,
      fallbackTitle: "Markdown document",
      title: input.title,
    });
    const links = await this.validateLinks(actorUserId, {
      links: normalizeDocumentLinks(input.links),
      organizationId: access.space.organizationId,
      spaceId,
    });
    await this.validateFolder(input.folderId, {
      organizationId: access.space.organizationId,
      spaceId,
    });
    const document = await this.documents.create({
      ...normalized,
      actorType: actor.actorType,
      actorUserId,
      chunks: buildDocumentChunks(normalized.contentMarkdown),
      folderId: input.folderId,
      id: documentId,
      links,
      mcpClientId: actor.mcpClientId,
      organizationId: access.space.organizationId,
      requestId: metadata.requestId,
      sourceType: actor.actorType === "MCP_CLIENT" ? "MCP_CREATED" : "PASTE_MARKDOWN",
      spaceId,
      tagIds: input.tagIds,
    });

    await this.recordAudit("CREATE", actorUserId, document, undefined, metadata);
    this.publishDocumentRealtime(actorUserId, document, "CREATED", [
      "document-list",
      "document-directory",
      "document-detail",
      "document-timeline",
      "resource-documents",
    ]);

    return document;
  }

  async importMarkdown(
    actorUserId: string,
    spaceId: string,
    input: ImportMarkdownDocumentRequest,
    file: UploadedDocumentFile,
    metadata: RequestMetadata = {},
  ): Promise<Document> {
    return this.createFromUploadedMarkdown(actorUserId, spaceId, input, file, metadata);
  }

  async importDocx(
    actorUserId: string,
    spaceId: string,
    input: ImportDocxDocumentRequest,
    file: UploadedDocumentFile,
    metadata: RequestMetadata = {},
  ): Promise<Document> {
    assertDocumentFile(() => assertDocxImportFile(file));
    const markdown = await this.convertDocxToMarkdown(file);

    return this.createFromUploadedMarkdown(
      actorUserId,
      spaceId,
      input,
      file,
      metadata,
      markdown,
      "UPLOAD_DOCX",
    );
  }

  async updateMetadata(
    actorUserId: string,
    documentId: string,
    input: UpdateDocumentMetadataRequest,
    metadata: RequestMetadata = {},
    actor: DocumentActorContext = userDocumentActor(),
  ): Promise<Document> {
    const existing = await this.requireEditableDocument(actorUserId, documentId);
    const links =
      input.links === undefined
        ? undefined
        : await this.validateLinks(actorUserId, {
            documentId,
            links: normalizeDocumentLinks(input.links),
            organizationId: existing.organizationId,
            spaceId: existing.spaceId,
          });
    const result = await this.documents.updateMetadata({
      actorType: actor.actorType,
      actorUserId,
      documentId,
      links,
      mcpClientId: actor.mcpClientId,
      requestId: metadata.requestId,
      baseRevision: input.baseRevision,
      tagIds: input.tagIds,
      title: input.title,
    });
    const updated = this.requireUpdatedResult(result);

    await this.recordAudit("UPDATE", actorUserId, updated, existing, metadata);
    this.publishDocumentRealtime(actorUserId, updated, "UPDATED", [
      "document-list",
      "document-detail",
      "document-timeline",
      "document-links",
      "resource-documents",
    ]);

    return updated;
  }

  async updateContent(
    actorUserId: string,
    documentId: string,
    input: UpdateDocumentContentRequest,
    metadata: RequestMetadata = {},
    actor: DocumentActorContext = userDocumentActor(),
  ): Promise<Document> {
    const existing = await this.requireEditableDocument(actorUserId, documentId);
    const normalized = normalizeMarkdownSource({
      contentMarkdown: input.contentMarkdown,
      fallbackTitle: existing.title,
      title: existing.title,
    });
    const result = await this.documents.updateContent({
      actorType: actor.actorType,
      actorUserId,
      baseRevision: input.baseRevision,
      changeType:
        actor.actorType === "MCP_CLIENT" ? "CONTENT_REPLACED" : "CONTENT_EDITED",
      chunks: buildDocumentChunks(normalized.contentMarkdown),
      contentMarkdown: normalized.contentMarkdown,
      contentText: normalized.contentText,
      documentId,
      mcpClientId: actor.mcpClientId,
      requestId: metadata.requestId,
    });
    const updated = this.requireUpdatedResult(result);

    await this.recordAudit("UPDATE", actorUserId, updated, existing, metadata);
    this.publishDocumentRealtime(actorUserId, updated, "UPDATED", [
      "document-list",
      "document-detail",
      "document-timeline",
    ]);

    return updated;
  }

  async appendContent(
    actorUserId: string,
    documentId: string,
    input: AppendDocumentContentRequest,
    metadata: RequestMetadata = {},
    actor: DocumentActorContext = userDocumentActor(),
  ): Promise<Document> {
    const existing = await this.requireEditableDocument(actorUserId, documentId);
    const contentMarkdown = `${existing.contentMarkdown.trimEnd()}\n\n${input.appendMarkdown.trim()}`;
    assertDocumentFile(() => assertMarkdownSize(contentMarkdown));
    const normalized = normalizeMarkdownSource({
      contentMarkdown,
      fallbackTitle: existing.title,
      title: existing.title,
    });
    const result = await this.documents.updateContent({
      actorType: actor.actorType,
      actorUserId,
      baseRevision: input.baseRevision,
      changeType: "CONTENT_APPENDED",
      chunks: buildDocumentChunks(normalized.contentMarkdown),
      contentMarkdown: normalized.contentMarkdown,
      contentText: normalized.contentText,
      documentId,
      mcpClientId: actor.mcpClientId,
      requestId: metadata.requestId,
    });
    const updated = this.requireUpdatedResult(result);

    await this.recordAudit("UPDATE", actorUserId, updated, existing, metadata);
    this.publishDocumentRealtime(actorUserId, updated, "UPDATED", [
      "document-list",
      "document-detail",
      "document-timeline",
    ]);

    return updated;
  }

  async reimport(
    actorUserId: string,
    documentId: string,
    input: ReimportDocumentRequest,
    file: UploadedDocumentFile,
    metadata: RequestMetadata = {},
  ): Promise<Document> {
    const existing = await this.requireEditableDocument(actorUserId, documentId);
    const markdown = file.fileName.toLowerCase().endsWith(".docx")
      ? await this.convertDocxToMarkdown(assertAndReturn(file, assertDocxImportFile))
      : readMarkdownFile(assertAndReturn(file, assertMarkdownImportFile));
    const normalized = normalizeMarkdownSource({
      contentMarkdown: markdown,
      fallbackTitle: existing.title,
      title: existing.title,
    });
    const fileKey = createSourceFileKey(documentId, file.fileName);

    await this.objectStorage.putObject({
      body: file.buffer,
      key: fileKey,
      mimeType: file.mimeType,
      size: file.size,
    });

    try {
      const result = await this.documents.updateContent({
        actorType: "USER",
        actorUserId,
        baseRevision: input.baseRevision,
        changeType: "REIMPORTED",
        chunks: buildDocumentChunks(normalized.contentMarkdown),
        contentMarkdown: normalized.contentMarkdown,
        contentText: normalized.contentText,
        documentId,
        requestId: metadata.requestId,
        sourceAttachment: {
          fileKey,
          fileName: file.fileName,
          mimeType: file.mimeType,
          size: file.size,
        },
      });
      const updated = this.requireUpdatedResult(result);

      await this.recordAudit("UPDATE", actorUserId, updated, existing, metadata);
      this.publishDocumentRealtime(actorUserId, updated, "UPDATED", [
        "document-list",
        "document-detail",
        "document-timeline",
        "document-attachments",
      ]);

      return updated;
    } catch (error) {
      await this.deleteUploadedObject(fileKey);
      throw error;
    }
  }

  async archive(
    actorUserId: string,
    documentId: string,
    metadata: RequestMetadata = {},
  ): Promise<Document> {
    return this.updateState(actorUserId, documentId, "ARCHIVED", metadata);
  }

  async restore(
    actorUserId: string,
    documentId: string,
    metadata: RequestMetadata = {},
  ): Promise<Document> {
    return this.updateState(actorUserId, documentId, "RESTORED", metadata);
  }

  async delete(
    actorUserId: string,
    documentId: string,
    metadata: RequestMetadata = {},
  ): Promise<Record<string, never>> {
    await this.updateState(actorUserId, documentId, "DELETED", metadata);

    return {};
  }

  async listRevisions(
    actorUserId: string,
    documentId: string,
    input: { page: number; pageSize: number },
  ) {
    await this.requireReadableDocument(actorUserId, documentId);

    return this.documents.listRevisions({ documentId, ...input });
  }

  async listLinks(actorUserId: string, documentId: string) {
    await this.requireReadableDocument(actorUserId, documentId);

    return { items: await this.documents.listLinks(documentId) };
  }

  async replaceLinks(
    actorUserId: string,
    documentId: string,
    input: ReplaceDocumentLinksRequest,
    metadata: RequestMetadata = {},
    actor: DocumentActorContext = userDocumentActor(),
  ) {
    const existing = await this.requireEditableDocument(actorUserId, documentId);
    const links = await this.validateLinks(actorUserId, {
      documentId,
      links: normalizeDocumentLinks(input.links),
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
    });
    const result = await this.documents.replaceLinks({
      actorType: actor.actorType,
      actorUserId,
      baseRevision: input.baseRevision,
      documentId,
      links,
      mcpClientId: actor.mcpClientId,
      requestId: metadata.requestId,
    });
    const updated = this.requireUpdatedResult(result);

    await this.recordAudit("UPDATE", actorUserId, updated, existing, metadata);
    this.publishDocumentRealtime(actorUserId, updated, "UPDATED", [
      "document-list",
      "document-detail",
      "document-links",
      "document-timeline",
      "resource-documents",
    ]);

    return { items: await this.documents.listLinks(updated.id) };
  }

  async listChunks(
    actorUserId: string,
    documentId: string,
    input: { page: number; pageSize: number },
  ) {
    await this.requireReadableDocument(actorUserId, documentId);

    return this.documents.listChunks({ documentId, ...input });
  }

  async moveToFolder(
    actorUserId: string,
    documentId: string,
    input: MoveDocumentToFolderRequest,
    metadata: RequestMetadata = {},
    actor: DocumentActorContext = userDocumentActor(),
  ): Promise<Document> {
    const existing = await this.requireEditableDocument(actorUserId, documentId);

    await this.validateFolder(input.folderId ?? undefined, {
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
    });

    const result = await this.documents.moveToFolder({
      actorType: actor.actorType,
      actorUserId,
      baseRevision: input.baseRevision,
      documentId,
      folderId: input.folderId ?? undefined,
      mcpClientId: actor.mcpClientId,
      requestId: metadata.requestId,
    });
    const updated = this.requireUpdatedResult(result);

    await this.recordAudit("UPDATE", actorUserId, updated, existing, metadata);
    this.publishDocumentRealtime(actorUserId, updated, "UPDATED", [
      "document-directory",
      "document-list",
      "document-detail",
      "document-timeline",
    ]);

    return updated;
  }

  async moveManyToFolder(
    actorUserId: string,
    spaceId: string,
    input: MoveDocumentsToFolderRequest,
    metadata: RequestMetadata = {},
    actor: DocumentActorContext = userDocumentActor(),
  ): Promise<{ items: Document[] }> {
    const access = await this.requireSpaceReader(actorUserId, spaceId);

    await this.validateFolder(input.folderId ?? undefined, {
      organizationId: access.space.organizationId,
      spaceId,
    });

    const existingDocuments = await Promise.all(
      input.documentIds.map((documentId) =>
        this.requireEditableDocument(actorUserId, documentId),
      ),
    );

    for (const document of existingDocuments) {
      if (
        document.organizationId !== access.space.organizationId ||
        document.spaceId !== spaceId
      ) {
        throwDocumentNotFound();
      }
    }

    const result = await this.documents.moveManyToFolder({
      actorType: actor.actorType,
      actorUserId,
      documentIds: input.documentIds,
      folderId: input.folderId ?? undefined,
      mcpClientId: actor.mcpClientId,
      organizationId: access.space.organizationId,
      requestId: metadata.requestId,
      spaceId,
    });
    const updated = this.requireBatchUpdatedResult(result);
    const existingById = new Map(
      existingDocuments.map((document) => [document.id, document]),
    );

    await Promise.all(
      updated.documents.map((document) =>
        this.recordAudit(
          "UPDATE",
          actorUserId,
          document,
          existingById.get(document.id),
          metadata,
        ),
      ),
    );
    this.publishDocumentBatchRealtime(actorUserId, {
      documentCount: updated.documents.length,
      organizationId: access.space.organizationId,
      spaceId,
    });

    return { items: updated.documents };
  }

  async listLinksByTarget(actorUserId: string, input: DocumentLinksByTargetQuery) {
    const target = await this.targets.resolve(
      actorUserId,
      input.targetType,
      input.targetId,
      {
        hideInaccessible: true,
        notFoundCode: "DOCUMENT_LINK_TARGET_INVALID",
      },
    );

    return this.documents.listLinksByTarget({
      organizationId: target.organizationId,
      page: input.page,
      pageSize: input.pageSize,
      spaceId: target.spaceId,
      targetId: target.targetId,
      targetType: input.targetType,
    });
  }

  private async createFromUploadedMarkdown(
    actorUserId: string,
    spaceId: string,
    input: ImportMarkdownDocumentRequest,
    file: UploadedDocumentFile,
    metadata: RequestMetadata,
    providedMarkdown?: string,
    sourceType: "UPLOAD_MARKDOWN" | "UPLOAD_DOCX" = "UPLOAD_MARKDOWN",
  ): Promise<Document> {
    assertDocumentFile(() =>
      sourceType === "UPLOAD_DOCX"
        ? assertDocxImportFile(file)
        : assertMarkdownImportFile(file),
    );
    const access = await this.requireSpaceCreator(actorUserId, spaceId);
    const documentId = ulid();
    const markdown = providedMarkdown ?? readMarkdownFile(file);
    const normalized = normalizeMarkdownSource({
      contentMarkdown: markdown,
      fallbackTitle: titleFromFileName(file.fileName),
      title: input.title,
    });
    const links = await this.validateLinks(actorUserId, {
      links: normalizeDocumentLinks(input.links),
      organizationId: access.space.organizationId,
      spaceId,
    });
    await this.validateFolder(input.folderId, {
      organizationId: access.space.organizationId,
      spaceId,
    });
    const fileKey = createSourceFileKey(documentId, file.fileName);

    await this.objectStorage.putObject({
      body: file.buffer,
      key: fileKey,
      mimeType: file.mimeType,
      size: file.size,
    });

    try {
      const document = await this.documents.create({
        ...normalized,
        actorType: "USER",
        actorUserId,
        chunks: buildDocumentChunks(normalized.contentMarkdown),
        folderId: input.folderId,
        id: documentId,
        links,
        organizationId: access.space.organizationId,
        requestId: metadata.requestId,
        sourceAttachment: {
          fileKey,
          fileName: file.fileName,
          mimeType: file.mimeType,
          size: file.size,
        },
        sourceType,
        spaceId,
        tagIds: input.tagIds,
      });

      await this.recordAudit("CREATE", actorUserId, document, undefined, metadata);
      this.publishDocumentRealtime(actorUserId, document, "CREATED", [
        "document-list",
        "document-directory",
        "document-detail",
        "document-timeline",
        "document-attachments",
        "resource-documents",
      ]);

      return document;
    } catch (error) {
      await this.deleteUploadedObject(fileKey);
      throw error;
    }
  }

  private async convertDocxToMarkdown(file: UploadedDocumentFile): Promise<string> {
    assertDocumentFile(() => assertDocxImportFile(file));
    try {
      assertSafeDocxZip(file);
      const convertToMarkdown = (
        mammoth as unknown as { convertToMarkdown: ConvertToMarkdown }
      ).convertToMarkdown;
      const result = await withTimeout(
        convertToMarkdown(
          { buffer: file.buffer },
          {
            convertImage: mammoth.images.imgElement(async () => ({
              src: "image omitted",
            })),
            externalFileAccess: false,
          },
        ),
        DocumentDocxConversionTimeoutMs,
        "DOCX conversion timed out",
      );

      if (result.messages.some((message) => message.type === "error")) {
        throw new Error(result.messages.map((message) => message.message).join("; "));
      }

      const markdown = stripBase64Images(result.value).trim();
      assertMarkdownSize(markdown);

      if (!markdown) {
        throw new Error("DOCX conversion produced empty markdown");
      }

      return markdown;
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      if (isCodedError(error, "FILE_TOO_LARGE")) {
        throw new ApiException("FILE_TOO_LARGE", "File is too large", HttpStatus.BAD_REQUEST);
      }
      throw new ApiException(
        "DOCUMENT_IMPORT_FAILED",
        "DOCX import failed",
        HttpStatus.BAD_REQUEST,
        error instanceof Error ? { reason: error.message } : undefined,
      );
    }
  }

  private async requireReadableDocument(
    actorUserId: string,
    documentId: string,
  ): Promise<Document> {
    const document = await this.documents.findById(documentId);

    if (!document) {
      throwDocumentNotFound();
    }
    await this.requireSpaceReader(actorUserId, document.spaceId);

    return document;
  }

  private async requireEditableDocument(
    actorUserId: string,
    documentId: string,
  ): Promise<Document> {
    const document = await this.requireReadableDocument(actorUserId, documentId);
    const access = await this.requireSpaceReader(actorUserId, document.spaceId);

    if (
      DOCUMENT_WRITER_DENIED_ROLES.has(access.role) ||
      (!DOCUMENT_MANAGER_ROLES.has(access.role) && document.createdById !== actorUserId)
    ) {
      throwSpaceAccessDenied();
    }

    return document;
  }

  private async requireSpaceReader(actorUserId: string, spaceId: string) {
    const access = await this.spaces.findAccessibleById(actorUserId, spaceId);

    if (!access) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireSpaceCreator(actorUserId: string, spaceId: string) {
    const access = await this.requireSpaceReader(actorUserId, spaceId);

    if (DOCUMENT_WRITER_DENIED_ROLES.has(access.role)) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async validateLinks(
    actorUserId: string,
    input: {
      documentId?: string;
      links: DocumentLinkTarget[];
      organizationId: string;
      spaceId: string;
    },
  ): Promise<DocumentLinkTarget[]> {
    for (const link of input.links) {
      if (link.targetType === "DOCUMENT" && link.targetId === input.documentId) {
        throwDocumentLinkTargetInvalid();
      }

      const target = await this.targets.resolve(
        actorUserId,
        link.targetType,
        link.targetId,
        {
          hideInaccessible: true,
          notFoundCode: "DOCUMENT_LINK_TARGET_INVALID",
        },
      );

      if (
        target.organizationId !== input.organizationId ||
        target.spaceId !== input.spaceId
      ) {
        throwDocumentLinkTargetInvalid();
      }
    }

    return input.links;
  }

  private async validateFolder(
    folderId: string | undefined,
    input: { organizationId: string; spaceId: string },
  ) {
    if (!folderId) {
      return;
    }

    await this.folders.requireFolderInSpace(folderId, input);
  }

  private requireUpdatedResult(
    result: Awaited<ReturnType<DocumentRepository["updateContent"]>>,
  ): Document {
    if (result.status === "not_found") {
      throwDocumentNotFound();
    }
    if (result.status === "conflict") {
      throw new ApiException(
        "DOCUMENT_EDIT_CONFLICT",
        "Document revision conflict",
        HttpStatus.CONFLICT,
      );
    }

    return result.document;
  }

  private requireBatchUpdatedResult(
    result: Awaited<ReturnType<DocumentRepository["moveManyToFolder"]>>,
  ) {
    if (result.status === "not_found") {
      throwDocumentNotFound();
    }

    return result;
  }

  private async updateState(
    actorUserId: string,
    documentId: string,
    changeType: "ARCHIVED" | "RESTORED" | "DELETED",
    metadata: RequestMetadata,
  ): Promise<Document> {
    const existing = await this.requireEditableDocument(actorUserId, documentId);
    const result = await this.documents.updateState({
      actorType: "USER",
      actorUserId,
      changeType,
      documentId,
      requestId: metadata.requestId,
    });
    const updated = this.requireUpdatedResult(result);

    await this.recordAudit(
      changeType === "DELETED" ? "DELETE" : "UPDATE",
      actorUserId,
      updated,
      existing,
      metadata,
    );
    this.publishDocumentRealtime(
      actorUserId,
      updated,
      changeType === "DELETED" ? "DELETED" : "STATUS_CHANGED",
      [
        "document-directory",
        "document-list",
        "document-detail",
        "document-timeline",
      ],
    );

    return updated;
  }

  private async recordAudit(
    actionType: "CREATE" | "UPDATE" | "DELETE",
    actorUserId: string,
    after: Document,
    before: Document | undefined,
    metadata: RequestMetadata,
  ) {
    await this.audit.record({
      actionType,
      actorId: actorUserId,
      after,
      before,
      ...metadata,
      organizationId: after.organizationId,
      spaceId: after.spaceId,
      targetId: after.id,
      targetType: "DOCUMENT",
    });
  }

  private publishDocumentRealtime(
    actorUserId: string,
    document: Pick<Document, "id" | "organizationId" | "spaceId" | "revision">,
    operation: Parameters<RealtimePublisherService["publish"]>[0]["operation"],
    invalidates: Parameters<RealtimePublisherService["publish"]>[0]["invalidates"],
  ) {
    try {
      this.realtime.publish({
        actorId: actorUserId,
        organizationId: document.organizationId,
        spaceId: document.spaceId,
        target: { type: "DOCUMENT", id: document.id },
        operation,
        invalidates,
        hints: {
          targetType: "DOCUMENT",
          targetId: document.id,
          documentId: document.id,
          revision: document.revision,
          spaceId: document.spaceId,
        },
      });
    } catch (error) {
      this.logger.error(
        "Failed to publish document realtime event",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private publishDocumentBatchRealtime(
    actorUserId: string,
    input: {
      documentCount: number;
      organizationId: string;
      spaceId: string;
    },
  ) {
    try {
      this.realtime.publish({
        actorId: actorUserId,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        target: { type: "SPACE", id: input.spaceId },
        operation: "UPDATED",
        invalidates: [
          "document-directory",
          "document-list",
          "document-detail",
          "document-timeline",
        ],
        hints: {
          targetType: "SPACE",
          targetId: input.spaceId,
          spaceId: input.spaceId,
          changedFields: ["folderId"],
          documentCount: input.documentCount,
          suggestFullRefresh: true,
        },
      });
    } catch (error) {
      this.logger.error(
        "Failed to publish document batch realtime event",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async deleteUploadedObject(fileKey: string) {
    try {
      await this.objectStorage.deleteObjectIfExists(fileKey);
    } catch (error) {
      this.logger.warn(
        `Failed to delete unregistered document source object ${fileKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function readMarkdownFile(file: UploadedDocumentFile): string {
  const markdown = file.buffer.toString("utf8");
  assertDocumentFile(() => assertMarkdownSize(markdown));

  return markdown;
}

function userDocumentActor(): DocumentActorContext {
  return {
    actorType: "USER",
  };
}

function assertAndReturn(
  file: UploadedDocumentFile,
  assertion: (file: UploadedDocumentFile) => void,
): UploadedDocumentFile {
  assertDocumentFile(() => assertion(file));

  return file;
}

function assertDocumentFile(assertion: () => void): void {
  try {
    assertion();
  } catch (error) {
    if (error instanceof ApiException) {
      throw error;
    }
    if (isCodedError(error, "FILE_TOO_LARGE")) {
      throw new ApiException("FILE_TOO_LARGE", "File is too large", HttpStatus.BAD_REQUEST);
    }
    if (isCodedError(error, "DOCUMENT_IMPORT_UNSUPPORTED_TYPE")) {
      throw new ApiException(
        "DOCUMENT_IMPORT_UNSUPPORTED_TYPE",
        "Unsupported document file type",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (isCodedError(error, "DOCUMENT_IMPORT_FAILED")) {
      throw new ApiException(
        "DOCUMENT_IMPORT_FAILED",
        "DOCX import failed",
        HttpStatus.BAD_REQUEST,
        error instanceof Error ? { reason: error.message } : undefined,
      );
    }
    throw error;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    timeoutId.unref?.();
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function isCodedError(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function createSourceFileKey(documentId: string, fileName: string) {
  return `attachments/document/${documentId}/${ulid()}-${sanitizeFileName(fileName)}`;
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^\w.\-() ]+/gu, "_").slice(0, 200) || "document";
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/u, "").trim() || "Imported document";
}

function throwDocumentNotFound(): never {
  throw new ApiException(
    "DOCUMENT_NOT_FOUND",
    "Document not found",
    HttpStatus.NOT_FOUND,
  );
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}

function throwDocumentLinkTargetInvalid(): never {
  throw new ApiException(
    "DOCUMENT_LINK_TARGET_INVALID",
    "Document link target is invalid",
    HttpStatus.BAD_REQUEST,
  );
}
