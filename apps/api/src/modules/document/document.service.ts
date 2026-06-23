import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type {
  AttachmentMimeType,
  AppendDocumentContentRequest,
  CancelRequirementPreflightResponse,
  CancelRequirementRequest,
  ConvertDocumentToRequirementRequest,
  Document,
  DocumentActorType,
  DocumentDetail,
  DocumentListItem,
  DocumentLinkTarget,
  DocumentLinksByTargetQuery,
  DocumentListQuery,
  McpDocumentSearchHit,
  McpDocumentSearchResponse,
  ImportDocxDocumentRequest,
  ImportHtmlDocumentRequest,
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
import {
  AttachmentMaxSizeBytes,
  AttachmentMimeTypeSchema,
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
  withDocumentRecentActivityInvalidates,
  withRecentActivityInvalidates,
} from "../target/legacy-target-normalizer";
import {
  ATTACHMENT_OBJECT_STORAGE,
  type AttachmentObjectStorage,
} from "../attachment/storage/attachment-object-storage";
import {
  assertDocxImportFile,
  assertHtmlImportFile,
  assertMarkdownImportFile,
  assertMarkdownSize,
  assertSafeDocxZip,
  buildDocumentChunks,
  buildDocumentChunksFromText,
  normalizeDocumentLinks,
  normalizeMarkdownSource,
  normalizeTiptapSource,
  readDocxUtf8Entry,
  readHtmlZipEntryData,
  readSafeHtmlZipEntries,
  selectHtmlZipEntry,
  stripBase64Images,
  type HtmlZipEntry,
  type UploadedDocumentFile,
} from "./document-content";
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepository,
} from "./document.repository";
import { DocumentFolderService } from "./document-folder.service";
import { DocumentKindTransitionService } from "./document-kind-transition.service";

const DOCUMENT_WRITER_DENIED_ROLES = new Set<SpaceRole>(["VIEWER"]);
const DOCUMENT_MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);
const REQUIREMENT_WRITER_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
]);
const REQUIREMENT_TARGET_TYPE = "REQUIREMENT" as unknown as Parameters<
  TargetResolverService["resolve"]
>[1];
const MCP_DOCUMENT_SEARCH_MAX_HITS_PER_DOCUMENT = 3;
const MCP_DOCUMENT_SEARCH_SNIPPET_MAX_LENGTH = 320;
export const DocumentDocxConversionTimeoutMs = 10_000;
const documentAttachmentDownloadPathPrefix = "/api/v1/attachments";
const markdownEscapableCharacters = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "-",
  ".",
  "!",
  "|",
  ">",
]);
const supportedDocxImageExtensions = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
} satisfies Partial<Record<AttachmentMimeType, string>>;
const supportedHtmlImageMimeTypesByExtension = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
} satisfies Record<string, keyof typeof supportedDocxImageExtensions>;
const htmlSourceAttachmentMimeType = "text/plain";

type DocumentActorContext = {
  actorType: DocumentActorType;
  mcpClientId?: string;
};

type ConvertToHtml = (
  input: { buffer: Buffer },
  options?: {
    convertImage?: unknown;
    externalFileAccess?: boolean;
  },
) => Promise<{
  value: string;
  messages: Array<{ type: string; message: string }>;
}>;

type MammothImage = {
  contentType?: string;
  read?: () => Promise<Buffer | string>;
  readAsBuffer?: () => Promise<Buffer>;
};

type ConvertedDocxMarkdown = {
  inlineAttachments: Array<{
    fileKey: string;
    fileName: string;
    id: string;
    mimeType: string;
    size: number;
  }>;
  markdown: string;
  title?: string;
  uploadedObjectKeys: string[];
};
type ConvertedHtmlMarkdown = ConvertedDocxMarkdown;

type HtmlImportResourcePackage = {
  entriesByPath: Map<string, HtmlZipEntry>;
  file: UploadedDocumentFile;
  htmlEntryPath: string;
};

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
    @Inject(DocumentKindTransitionService)
    private readonly kindTransitions: DocumentKindTransitionService,
  ) {}

  async list(
    actorUserId: string,
    spaceId: string,
    input: DocumentListQuery,
  ): Promise<PageResult<DocumentListItem>> {
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

  async searchForMcp(
    actorUserId: string,
    spaceId: string,
    input: DocumentListQuery,
  ): Promise<McpDocumentSearchResponse> {
    const query = normalizeSearchText(input.query ?? "");
    const listInput = { ...input };

    if (query) {
      listInput.query = query;
    } else {
      delete listInput.query;
    }

    const listResult = await this.list(actorUserId, spaceId, listInput);
    const items = listResult.items.map((document) => ({
      ...document,
      hits: [] as McpDocumentSearchHit[],
    }));
    const firstItem = items[0];

    if (!query || !firstItem) {
      return {
        ...listResult,
        items,
      };
    }

    const chunks = await this.documents.searchCurrentRevisionChunks({
      documents: items.map((document) => ({
        documentId: document.id,
        revision: document.revision,
      })),
      maxHitsPerDocument: MCP_DOCUMENT_SEARCH_MAX_HITS_PER_DOCUMENT,
      organizationId: firstItem.organizationId,
      query,
      spaceId,
    });
    const hitsByDocumentId = new Map<string, McpDocumentSearchHit[]>();

    for (const chunk of chunks) {
      const current = hitsByDocumentId.get(chunk.documentId) ?? [];

      if (current.length >= MCP_DOCUMENT_SEARCH_MAX_HITS_PER_DOCUMENT) {
        continue;
      }

      current.push({
        chunkId: chunk.id,
        ordinal: chunk.ordinal,
        ...(chunk.headingPath ? { headingPath: chunk.headingPath } : {}),
        snippet: buildSearchSnippet(chunk.contentText, query),
      });
      hitsByDocumentId.set(chunk.documentId, current);
    }

    return {
      ...listResult,
      items: items.map((document) => ({
        ...document,
        hits: hitsByDocumentId.get(document.id) ?? [],
      })),
    };
  }

  async get(actorUserId: string, documentId: string): Promise<DocumentDetail> {
    const document = await this.requireReadableDocument(
      actorUserId,
      documentId,
    );
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

    await this.recordAudit(
      "CREATE",
      actorUserId,
      document,
      undefined,
      metadata,
    );
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
      sourceType:
        actor.actorType === "MCP_CLIENT" ? "MCP_CREATED" : "PASTE_MARKDOWN",
      spaceId,
      tagIds: input.tagIds,
    });

    await this.recordAudit(
      "CREATE",
      actorUserId,
      document,
      undefined,
      metadata,
    );
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
    return this.createFromUploadedMarkdown(
      actorUserId,
      spaceId,
      input,
      file,
      metadata,
    );
  }

  async importDocx(
    actorUserId: string,
    spaceId: string,
    input: ImportDocxDocumentRequest,
    file: UploadedDocumentFile,
    metadata: RequestMetadata = {},
  ): Promise<Document> {
    assertDocumentFile(() => assertDocxImportFile(file));
    await this.requireSpaceCreator(actorUserId, spaceId);
    const documentId = ulid();
    const converted = await this.convertDocxToMarkdown(file, documentId);

    return this.createFromUploadedMarkdown(
      actorUserId,
      spaceId,
      input,
      file,
      metadata,
      converted.markdown,
      "UPLOAD_DOCX",
      {
        documentId,
        extractedTitle: converted.title,
        inlineAttachments: converted.inlineAttachments,
        uploadedObjectKeys: converted.uploadedObjectKeys,
      },
    );
  }

  async importHtml(
    actorUserId: string,
    spaceId: string,
    input: ImportHtmlDocumentRequest,
    file: UploadedDocumentFile,
    metadata: RequestMetadata = {},
  ): Promise<Document> {
    assertDocumentFile(() => assertHtmlImportFile(file));
    await this.requireSpaceCreator(actorUserId, spaceId);
    const documentId = ulid();
    const converted = await this.convertHtmlToMarkdown(file, documentId);

    return this.createFromUploadedMarkdown(
      actorUserId,
      spaceId,
      input,
      file,
      metadata,
      converted.markdown,
      "UPLOAD_HTML",
      {
        documentId,
        extractedTitle: converted.title,
        inlineAttachments: converted.inlineAttachments,
        sourceMimeType: getHtmlSourceAttachmentMimeType(file),
        uploadedObjectKeys: converted.uploadedObjectKeys,
      },
    );
  }

  async updateMetadata(
    actorUserId: string,
    documentId: string,
    input: UpdateDocumentMetadataRequest,
    metadata: RequestMetadata = {},
    actor: DocumentActorContext = userDocumentActor(),
  ): Promise<Document> {
    const existing = await this.requireEditableDocument(
      actorUserId,
      documentId,
    );
    if (existing.kind === "REQUIREMENT" && input.title !== undefined) {
      throwRequirementDocumentContentBypass();
    }
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
    const existing = await this.requireEditableDocument(
      actorUserId,
      documentId,
    );
    this.assertGeneralDocumentContentEditable(existing);
    const contentFormat = input.contentFormat ?? "MARKDOWN";
    if (contentFormat !== existing.contentFormat) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Document content format cannot be changed by content update",
        HttpStatus.BAD_REQUEST,
      );
    }
    const contentUpdate =
      input.contentFormat === "TIPTAP_JSON"
        ? buildTiptapContentUpdate(input)
        : buildMarkdownContentUpdate(input, existing.title);
    const result = await this.documents.updateContent({
      actorType: actor.actorType,
      actorUserId,
      baseRevision: input.baseRevision,
      changeType:
        actor.actorType === "MCP_CLIENT"
          ? "CONTENT_REPLACED"
          : "CONTENT_EDITED",
      chunks: contentUpdate.chunks,
      contentFormat,
      contentJson: contentUpdate.contentJson,
      contentMarkdown: contentUpdate.contentMarkdown,
      contentMarkdownCache: contentUpdate.contentMarkdownCache,
      contentText: contentUpdate.contentText,
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

  async convertToRequirement(
    actorUserId: string,
    documentId: string,
    input: ConvertDocumentToRequirementRequest,
    metadata: RequestMetadata = {},
  ): Promise<Document> {
    const existing = await this.requireEditableDocument(
      actorUserId,
      documentId,
    );

    if (existing.kind !== "GENERAL") {
      throwInvalidDocumentKind("Only general documents can be converted");
    }

    await this.requireRequirementWriter(actorUserId, existing.spaceId);
    await this.validateRequirementVersion(
      actorUserId,
      existing,
      input.versionId,
    );
    await this.validateRequirementOwner(existing, input.ownerId);

    const result = await this.kindTransitions.convertToRequirement({
      activate: input.activate,
      actorType: "USER",
      actorUserId,
      baseRevision: input.baseRevision,
      documentId,
      ownerId: input.ownerId,
      priority: input.priority,
      requestId: metadata.requestId,
      summary: input.summary,
      title: input.title,
      versionId: input.versionId,
    });
    const updated = this.requireConvertToRequirementResult(result);

    await this.recordAudit("UPDATE", actorUserId, updated, existing, metadata);
    this.publishDocumentRealtime(actorUserId, updated, "UPDATED", [
      "document-list",
      "document-detail",
      "document-timeline",
      "resource-documents",
      "requirement-list",
      "requirement-detail",
      "version-board",
    ]);

    return updated;
  }

  async cancelRequirementPreflight(
    actorUserId: string,
    documentId: string,
  ): Promise<CancelRequirementPreflightResponse> {
    const existing = await this.requireReadableDocument(
      actorUserId,
      documentId,
    );

    if (existing.kind !== "REQUIREMENT") {
      throwInvalidDocumentKind("Only requirement documents can be cancelled");
    }
    await this.requireRequirementCancellationAccess(actorUserId, existing);

    const result =
      await this.kindTransitions.cancelRequirementPreflight(documentId);

    if (result.status !== "ok") {
      if (result.status === "not_found") {
        throwDocumentNotFound();
      }
      throwInvalidDocumentKind("Only requirement documents can be cancelled");
    }

    return {
      canCancel: result.referenceCount === 0,
      referenceCount: result.referenceCount,
      ...(result.referenceCount > 0
        ? { modeRequired: "UNLINK_REFERENCES" as const }
        : {}),
    };
  }

  async cancelRequirement(
    actorUserId: string,
    documentId: string,
    input: CancelRequirementRequest,
    metadata: RequestMetadata = {},
  ): Promise<Document> {
    const existing = await this.requireReadableDocument(
      actorUserId,
      documentId,
    );

    if (existing.kind !== "REQUIREMENT") {
      throwInvalidDocumentKind("Only requirement documents can be cancelled");
    }
    await this.requireRequirementCancellationAccess(actorUserId, existing);

    const result = await this.kindTransitions.cancelRequirement({
      actorType: "USER",
      actorUserId,
      baseRevision: input.baseRevision,
      documentId,
      reason: input.reason,
      referenceMode: input.referenceMode,
      requestId: metadata.requestId,
    });
    const updated = this.requireCancelRequirementResult(result);

    await this.recordAudit("UPDATE", actorUserId, updated, existing, metadata);
    this.publishDocumentRealtime(actorUserId, updated, "UPDATED", [
      "document-list",
      "document-detail",
      "document-links",
      "document-timeline",
      "resource-documents",
      "requirement-list",
      "requirement-detail",
      "version-board",
      "intake-list",
      "work-item-list",
      "bug-list",
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
    const existing = await this.requireEditableDocument(
      actorUserId,
      documentId,
    );
    this.assertGeneralDocumentContentEditable(existing);
    if (
      existing.contentFormat !== "MARKDOWN" ||
      existing.contentMarkdown === undefined
    ) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Only Markdown documents can append Markdown content",
        HttpStatus.BAD_REQUEST,
      );
    }
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
      contentFormat: "MARKDOWN",
      contentJson: undefined,
      contentMarkdown: normalized.contentMarkdown,
      contentMarkdownCache: null,
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
    const existing = await this.requireEditableDocument(
      actorUserId,
      documentId,
    );
    this.assertMarkdownContentEditable(existing);
    const converted = await this.convertReimportFileToMarkdown(
      file,
      documentId,
    );
    const uploadedObjectKeys = [...(converted?.uploadedObjectKeys ?? [])];

    try {
      const markdown = converted
        ? converted.markdown
        : readMarkdownFile(assertAndReturn(file, assertMarkdownImportFile));
      const normalized = normalizeMarkdownSource({
        contentMarkdown: markdown,
        fallbackTitle: existing.title,
        title: existing.title,
      });
      const fileKey = createSourceFileKey(documentId, file.fileName);
      const sourceMimeType = converted
        ? getUploadedSourceAttachmentMimeType(file, converted.sourceType)
        : file.mimeType;

      await this.objectStorage.putObject({
        body: file.buffer,
        key: fileKey,
        mimeType: sourceMimeType,
        size: file.size,
      });
      uploadedObjectKeys.push(fileKey);

      const result = await this.documents.updateContent({
        actorType: "USER",
        actorUserId,
        baseRevision: input.baseRevision,
        changeType: "REIMPORTED",
        chunks: buildDocumentChunks(normalized.contentMarkdown),
        contentFormat: "MARKDOWN",
        contentJson: undefined,
        contentMarkdown: normalized.contentMarkdown,
        contentMarkdownCache: null,
        contentText: normalized.contentText,
        documentId,
        inlineAttachments: converted?.inlineAttachments,
        requestId: metadata.requestId,
        sourceAttachment: {
          fileKey,
          fileName: file.fileName,
          mimeType: sourceMimeType,
          size: file.size,
        },
      });
      const updated = this.requireUpdatedResult(result);

      await this.recordAudit(
        "UPDATE",
        actorUserId,
        updated,
        existing,
        metadata,
      );
      this.publishDocumentRealtime(actorUserId, updated, "UPDATED", [
        "document-list",
        "document-detail",
        "document-timeline",
        "document-attachments",
      ]);

      return updated;
    } catch (error) {
      await this.deleteUploadedObjects(uploadedObjectKeys);
      throw error;
    }
  }

  async archive(
    actorUserId: string,
    documentId: string,
    metadata: RequestMetadata = {},
    actor: DocumentActorContext = userDocumentActor(),
    baseRevision?: number,
  ): Promise<Document> {
    return this.updateState(
      actorUserId,
      documentId,
      "ARCHIVED",
      metadata,
      actor,
      baseRevision,
    );
  }

  async restore(
    actorUserId: string,
    documentId: string,
    metadata: RequestMetadata = {},
  ): Promise<Document> {
    return this.updateState(
      actorUserId,
      documentId,
      "RESTORED",
      metadata,
      userDocumentActor(),
    );
  }

  async delete(
    actorUserId: string,
    documentId: string,
    metadata: RequestMetadata = {},
    actor: DocumentActorContext = userDocumentActor(),
    baseRevision?: number,
  ): Promise<Record<string, never>> {
    await this.updateState(
      actorUserId,
      documentId,
      "DELETED",
      metadata,
      actor,
      baseRevision,
    );

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
    const existing = await this.requireEditableDocument(
      actorUserId,
      documentId,
    );
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
    const existing = await this.requireEditableDocument(
      actorUserId,
      documentId,
    );

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

  async listLinksByTarget(
    actorUserId: string,
    input: DocumentLinksByTargetQuery,
  ) {
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
    sourceType:
      | "UPLOAD_MARKDOWN"
      | "UPLOAD_DOCX"
      | "UPLOAD_HTML" = "UPLOAD_MARKDOWN",
    options: {
      documentId?: string;
      extractedTitle?: string;
      inlineAttachments?: ConvertedDocxMarkdown["inlineAttachments"];
      sourceMimeType?: string;
      uploadedObjectKeys?: string[];
    } = {},
  ): Promise<Document> {
    const documentId = options.documentId ?? ulid();
    const uploadedObjectKeys = [...(options.uploadedObjectKeys ?? [])];

    try {
      assertDocumentFile(() => getUploadedDocumentAssertion(sourceType)(file));
      const access = await this.requireSpaceCreator(actorUserId, spaceId);
      const markdown = providedMarkdown ?? readMarkdownFile(file);
      const normalized = normalizeMarkdownSource({
        contentMarkdown: markdown,
        fallbackTitle: titleFromFileName(file.fileName),
        title: input.title ?? options.extractedTitle,
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
        mimeType: options.sourceMimeType ?? file.mimeType,
        size: file.size,
      });
      uploadedObjectKeys.push(fileKey);

      const document = await this.documents.create({
        ...normalized,
        actorType: "USER",
        actorUserId,
        chunks: buildDocumentChunks(normalized.contentMarkdown),
        folderId: input.folderId,
        id: documentId,
        inlineAttachments: options.inlineAttachments,
        links,
        organizationId: access.space.organizationId,
        requestId: metadata.requestId,
        sourceAttachment: {
          fileKey,
          fileName: file.fileName,
          mimeType: options.sourceMimeType ?? file.mimeType,
          size: file.size,
        },
        sourceType,
        spaceId,
        tagIds: input.tagIds,
      });

      await this.recordAudit(
        "CREATE",
        actorUserId,
        document,
        undefined,
        metadata,
      );
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
      await this.deleteUploadedObjects(uploadedObjectKeys);
      throw error;
    }
  }

  private async convertDocxToMarkdown(
    file: UploadedDocumentFile,
    documentId: string,
  ): Promise<ConvertedDocxMarkdown> {
    assertDocumentFile(() => assertDocxImportFile(file));
    const inlineAttachments: ConvertedDocxMarkdown["inlineAttachments"] = [];
    const uploadedObjectKeys: string[] = [];
    let imageOrdinal = 0;

    try {
      assertSafeDocxZip(file);
      const docxHints = extractDocxImportHints(file);
      const convertToHtml = (
        mammoth as unknown as { convertToHtml: ConvertToHtml }
      ).convertToHtml;
      const result = await withTimeout(
        convertToHtml(
          { buffer: file.buffer },
          {
            convertImage: mammoth.images.imgElement(
              async (image: MammothImage) => {
                imageOrdinal += 1;
                const attachment = await this.uploadDocxInlineImage({
                  documentId,
                  image,
                  ordinal: imageOrdinal,
                });

                if (!attachment) {
                  return { src: "image omitted" };
                }

                inlineAttachments.push(attachment);
                uploadedObjectKeys.push(attachment.fileKey);

                return {
                  src: createAttachmentDownloadPath(attachment.id),
                };
              },
            ),
            externalFileAccess: false,
          },
        ),
        DocumentDocxConversionTimeoutMs,
        "DOCX conversion timed out",
      );

      if (result.messages.some((message) => message.type === "error")) {
        throw new Error(
          result.messages.map((message) => message.message).join("; "),
        );
      }

      const markdown = normalizeConvertedDocxMarkdown(
        stripGeneratedDocxTableOfContents(
          convertMammothHtmlToMarkdown(stripBase64Images(result.value)),
        ).trim(),
        docxHints,
      );
      assertMarkdownSize(markdown);

      if (!markdown) {
        throw new Error("DOCX conversion produced empty markdown");
      }

      return {
        inlineAttachments,
        markdown,
        title: docxHints.title,
        uploadedObjectKeys,
      };
    } catch (error) {
      await this.deleteUploadedObjects(uploadedObjectKeys);
      if (error instanceof ApiException) {
        throw error;
      }
      if (isCodedError(error, "FILE_TOO_LARGE")) {
        throw new ApiException(
          "FILE_TOO_LARGE",
          "File is too large",
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new ApiException(
        "DOCUMENT_IMPORT_FAILED",
        "DOCX import failed",
        HttpStatus.BAD_REQUEST,
        error instanceof Error ? { reason: error.message } : undefined,
      );
    }
  }

  private async convertHtmlToMarkdown(
    file: UploadedDocumentFile,
    documentId: string,
  ): Promise<ConvertedHtmlMarkdown> {
    assertDocumentFile(() => assertHtmlImportFile(file));
    const inlineAttachments: ConvertedHtmlMarkdown["inlineAttachments"] = [];
    const uploadedObjectKeys: string[] = [];
    let imageOrdinal = 0;

    try {
      const htmlSource = readHtmlImportSource(file);
      const root = parseHtmlFragment(htmlSource.html);
      const title = extractHtmlDocumentTitle(root);

      await this.replaceHtmlImageSources(root, {
        documentId,
        inlineAttachments,
        nextImageOrdinal: () => {
          imageOrdinal += 1;
          return imageOrdinal;
        },
        resources: htmlSource.resources,
        uploadedObjectKeys,
      });

      const markdown = convertParsedHtmlToMarkdown(root);
      assertMarkdownSize(markdown);

      if (!markdown) {
        throw new Error("HTML conversion produced empty markdown");
      }

      return {
        inlineAttachments,
        markdown,
        title,
        uploadedObjectKeys,
      };
    } catch (error) {
      await this.deleteUploadedObjects(uploadedObjectKeys);
      if (error instanceof ApiException) {
        throw error;
      }
      if (isCodedError(error, "FILE_TOO_LARGE")) {
        throw new ApiException(
          "FILE_TOO_LARGE",
          "File is too large",
          HttpStatus.BAD_REQUEST,
        );
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
          "HTML import failed",
          HttpStatus.BAD_REQUEST,
          error instanceof Error ? { reason: error.message } : undefined,
        );
      }
      throw new ApiException(
        "DOCUMENT_IMPORT_FAILED",
        "HTML import failed",
        HttpStatus.BAD_REQUEST,
        error instanceof Error ? { reason: error.message } : undefined,
      );
    }
  }

  private async convertReimportFileToMarkdown(
    file: UploadedDocumentFile,
    documentId: string,
  ): Promise<
    | (ConvertedDocxMarkdown & { sourceType: "UPLOAD_DOCX" })
    | (ConvertedHtmlMarkdown & { sourceType: "UPLOAD_HTML" })
    | undefined
  > {
    const lowerFileName = file.fileName.toLowerCase();

    if (lowerFileName.endsWith(".docx")) {
      return {
        ...(await this.convertDocxToMarkdown(
          assertAndReturn(file, assertDocxImportFile),
          documentId,
        )),
        sourceType: "UPLOAD_DOCX",
      };
    }
    if (
      lowerFileName.endsWith(".html") ||
      lowerFileName.endsWith(".htm") ||
      lowerFileName.endsWith(".zip")
    ) {
      return {
        ...(await this.convertHtmlToMarkdown(
          assertAndReturn(file, assertHtmlImportFile),
          documentId,
        )),
        sourceType: "UPLOAD_HTML",
      };
    }

    return undefined;
  }

  private async replaceHtmlImageSources(
    root: HtmlElementNode,
    input: {
      documentId: string;
      inlineAttachments: ConvertedHtmlMarkdown["inlineAttachments"];
      nextImageOrdinal: () => number;
      resources?: HtmlImportResourcePackage;
      uploadedObjectKeys: string[];
    },
  ): Promise<void> {
    const images = collectHtmlElements(root, "img");

    for (const image of images) {
      const source = image.attrs.src?.trim();

      if (!source) {
        continue;
      }

      const replacement = await this.resolveHtmlImageSource(source, input);

      if (replacement) {
        image.attrs.src = replacement;
      } else {
        delete image.attrs.src;
      }
    }
  }

  private async resolveHtmlImageSource(
    source: string,
    input: {
      documentId: string;
      inlineAttachments: ConvertedHtmlMarkdown["inlineAttachments"];
      nextImageOrdinal: () => number;
      resources?: HtmlImportResourcePackage;
      uploadedObjectKeys: string[];
    },
  ): Promise<string | undefined> {
    const dataImage = parseHtmlDataImage(source);

    if (dataImage) {
      const attachment = await this.uploadHtmlInlineImage({
        body: dataImage.body,
        documentId: input.documentId,
        mimeType: dataImage.mimeType,
        ordinal: input.nextImageOrdinal(),
      });

      input.inlineAttachments.push(attachment);
      input.uploadedObjectKeys.push(attachment.fileKey);

      return createAttachmentDownloadPath(attachment.id);
    }

    const sanitizedRemote = sanitizeHtmlImageSource(source);

    if (sanitizedRemote.kind === "safe") {
      return sanitizedRemote.value;
    }
    if (sanitizedRemote.kind === "unsafe") {
      return undefined;
    }
    if (!input.resources) {
      throwHtmlImportFailed(`HTML image resource is missing: ${source}`);
    }

    const resourcePath = resolveHtmlZipResourcePath(
      input.resources.htmlEntryPath,
      sanitizedRemote.value,
    );

    if (!resourcePath) {
      throwHtmlImportFailed(`HTML image resource path is invalid: ${source}`);
    }

    const resourceEntry = input.resources.entriesByPath.get(resourcePath);

    if (!resourceEntry) {
      throwHtmlImportFailed(`HTML image resource is missing: ${source}`);
    }

    const mimeType = getSupportedHtmlImageMimeType(resourcePath);

    if (!mimeType) {
      throwHtmlImportFailed(`HTML image MIME type is unsupported: ${source}`);
    }

    const body = readHtmlZipEntryData(input.resources.file, resourceEntry);

    if (body.length <= 0) {
      throwHtmlImportFailed(`HTML image resource is empty: ${source}`);
    }

    const attachment = await this.uploadHtmlInlineImage({
      body,
      documentId: input.documentId,
      fileName: fileNameFromPath(resourcePath),
      mimeType,
      ordinal: input.nextImageOrdinal(),
    });

    input.inlineAttachments.push(attachment);
    input.uploadedObjectKeys.push(attachment.fileKey);

    return createAttachmentDownloadPath(attachment.id);
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
    const document = await this.requireReadableDocument(
      actorUserId,
      documentId,
    );
    const access = await this.requireSpaceReader(actorUserId, document.spaceId);

    if (document.kind === "REQUIREMENT") {
      await this.targets.resolve(
        actorUserId,
        REQUIREMENT_TARGET_TYPE,
        document.id,
        {
          access: "write",
          writePolicy: "objectUpdate",
        },
      );

      return document;
    }

    if (
      DOCUMENT_WRITER_DENIED_ROLES.has(access.role) ||
      (!DOCUMENT_MANAGER_ROLES.has(access.role) &&
        document.createdById !== actorUserId)
    ) {
      throwSpaceAccessDenied();
    }

    return document;
  }

  private async requireRequirementWriter(actorUserId: string, spaceId: string) {
    const access = await this.requireSpaceReader(actorUserId, spaceId);

    if (!REQUIREMENT_WRITER_ROLES.has(access.role)) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireRequirementCancellationAccess(
    actorUserId: string,
    document: Document,
  ) {
    const access = await this.requireSpaceReader(actorUserId, document.spaceId);

    if (document.status === "DRAFT" && document.sequence == null) {
      if (
        REQUIREMENT_WRITER_ROLES.has(access.role) ||
        document.createdById === actorUserId
      ) {
        return access;
      }

      throwSpaceAccessDenied();
    }

    if (!DOCUMENT_MANAGER_ROLES.has(access.role)) {
      throwSpaceAccessDenied();
    }

    return access;
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
      if (
        link.targetType === "DOCUMENT" &&
        link.targetId === input.documentId
      ) {
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

  private async validateRequirementVersion(
    actorUserId: string,
    document: Document,
    versionId: string | null | undefined,
  ) {
    if (!versionId) {
      return;
    }

    const target = await this.targets.resolve(
      actorUserId,
      "VERSION",
      versionId,
      {
        hideInaccessible: true,
        notFoundCode: "NOT_FOUND",
      },
    );

    if (
      target.organizationId !== document.organizationId ||
      target.spaceId !== document.spaceId
    ) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Requirement version must belong to the same space",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async validateRequirementOwner(
    document: Document,
    ownerId: string | undefined,
  ) {
    if (!ownerId) {
      return;
    }

    const member = await this.spaces.findMemberByUserId(
      document.spaceId,
      ownerId,
    );

    if (!member || member.status !== "ACTIVE") {
      throw new ApiException(
        "SPACE_MEMBER_NOT_FOUND",
        "Requirement owner must be an active space member",
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private assertGeneralDocumentContentEditable(document: Document) {
    if (document.kind !== "REQUIREMENT") {
      return;
    }

    throwRequirementDocumentContentBypass();
  }

  private assertMarkdownContentEditable(document: Document) {
    this.assertGeneralDocumentContentEditable(document);

    if (
      document.contentFormat === "MARKDOWN" &&
      document.contentMarkdown !== undefined
    ) {
      return;
    }

    throw new ApiException(
      "VALIDATION_ERROR",
      "Only Markdown documents can be updated with Markdown content",
      HttpStatus.BAD_REQUEST,
    );
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

  private requireConvertToRequirementResult(
    result: Awaited<
      ReturnType<DocumentKindTransitionService["convertToRequirement"]>
    >,
  ): Document {
    if (result.status === "invalid_kind") {
      throwInvalidDocumentKind("Only general documents can be converted");
    }

    return this.requireUpdatedResult(result);
  }

  private requireCancelRequirementResult(
    result: Awaited<
      ReturnType<DocumentKindTransitionService["cancelRequirement"]>
    >,
  ): Document {
    if (result.status === "invalid_kind") {
      throwInvalidDocumentKind("Only requirement documents can be cancelled");
    }
    if (result.status === "referenced") {
      throw new ApiException(
        "CONFLICT",
        "Requirement has active references",
        HttpStatus.CONFLICT,
        {
          modeRequired: "UNLINK_REFERENCES",
          referenceCount: result.referenceCount,
        },
      );
    }

    return this.requireUpdatedResult(result);
  }

  private async updateState(
    actorUserId: string,
    documentId: string,
    changeType: "ARCHIVED" | "RESTORED" | "DELETED",
    metadata: RequestMetadata,
    actor: DocumentActorContext,
    baseRevision?: number,
  ): Promise<Document> {
    const existing = await this.requireEditableDocument(
      actorUserId,
      documentId,
    );
    if (existing.kind === "REQUIREMENT") {
      throwRequirementDocumentStateBypass();
    }
    if (baseRevision !== undefined && existing.revision !== baseRevision) {
      throw new ApiException(
        "DOCUMENT_EDIT_CONFLICT",
        "Document revision conflict",
        HttpStatus.CONFLICT,
      );
    }
    const result = await this.documents.updateState({
      actorType: actor.actorType,
      actorUserId,
      changeType,
      documentId,
      mcpClientId: actor.mcpClientId,
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
    invalidates: Parameters<
      RealtimePublisherService["publish"]
    >[0]["invalidates"],
  ) {
    try {
      this.realtime.publish({
        actorId: actorUserId,
        organizationId: document.organizationId,
        spaceId: document.spaceId,
        target: { type: "DOCUMENT", id: document.id },
        operation,
        invalidates: withDocumentRecentActivityInvalidates(
          "DOCUMENT",
          invalidates,
        ),
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
        invalidates: withRecentActivityInvalidates([
          "document-directory",
          "document-list",
          "document-detail",
          "document-timeline",
        ]),
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

  private async uploadDocxInlineImage(input: {
    documentId: string;
    image: MammothImage;
    ordinal: number;
  }): Promise<ConvertedDocxMarkdown["inlineAttachments"][number] | undefined> {
    const mimeType = getSupportedDocxImageMimeType(input.image.contentType);

    if (!mimeType) {
      return undefined;
    }

    const body = await readDocxImageBuffer(input.image);
    if (body.length <= 0) {
      return undefined;
    }
    if (body.length > AttachmentMaxSizeBytes) {
      throw new ApiException(
        "FILE_TOO_LARGE",
        "Embedded DOCX image is too large",
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.uploadDocumentInlineImage({
      body,
      documentId: input.documentId,
      fileName: createDocxImageFileName(input.ordinal, mimeType),
      mimeType,
    });
  }

  private async uploadHtmlInlineImage(input: {
    body: Buffer;
    documentId: string;
    fileName?: string;
    mimeType: keyof typeof supportedDocxImageExtensions;
    ordinal: number;
  }): Promise<ConvertedHtmlMarkdown["inlineAttachments"][number]> {
    if (input.body.length <= 0) {
      throwHtmlImportFailed("HTML image resource is empty");
    }
    if (input.body.length > AttachmentMaxSizeBytes) {
      throw new ApiException(
        "FILE_TOO_LARGE",
        "HTML image is too large",
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.uploadDocumentInlineImage({
      body: input.body,
      documentId: input.documentId,
      fileName:
        input.fileName ??
        createHtmlImageFileName(input.ordinal, input.mimeType),
      mimeType: input.mimeType,
    });
  }

  private async uploadDocumentInlineImage(input: {
    body: Buffer;
    documentId: string;
    fileName: string;
    mimeType: keyof typeof supportedDocxImageExtensions;
  }): Promise<ConvertedDocxMarkdown["inlineAttachments"][number]> {
    const id = ulid();
    const fileKey = createInlineImageFileKey(input.documentId, input.fileName);

    await this.objectStorage.putObject({
      body: input.body,
      key: fileKey,
      mimeType: input.mimeType,
      size: input.body.length,
    });

    return {
      fileKey,
      fileName: input.fileName,
      id,
      mimeType: input.mimeType,
      size: input.body.length,
    };
  }

  private async deleteUploadedObjects(fileKeys: string[]) {
    for (const fileKey of fileKeys) {
      await this.deleteUploadedObject(fileKey);
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

function buildMarkdownContentUpdate(
  input: Extract<UpdateDocumentContentRequest, { contentMarkdown: string }>,
  title: string,
) {
  const normalized = normalizeMarkdownSource({
    contentMarkdown: input.contentMarkdown,
    fallbackTitle: title,
    title,
  });

  return {
    chunks: buildDocumentChunks(normalized.contentMarkdown),
    contentJson: undefined,
    contentMarkdown: normalized.contentMarkdown,
    contentMarkdownCache: null,
    contentText: normalized.contentText,
  };
}

function buildTiptapContentUpdate(
  input: Extract<
    UpdateDocumentContentRequest,
    { contentFormat: "TIPTAP_JSON" }
  >,
) {
  const normalized = normalizeTiptapSource({
    contentJson: input.contentJson,
    contentMarkdownCache: input.contentMarkdownCache,
  });

  return {
    chunks: buildDocumentChunksFromText(
      normalized.contentMarkdownCache || normalized.contentText,
    ),
    contentJson: normalized.contentJson,
    contentMarkdown: null,
    contentMarkdownCache: normalized.contentMarkdownCache,
    contentText: normalized.contentText,
  };
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
      throw new ApiException(
        "FILE_TOO_LARGE",
        "File is too large",
        HttpStatus.BAD_REQUEST,
      );
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

function getUploadedDocumentAssertion(
  sourceType: "UPLOAD_MARKDOWN" | "UPLOAD_DOCX" | "UPLOAD_HTML",
): (file: UploadedDocumentFile) => void {
  if (sourceType === "UPLOAD_DOCX") {
    return assertDocxImportFile;
  }
  if (sourceType === "UPLOAD_HTML") {
    return assertHtmlImportFile;
  }

  return assertMarkdownImportFile;
}

function readHtmlImportSource(file: UploadedDocumentFile): {
  html: string;
  resources?: HtmlImportResourcePackage;
} {
  if (!file.fileName.toLowerCase().endsWith(".zip")) {
    return { html: file.buffer.toString("utf8") };
  }

  const entries = readSafeHtmlZipEntries(file);
  const htmlEntry = selectHtmlZipEntry(entries);
  const entriesByPath = new Map<string, HtmlZipEntry>();

  for (const entry of entries) {
    if (entry.fileName.endsWith("/")) {
      continue;
    }
    entriesByPath.set(normalizeHtmlZipEntryPath(entry.fileName), entry);
  }

  return {
    html: readHtmlZipEntryData(file, htmlEntry).toString("utf8"),
    resources: {
      entriesByPath,
      file,
      htmlEntryPath: normalizeHtmlZipEntryPath(htmlEntry.fileName),
    },
  };
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

function normalizeHtmlZipEntryPath(fileName: string): string {
  return fileName.replace(/\\/gu, "/");
}

function resolveHtmlZipResourcePath(
  htmlEntryPath: string,
  source: string,
): string | undefined {
  const sourcePath = stripUrlSuffix(source).replace(/\\/gu, "/");

  if (
    !sourcePath ||
    sourcePath.startsWith("/") ||
    sourcePath.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(sourcePath) ||
    /^[a-z]:[\\/]/iu.test(sourcePath)
  ) {
    return undefined;
  }

  let decoded: string;

  try {
    decoded = decodeURI(sourcePath);
  } catch {
    return undefined;
  }

  const segments = [
    ...htmlEntryPath.split("/").slice(0, -1),
    ...decoded.split("/"),
  ];
  const normalized: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (normalized.length === 0) {
        return undefined;
      }
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }

  return normalized.length > 0 ? normalized.join("/") : undefined;
}

function stripUrlSuffix(value: string): string {
  const suffixIndex = value.search(/[?#]/u);

  return suffixIndex >= 0 ? value.slice(0, suffixIndex) : value;
}

function getUploadedSourceAttachmentMimeType(
  file: UploadedDocumentFile,
  sourceType: "UPLOAD_DOCX" | "UPLOAD_HTML",
): string {
  return sourceType === "UPLOAD_HTML"
    ? getHtmlSourceAttachmentMimeType(file)
    : file.mimeType;
}

function getHtmlSourceAttachmentMimeType(file: UploadedDocumentFile): string {
  if (!file.fileName.toLowerCase().endsWith(".zip")) {
    return htmlSourceAttachmentMimeType;
  }

  return file.mimeType === "application/octet-stream"
    ? "application/zip"
    : file.mimeType;
}

function createSourceFileKey(documentId: string, fileName: string) {
  return `attachments/document/${documentId}/${ulid()}-${sanitizeFileName(fileName)}`;
}

function createInlineImageFileKey(documentId: string, fileName: string) {
  return `attachments/document/${documentId}/images/${ulid()}-${sanitizeFileName(fileName)}`;
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^\w.\-() ]+/gu, "_").slice(0, 200) || "document";
}

function createAttachmentDownloadPath(attachmentId: string) {
  return `${documentAttachmentDownloadPathPrefix}/${encodeURIComponent(attachmentId)}/download`;
}

function createDocxImageFileName(
  ordinal: number,
  mimeType: keyof typeof supportedDocxImageExtensions,
) {
  const sequence = ordinal.toString().padStart(3, "0");

  return `image-${sequence}${supportedDocxImageExtensions[mimeType]}`;
}

function createHtmlImageFileName(
  ordinal: number,
  mimeType: keyof typeof supportedDocxImageExtensions,
) {
  const sequence = ordinal.toString().padStart(3, "0");

  return `html-image-${sequence}${supportedDocxImageExtensions[mimeType]}`;
}

function fileNameFromPath(filePath: string): string {
  return sanitizeFileName(
    filePath.split("/").filter(Boolean).at(-1) ?? "image",
  );
}

function getSupportedDocxImageMimeType(
  contentType: string | undefined,
): keyof typeof supportedDocxImageExtensions | undefined {
  const parsed = AttachmentMimeTypeSchema.safeParse(
    contentType?.trim().toLowerCase(),
  );

  if (!parsed.success || !(parsed.data in supportedDocxImageExtensions)) {
    return undefined;
  }

  return parsed.data as keyof typeof supportedDocxImageExtensions;
}

function getSupportedHtmlImageMimeType(
  filePath: string,
): keyof typeof supportedDocxImageExtensions | undefined {
  const lowerPath = stripUrlSuffix(filePath).toLowerCase();
  const extension = (
    Object.keys(supportedHtmlImageMimeTypesByExtension) as Array<
      keyof typeof supportedHtmlImageMimeTypesByExtension
    >
  ).find((candidate) => lowerPath.endsWith(candidate));

  return extension
    ? supportedHtmlImageMimeTypesByExtension[extension]
    : undefined;
}

function parseHtmlDataImage(source: string):
  | {
      body: Buffer;
      mimeType: keyof typeof supportedDocxImageExtensions;
    }
  | undefined {
  const match = /^data:([^;,]+)(?:;[a-z0-9_.=-]+)*;base64,([\s\S]+)$/iu.exec(
    source,
  );

  if (!match) {
    return undefined;
  }

  const mimeType = getSupportedDocxImageMimeType(match[1]);

  if (!mimeType) {
    throwHtmlImportFailed(
      `HTML data image MIME type is unsupported: ${match[1]}`,
    );
  }

  const base64 = (match[2] ?? "").replace(/\s+/gu, "");

  if (!base64 || !/^[a-z0-9+/]+={0,2}$/iu.test(base64)) {
    throwHtmlImportFailed("HTML data image base64 payload is invalid");
  }

  return {
    body: Buffer.from(base64, "base64"),
    mimeType,
  };
}

async function readDocxImageBuffer(image: MammothImage): Promise<Buffer> {
  if (typeof image.readAsBuffer === "function") {
    return image.readAsBuffer();
  }
  if (typeof image.read === "function") {
    const body = await image.read();

    return Buffer.isBuffer(body) ? body : Buffer.from(body);
  }

  throw new Error("DOCX image reader is unavailable");
}

type DocxImportHints = {
  outlineHeadingTexts: Set<string>;
  title?: string;
};

type DocxStyleInfo = {
  name?: string;
  outlineLevel?: number;
};

type HtmlNode = HtmlElementNode | HtmlTextNode;

type HtmlElementNode = {
  attrs: Record<string, string>;
  children: HtmlNode[];
  tagName: string;
  type: "element";
};

type HtmlTextNode = {
  type: "text";
  value: string;
};

const htmlBlockTags = new Set([
  "article",
  "blockquote",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "html",
  "hr",
  "body",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);
const htmlVoidTags = new Set(["br", "hr", "img", "input", "meta"]);
const htmlIgnoredTags = new Set([
  "applet",
  "base",
  "embed",
  "form",
  "frame",
  "frameset",
  "head",
  "iframe",
  "link",
  "noscript",
  "object",
  "script",
  "style",
  "template",
]);

function extractDocxImportHints(file: UploadedDocumentFile): DocxImportHints {
  const hints: DocxImportHints = { outlineHeadingTexts: new Set() };
  const documentXml = readDocxUtf8Entry(file, "word/document.xml");

  if (!documentXml) {
    return hints;
  }

  const styles = extractDocxStyleInfo(file);
  const paragraphPattern = /<w:p\b[\s\S]*?<\/w:p>/gu;
  let match: RegExpExecArray | null;
  let seenStructuralHeading = false;

  while ((match = paragraphPattern.exec(documentXml))) {
    const paragraphXml = match[0];
    const text = extractDocxParagraphText(paragraphXml);

    if (!text) {
      continue;
    }

    const styleId = extractWordXmlAttribute(paragraphXml, "w:pStyle", "w:val");
    const styleInfo = styleId ? styles.get(styleId) : undefined;
    const directOutlineLevel = parseDocxOutlineLevel(
      extractWordXmlAttribute(paragraphXml, "w:outlineLvl", "w:val"),
    );
    const outlineLevel = directOutlineLevel ?? styleInfo?.outlineLevel;
    const isTocStyle = isDocxTocStyle(styleId, styleInfo);
    const isStructuralHeading = isDocxStructuralHeading(
      styleId,
      styleInfo,
      outlineLevel,
    );

    if (
      hints.title === undefined &&
      !seenStructuralHeading &&
      !isTocStyle &&
      isLikelyDocxCoverTitle(text)
    ) {
      hints.title = text;
    }

    if (
      isSupportedDocxOutlineLevel(outlineLevel) &&
      isLikelyDocxOutlineHeading(text)
    ) {
      hints.outlineHeadingTexts.add(normalizeDocxHeadingComparisonText(text));
    }

    if (isStructuralHeading) {
      seenStructuralHeading = true;
    }
  }

  return hints;
}

function normalizeConvertedDocxMarkdown(
  markdown: string,
  hints: DocxImportHints,
): string {
  if (hints.outlineHeadingTexts.size === 0) {
    return markdown;
  }

  const lines = markdown.split("\n");
  let currentHeadingLevel = 0;

  return lines
    .map((line) => {
      const heading = /^(#{1,6})\s+(.+)$/u.exec(line.trim());

      if (heading?.[1]) {
        currentHeadingLevel = heading[1].length;
        return line;
      }

      const listHeading = /^(\s*)\d+[.)]\s+(.+?)\s*$/u.exec(line);
      const text = listHeading?.[2];

      if (
        !text ||
        !hints.outlineHeadingTexts.has(normalizeDocxHeadingComparisonText(text))
      ) {
        return line;
      }

      const level = Math.min(Math.max(currentHeadingLevel + 1, 2), 6);
      currentHeadingLevel = level;

      return `${"#".repeat(level)} ${text}`;
    })
    .join("\n");
}

function convertMammothHtmlToMarkdown(html: string): string {
  return convertParsedHtmlToMarkdown(parseHtmlFragment(html));
}

function convertParsedHtmlToMarkdown(root: HtmlElementNode): string {
  return renderHtmlBlockChildren(root.children)
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function parseHtmlFragment(html: string): HtmlElementNode {
  const root: HtmlElementNode = {
    attrs: {},
    children: [],
    tagName: "root",
    type: "element",
  };
  const stack: HtmlElementNode[] = [root];
  const tagPattern =
    /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html))) {
    if (match.index > cursor) {
      stack.at(-1)?.children.push({
        type: "text",
        value: html.slice(cursor, match.index),
      });
    }
    cursor = match.index + match[0].length;

    const rawTag = match[0];
    const tagName = match[1]?.toLowerCase();

    if (!tagName || rawTag.startsWith("<!")) {
      continue;
    }

    if (rawTag.startsWith("</")) {
      const openIndex = findOpenHtmlElementIndex(stack, tagName);

      if (openIndex > 0) {
        stack.length = openIndex;
      }
      continue;
    }

    const node: HtmlElementNode = {
      attrs: parseHtmlAttributes(match[2] ?? ""),
      children: [],
      tagName,
      type: "element",
    };
    stack.at(-1)?.children.push(node);

    if (!htmlVoidTags.has(tagName) && !/\/\s*$/u.test(match[2] ?? "")) {
      stack.push(node);
    }
  }

  if (cursor < html.length) {
    stack.at(-1)?.children.push({
      type: "text",
      value: html.slice(cursor),
    });
  }

  return root;
}

function parseHtmlAttributes(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attributePattern =
    /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/gu;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(value))) {
    const name = match[1]?.toLowerCase();

    if (!name) {
      continue;
    }
    attrs[name] = decodeHtmlText(match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attrs;
}

function findOpenHtmlElementIndex(
  stack: HtmlElementNode[],
  tagName: string,
): number {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]?.tagName === tagName) {
      return index;
    }
  }

  return -1;
}

function renderHtmlBlockChildren(children: HtmlNode[]): string {
  return children
    .map(renderHtmlBlock)
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n");
}

function renderHtmlBlock(node: HtmlNode): string {
  if (node.type === "text") {
    return renderHtmlText(node.value).trim();
  }
  if (htmlIgnoredTags.has(node.tagName)) {
    return "";
  }

  if (/^h[1-6]$/u.test(node.tagName)) {
    const level = Number(node.tagName.slice(1));
    const text = renderHtmlInlineChildren(node.children);

    return text ? `${"#".repeat(level)} ${text}` : "";
  }

  switch (node.tagName) {
    case "blockquote": {
      return renderHtmlBlockChildren(node.children)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }
    case "br":
      return "";
    case "hr":
      return "---";
    case "ol":
    case "ul":
      return renderHtmlList(node);
    case "p":
      return renderHtmlInlineChildren(node.children);
    case "table":
      return renderHtmlTable(node);
    default:
      if (node.children.some(isHtmlBlockElement)) {
        return renderHtmlBlockChildren(node.children);
      }

      return renderHtmlInline(node).trim();
  }
}

function renderHtmlInlineChildren(children: HtmlNode[]): string {
  return children
    .map(renderHtmlInline)
    .join("")
    .replace(/[ \t\r\n]+/gu, " ")
    .trim();
}

function renderHtmlInline(node: HtmlNode): string {
  if (node.type === "text") {
    return renderHtmlText(node.value);
  }
  if (htmlIgnoredTags.has(node.tagName)) {
    return "";
  }

  switch (node.tagName) {
    case "a": {
      const text = renderHtmlInlineChildren(node.children);
      const href = sanitizeHtmlHref(node.attrs.href?.trim());

      if (!text) {
        return "";
      }

      return href ? `[${text}](${href})` : text;
    }
    case "br":
      return "\n";
    case "code": {
      const text = renderHtmlInlineChildren(node.children);

      return text ? `\`${text.replace(/`/gu, "'")}\`` : "";
    }
    case "em":
    case "i": {
      const text = renderHtmlInlineChildren(node.children);

      return text ? `_${text}_` : "";
    }
    case "img": {
      const src = sanitizeHtmlImageMarkdownSource(node.attrs.src?.trim());
      const alt = node.attrs.alt?.trim() ?? "image";

      return src ? `![${alt}](${src})` : "[image omitted]";
    }
    case "strong":
    case "b": {
      const text = renderHtmlInlineChildren(node.children);

      return text ? `**${text}**` : "";
    }
    default:
      return renderHtmlInlineChildren(node.children);
  }
}

function renderHtmlList(node: HtmlElementNode, depth = 0): string {
  const ordered = node.tagName === "ol";
  const items = node.children.filter(
    (child): child is HtmlElementNode =>
      child.type === "element" && child.tagName === "li",
  );

  return items
    .map((item, index) => {
      const nestedLists = item.children.filter(
        (child): child is HtmlElementNode =>
          child.type === "element" &&
          (child.tagName === "ol" || child.tagName === "ul"),
      );
      const mainChildren = item.children.filter(
        (child) =>
          !(
            child.type === "element" &&
            (child.tagName === "ol" || child.tagName === "ul")
          ),
      );
      const marker = ordered ? `${index + 1}.` : "-";
      const indent = "  ".repeat(depth);
      const text = renderHtmlInlineChildren(mainChildren);
      const nested = nestedLists
        .map((list) => renderHtmlList(list, depth + 1))
        .filter(Boolean)
        .join("\n");
      const line = `${indent}${marker} ${text}`.trimEnd();

      return nested ? `${line}\n${nested}` : line;
    })
    .join("\n");
}

function renderHtmlTable(node: HtmlElementNode): string {
  const rows = collectHtmlTableRows(node)
    .map((row) =>
      row.children
        .filter(
          (child): child is HtmlElementNode =>
            child.type === "element" &&
            (child.tagName === "td" || child.tagName === "th"),
        )
        .map(renderHtmlTableCell),
    )
    .filter((row) => row.some((cell) => cell.trim()));

  while (rows.at(-1)?.every((cell) => !cell.trim())) {
    rows.pop();
  }

  if (rows.length === 0) {
    return "";
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? ""),
  );
  const [header = [], ...bodyRows] = normalizedRows;
  const delimiter = Array.from({ length: columnCount }, () => "---");

  return [header, delimiter, ...bodyRows]
    .map(renderMarkdownTableRow)
    .join("\n");
}

function collectHtmlTableRows(node: HtmlElementNode): HtmlElementNode[] {
  if (node.tagName === "tr") {
    return [node];
  }

  return node.children.flatMap((child) =>
    child.type === "element" ? collectHtmlTableRows(child) : [],
  );
}

function renderHtmlTableCell(node: HtmlElementNode): string {
  const blockContent = renderHtmlBlockChildren(node.children);
  const inlineContent = blockContent || renderHtmlInlineChildren(node.children);

  return inlineContent
    .replace(/[ \t\r\n]+/gu, " ")
    .replace(/\|/gu, "｜")
    .trim();
}

function renderMarkdownTableRow(cells: string[]): string {
  return `| ${cells.map((cell) => cell || " ").join(" | ")} |`;
}

function stripGeneratedDocxTableOfContents(markdown: string): string {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const firstHeadingIndex = lines.findIndex((line) =>
    /^#{1,6}\s+/u.test(line.trim()),
  );
  const searchEnd = firstHeadingIndex >= 0 ? firstHeadingIndex : lines.length;
  const tocIndex = lines.findIndex(
    (line, index) => index < searchEnd && line.trim() === "目录",
  );

  if (tocIndex < 0) {
    return markdown;
  }

  let cursor = tocIndex + 1;
  let tocLinkCount = 0;

  while (cursor < searchEnd) {
    const line = lines[cursor]?.trim() ?? "";

    if (!line) {
      cursor += 1;
      continue;
    }
    if (!isGeneratedDocxTocLink(line)) {
      break;
    }
    tocLinkCount += 1;
    cursor += 1;
  }

  if (tocLinkCount < 2) {
    return markdown;
  }

  return [...lines.slice(0, tocIndex), ...lines.slice(searchEnd)]
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function isGeneratedDocxTocLink(line: string): boolean {
  return /^\[[\s\S]+\]\(#_Toc\d+\)$/u.test(line);
}

function isHtmlBlockElement(node: HtmlNode): boolean {
  return (
    node.type === "element" &&
    !htmlIgnoredTags.has(node.tagName) &&
    htmlBlockTags.has(node.tagName)
  );
}

function renderHtmlText(value: string): string {
  return decodeHtmlText(value).replace(/\s+/gu, " ");
}

function collectHtmlElements(
  node: HtmlElementNode,
  tagName: string,
): HtmlElementNode[] {
  const result: HtmlElementNode[] = [];

  for (const child of node.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tagName === tagName) {
      result.push(child);
    }
    result.push(...collectHtmlElements(child, tagName));
  }

  return result;
}

function extractHtmlDocumentTitle(root: HtmlElementNode): string | undefined {
  const title = collectHtmlElements(root, "title")
    .map((node) => renderHtmlInlineChildren(node.children))
    .find(Boolean);

  return title?.slice(0, 200);
}

function sanitizeHtmlHref(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (
    isSafeHttpUrl(value) ||
    isSafeMailtoUrl(value) ||
    isSafeAttachmentPath(value)
  ) {
    return value;
  }
  if (isUnsafeUrl(value)) {
    return undefined;
  }

  return value;
}

function sanitizeHtmlImageMarkdownSource(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  if (isSafeHttpUrl(value) || isSafeAttachmentPath(value)) {
    return value;
  }

  return undefined;
}

function sanitizeHtmlImageSource(
  value: string,
):
  | { kind: "relative"; value: string }
  | { kind: "safe"; value: string }
  | { kind: "unsafe" } {
  if (isSafeHttpUrl(value) || isSafeAttachmentPath(value)) {
    return { kind: "safe", value };
  }
  if (isUnsafeUrl(value) || value.startsWith("/")) {
    return { kind: "unsafe" };
  }

  return { kind: "relative", value };
}

function isSafeHttpUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}

function isSafeMailtoUrl(value: string): boolean {
  return /^mailto:/iu.test(value);
}

function isSafeAttachmentPath(value: string): boolean {
  return /^\/api\/v1\/attachments\/[0-9A-HJKMNP-TV-Z]{26}\/download(?:[?#].*)?$/u.test(
    value,
  );
}

function isUnsafeUrl(value: string): boolean {
  return (
    value.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(value) ||
    /^[a-z]:[\\/]/iu.test(value)
  );
}

function extractDocxParagraphText(paragraphXml: string): string {
  const textRuns: string[] = [];
  const textPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gu;
  let match: RegExpExecArray | null;

  while ((match = textPattern.exec(paragraphXml))) {
    textRuns.push(decodeXmlText(match[1] ?? ""));
  }

  return textRuns.join("").replace(/\s+/gu, " ").trim();
}

function extractWordXmlAttribute(
  xml: string,
  tagName: string,
  attributeName: string,
): string | undefined {
  const tag = new RegExp(`<${tagName}\\b[^>]*>`, "u").exec(xml)?.[0];

  if (!tag) {
    return undefined;
  }

  const escapedAttributeName = attributeName.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  const attribute = new RegExp(`${escapedAttributeName}="([^"]+)"`, "u").exec(
    tag,
  );

  return attribute?.[1];
}

function extractDocxStyleInfo(
  file: UploadedDocumentFile,
): Map<string, DocxStyleInfo> {
  const styles = new Map<string, DocxStyleInfo>();
  const stylesXml = readDocxUtf8Entry(file, "word/styles.xml");

  if (!stylesXml) {
    return styles;
  }

  const stylePattern = /<w:style\b[\s\S]*?<\/w:style>/gu;
  let match: RegExpExecArray | null;

  while ((match = stylePattern.exec(stylesXml))) {
    const styleXml = match[0];
    const styleId = /w:styleId="([^"]+)"/u.exec(styleXml)?.[1];

    if (!styleId) {
      continue;
    }

    const name = extractWordXmlAttribute(styleXml, "w:name", "w:val");
    const outlineLevel = parseDocxOutlineLevel(
      extractWordXmlAttribute(styleXml, "w:outlineLvl", "w:val"),
    );

    styles.set(styleId, {
      name: name ? decodeXmlText(name) : undefined,
      outlineLevel,
    });
  }

  return styles;
}

function parseDocxOutlineLevel(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) ? parsed : undefined;
}

function isDocxStructuralHeading(
  styleId: string | undefined,
  styleInfo: DocxStyleInfo | undefined,
  outlineLevel: number | undefined,
): boolean {
  const styleName = styleInfo?.name?.trim().toLowerCase();

  return (
    isSupportedDocxOutlineLevel(outlineLevel) ||
    Boolean(styleId && /^[1-6]$/u.test(styleId)) ||
    Boolean(styleName && /^heading\s+[1-6]$/u.test(styleName))
  );
}

function isSupportedDocxOutlineLevel(
  value: number | undefined,
): value is number {
  return (
    value !== undefined && Number.isInteger(value) && value >= 0 && value <= 5
  );
}

function isDocxTocStyle(
  styleId: string | undefined,
  styleInfo: DocxStyleInfo | undefined,
): boolean {
  const styleName = styleInfo?.name?.trim().toLowerCase();

  return (
    Boolean(styleName && /^toc\s+\d+$/u.test(styleName)) ||
    Boolean(styleId && /^(?:toc)?[1-9]0$/iu.test(styleId))
  );
}

function decodeHtmlText(value: string): string {
  return decodeXmlText(value)
    .replace(/&nbsp;/giu, " ")
    .replace(/&#(\d+);/gu, (_, codePoint: string) =>
      String.fromCodePoint(Number(codePoint)),
    )
    .replace(/&#x([a-f0-9]+);/giu, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    );
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function isLikelyDocxCoverTitle(text: string): boolean {
  return text.length > 0 && text.length <= 80 && !/[。；;：:]$/u.test(text);
}

function isLikelyDocxOutlineHeading(text: string): boolean {
  return text.length > 0 && text.length <= 80;
}

function normalizeDocxHeadingComparisonText(text: string): string {
  return text
    .replace(/\\(.)/gu, (escaped, character: string) =>
      markdownEscapableCharacters.has(character) ? character : escaped,
    )
    .replace(/\s+/gu, " ")
    .trim();
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/u, "").trim() || "Imported document";
}

function buildSearchSnippet(contentText: string, query: string) {
  const text = normalizeSearchText(contentText);
  const normalizedQuery = normalizeSearchText(query);

  if (text.length <= MCP_DOCUMENT_SEARCH_SNIPPET_MAX_LENGTH) {
    return text;
  }

  const matchIndex = normalizedQuery
    ? text.toLowerCase().indexOf(normalizedQuery.toLowerCase())
    : -1;
  const anchor = matchIndex >= 0 ? matchIndex : 0;
  const queryLength = matchIndex >= 0 ? normalizedQuery.length : 0;
  const contextBudget = Math.max(
    0,
    MCP_DOCUMENT_SEARCH_SNIPPET_MAX_LENGTH - queryLength,
  );
  let start = Math.max(0, anchor - Math.floor(contextBudget / 2));
  let end = Math.min(
    text.length,
    start + MCP_DOCUMENT_SEARCH_SNIPPET_MAX_LENGTH,
  );

  start = Math.max(
    0,
    Math.min(start, Math.max(0, end - MCP_DOCUMENT_SEARCH_SNIPPET_MAX_LENGTH)),
  );
  end = Math.min(text.length, start + MCP_DOCUMENT_SEARCH_SNIPPET_MAX_LENGTH);

  return `${start > 0 ? "..." : ""}${text.slice(start, end).trim()}${
    end < text.length ? "..." : ""
  }`;
}

function normalizeSearchText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
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

function throwRequirementDocumentContentBypass(): never {
  throw new ApiException(
    "VALIDATION_ERROR",
    "Requirement content and title must be updated through requirement APIs",
    HttpStatus.BAD_REQUEST,
  );
}

function throwRequirementDocumentStateBypass(): never {
  throw new ApiException(
    "VALIDATION_ERROR",
    "Requirement documents must be archived, deleted or cancelled through requirement APIs",
    HttpStatus.BAD_REQUEST,
  );
}

function throwInvalidDocumentKind(message: string): never {
  throw new ApiException("VALIDATION_ERROR", message, HttpStatus.BAD_REQUEST);
}

function throwHtmlImportFailed(reason: string): never {
  throw new ApiException(
    "DOCUMENT_IMPORT_FAILED",
    "HTML import failed",
    HttpStatus.BAD_REQUEST,
    { reason },
  );
}
