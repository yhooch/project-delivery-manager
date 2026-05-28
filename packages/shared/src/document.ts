import { z } from "zod";
import {
  IsoDateTimeSchema,
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import {
  DocumentActorTypeSchema,
  DocumentChangeTypeSchema,
  DocumentLinkTargetTypeSchema,
  DocumentSourceTypeSchema,
  DocumentStatusSchema,
  WorkItemTypeSchema,
} from "./enums.ts";
import {
  TagFilterQuerySchema,
  TagIdListSchema,
  TagListSchema,
} from "./tag.ts";

export const DocumentMaxImportSizeBytes = 20 * 1024 * 1024;
export const DocumentMaxMarkdownBytes = 2 * 1024 * 1024;
export const DocumentSupportedMarkdownMimeTypes = [
  "text/markdown",
  "text/plain",
  "application/octet-stream",
] as const;
export const DocumentSupportedDocxMimeTypes = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
] as const;

const DocumentTitleSchema = z.string().trim().min(1).max(200);
const DocumentFolderNameSchema = z.string().trim().min(1).max(120);
const DocumentFolderVersionSchema = z.coerce.number().int().positive();
const DocumentMarkdownSchema = z
  .string()
  .min(1)
  .max(DocumentMaxMarkdownBytes)
  .refine((value) => !containsBase64ImageData(value), {
    message: "document markdown must not contain base64 image data",
  });
const DocumentTextSchema = z.string().max(DocumentMaxMarkdownBytes);
const BaseRevisionSchema = z.coerce.number().int().positive();

export const DocumentFolderMaxDepth = 6;

export const DocumentFolderPathItemSchema = z
  .object({
    id: UlidSchema,
    name: DocumentFolderNameSchema,
  })
  .strict();
export type DocumentFolderPathItem = z.infer<
  typeof DocumentFolderPathItemSchema
>;

export const DocumentFolderSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    parentId: UlidSchema.optional(),
    name: DocumentFolderNameSchema,
    sortOrder: z.number().int().min(0),
    depth: z.number().int().min(0).max(DocumentFolderMaxDepth),
    version: z.number().int().positive(),
    createdById: UlidSchema,
    updatedById: UlidSchema,
    deletedAt: IsoDateTimeSchema.optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();
export type DocumentFolder = z.infer<typeof DocumentFolderSchema>;

export type DocumentFolderTreeNode = DocumentFolder & {
  children: DocumentFolderTreeNode[];
  descendantDocumentCount: number;
  documentCount: number;
};

export const DocumentFolderTreeNodeSchema: z.ZodType<DocumentFolderTreeNode> =
  DocumentFolderSchema.extend({
    children: z.lazy(() => z.array(DocumentFolderTreeNodeSchema)),
    descendantDocumentCount: z.number().int().min(0),
    documentCount: z.number().int().min(0),
  }).strict();

export const DocumentLinkTargetSchema = z
  .object({
    targetType: DocumentLinkTargetTypeSchema,
    targetId: UlidSchema,
  })
  .strict();
export type DocumentLinkTarget = z.infer<typeof DocumentLinkTargetSchema>;

export const DocumentLinkSchema = DocumentLinkTargetSchema.extend({
  id: UlidSchema,
  organizationId: UlidSchema,
  spaceId: UlidSchema,
  documentId: UlidSchema,
  displayCode: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(200).optional(),
  workItemType: WorkItemTypeSchema.optional(),
  createdById: UlidSchema,
  createdAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.optional(),
}).strict();
export type DocumentLink = z.infer<typeof DocumentLinkSchema>;

export const DocumentChunkSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    documentId: UlidSchema,
    revision: z.number().int().positive(),
    ordinal: z.number().int().min(0),
    headingPath: z.string().min(1).max(1000).optional(),
    contentText: z.string().min(1),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;

export const DocumentRevisionSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    documentId: UlidSchema,
    revision: z.number().int().positive(),
    title: DocumentTitleSchema,
    contentMarkdown: DocumentMarkdownSchema,
    contentText: DocumentTextSchema,
    changeType: DocumentChangeTypeSchema,
    actorType: DocumentActorTypeSchema,
    actorUserId: UlidSchema,
    mcpClientId: z.string().min(1).max(200).optional(),
    requestId: z.string().min(1).max(128).optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type DocumentRevision = z.infer<typeof DocumentRevisionSchema>;

export const DocumentSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    folderId: UlidSchema.optional(),
    folderPath: z.array(DocumentFolderPathItemSchema).optional(),
    title: DocumentTitleSchema,
    contentMarkdown: DocumentMarkdownSchema,
    contentText: DocumentTextSchema,
    sourceType: DocumentSourceTypeSchema,
    sourceAttachmentId: UlidSchema.optional(),
    status: DocumentStatusSchema,
    revision: z.number().int().positive(),
    createdById: UlidSchema,
    createdByName: z.string().min(1).max(200).optional(),
    createdVia: DocumentActorTypeSchema,
    createdMcpClientId: z.string().min(1).max(200).optional(),
    createdMcpClientName: z.string().min(1).max(200).optional(),
    lastEditedById: UlidSchema,
    lastEditedByName: z.string().min(1).max(200).optional(),
    lastEditedVia: DocumentActorTypeSchema,
    lastEditedMcpClientId: z.string().min(1).max(200).optional(),
    lastEditedMcpClientName: z.string().min(1).max(200).optional(),
    lastEditedAt: IsoDateTimeSchema,
    archivedAt: IsoDateTimeSchema.optional(),
    deletedAt: IsoDateTimeSchema.optional(),
    tags: TagListSchema.optional(),
    links: z.array(DocumentLinkSchema).optional(),
    chunks: z.array(DocumentChunkSchema).optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();
export type Document = z.infer<typeof DocumentSchema>;

export const DocumentCommentOverviewSchema = z
  .object({
    id: UlidSchema,
    authorName: z.string().min(1).max(200).optional(),
    body: z.string().min(1).max(8000),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type DocumentCommentOverview = z.infer<
  typeof DocumentCommentOverviewSchema
>;

export const DocumentAttachmentOverviewSchema = z
  .object({
    id: UlidSchema,
    fileName: z.string().min(1),
    size: z.number().int().positive().optional(),
  })
  .strict();
export type DocumentAttachmentOverview = z.infer<
  typeof DocumentAttachmentOverviewSchema
>;

export const DocumentTimelineOverviewSchema = z
  .object({
    id: UlidSchema,
    actorName: z.string().min(1).max(200).optional(),
    changeType: z.string().min(1).max(200),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type DocumentTimelineOverview = z.infer<
  typeof DocumentTimelineOverviewSchema
>;

export const DocumentDetailSchema = DocumentSchema.extend({
  attachments: z.array(DocumentAttachmentOverviewSchema),
  comments: z.array(DocumentCommentOverviewSchema),
  timeline: z.array(DocumentTimelineOverviewSchema),
}).strict();
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;

export const DocumentListQuerySchema = PageQuerySchema.merge(
  TagFilterQuerySchema,
)
  .extend({
    query: z.string().trim().min(1).max(200).optional(),
    status: DocumentStatusSchema.optional(),
    sourceType: DocumentSourceTypeSchema.optional(),
    lastEditedVia: DocumentActorTypeSchema.optional(),
    createdById: UlidSchema.optional(),
    folderId: UlidSchema.optional(),
    includeDescendants: z.coerce.boolean().optional(),
    unfiled: z.coerce.boolean().optional(),
    linkedTargetType: DocumentLinkTargetTypeSchema.optional(),
    linkedTargetId: UlidSchema.optional(),
  })
  .refine((value) => !(value.folderId && value.unfiled === true), {
    message: "folderId and unfiled cannot be used together",
  });
export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export const PasteDocumentRequestSchema = z
  .object({
    title: DocumentTitleSchema.optional(),
    contentMarkdown: DocumentMarkdownSchema,
    sourceType: z.enum(["PASTE_MARKDOWN", "PASTE_TEXT"]).default("PASTE_MARKDOWN"),
    folderId: UlidSchema.optional(),
    tagIds: TagIdListSchema.optional(),
    links: z.array(DocumentLinkTargetSchema).max(100).optional(),
  })
  .strict();
export type PasteDocumentRequest = z.infer<typeof PasteDocumentRequestSchema>;

export const ImportMarkdownDocumentRequestSchema = z
  .object({
    title: DocumentTitleSchema.optional(),
    folderId: UlidSchema.optional(),
    tagIds: TagIdListSchema.optional(),
    links: z.array(DocumentLinkTargetSchema).max(100).optional(),
  })
  .strict();
export type ImportMarkdownDocumentRequest = z.infer<
  typeof ImportMarkdownDocumentRequestSchema
>;

export const ImportDocxDocumentRequestSchema =
  ImportMarkdownDocumentRequestSchema;
export type ImportDocxDocumentRequest = z.infer<
  typeof ImportDocxDocumentRequestSchema
>;

export const UpdateDocumentMetadataRequestSchema = z
  .object({
    baseRevision: BaseRevisionSchema.optional(),
    title: DocumentTitleSchema.optional(),
    tagIds: TagIdListSchema.optional(),
    links: z.array(DocumentLinkTargetSchema).max(100).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.tagIds !== undefined ||
      value.links !== undefined,
    { message: "at least one metadata field is required" },
  );
export type UpdateDocumentMetadataRequest = z.infer<
  typeof UpdateDocumentMetadataRequestSchema
>;

export const UpdateDocumentContentRequestSchema = z
  .object({
    baseRevision: BaseRevisionSchema,
    contentMarkdown: DocumentMarkdownSchema,
  })
  .strict();
export type UpdateDocumentContentRequest = z.infer<
  typeof UpdateDocumentContentRequestSchema
>;

export const AppendDocumentContentRequestSchema = z
  .object({
    baseRevision: BaseRevisionSchema,
    appendMarkdown: DocumentMarkdownSchema,
  })
  .strict();
export type AppendDocumentContentRequest = z.infer<
  typeof AppendDocumentContentRequestSchema
>;

export const ReimportDocumentRequestSchema = z
  .object({
    baseRevision: BaseRevisionSchema,
  })
  .strict();
export type ReimportDocumentRequest = z.infer<
  typeof ReimportDocumentRequestSchema
>;

export const ReplaceDocumentLinksRequestSchema = z
  .object({
    baseRevision: BaseRevisionSchema,
    links: z.array(DocumentLinkTargetSchema).max(100),
  })
  .strict();
export type ReplaceDocumentLinksRequest = z.infer<
  typeof ReplaceDocumentLinksRequestSchema
>;

export const CreateDocumentFolderRequestSchema = z
  .object({
    name: DocumentFolderNameSchema,
    parentId: UlidSchema.optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();
export type CreateDocumentFolderRequest = z.infer<
  typeof CreateDocumentFolderRequestSchema
>;

export const UpdateDocumentFolderRequestSchema = z
  .object({
    name: DocumentFolderNameSchema.optional(),
    version: DocumentFolderVersionSchema.optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined, {
    message: "at least one folder field is required",
  });
export type UpdateDocumentFolderRequest = z.infer<
  typeof UpdateDocumentFolderRequestSchema
>;

export const MoveDocumentFolderRequestSchema = z
  .object({
    parentId: UlidSchema.nullable().optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    version: DocumentFolderVersionSchema.optional(),
  })
  .strict();
export type MoveDocumentFolderRequest = z.infer<
  typeof MoveDocumentFolderRequestSchema
>;

export const ReorderDocumentFolderRequestSchema = z
  .object({
    sortOrder: z.coerce.number().int().min(0),
    version: DocumentFolderVersionSchema.optional(),
  })
  .strict();
export type ReorderDocumentFolderRequest = z.infer<
  typeof ReorderDocumentFolderRequestSchema
>;

export const MoveDocumentToFolderRequestSchema = z
  .object({
    folderId: UlidSchema.nullable().optional(),
    baseRevision: BaseRevisionSchema.optional(),
  })
  .strict();
export type MoveDocumentToFolderRequest = z.infer<
  typeof MoveDocumentToFolderRequestSchema
>;

export const MoveDocumentsToFolderRequestSchema = z
  .object({
    documentIds: z
      .array(UlidSchema)
      .min(1)
      .max(100)
      .refine((value) => new Set(value).size === value.length, {
        message: "documentIds must be unique",
      }),
    folderId: UlidSchema.nullable().optional(),
  })
  .strict();
export type MoveDocumentsToFolderRequest = z.infer<
  typeof MoveDocumentsToFolderRequestSchema
>;

export const ReorderDocumentFoldersRequestSchema = z
  .object({
    parentId: UlidSchema.nullable().optional(),
    orderedFolderIds: z
      .array(UlidSchema)
      .min(1)
      .max(500)
      .refine((value) => new Set(value).size === value.length, {
        message: "orderedFolderIds must be unique",
      }),
  })
  .strict();
export type ReorderDocumentFoldersRequest = z.infer<
  typeof ReorderDocumentFoldersRequestSchema
>;

export const DocumentLinksByTargetQuerySchema = z
  .object({
    targetType: DocumentLinkTargetTypeSchema,
    targetId: UlidSchema,
    page: PageQuerySchema.shape.page,
    pageSize: PageQuerySchema.shape.pageSize,
    sortBy: PageQuerySchema.shape.sortBy,
    sortOrder: PageQuerySchema.shape.sortOrder,
  })
  .strict();
export type DocumentLinksByTargetQuery = z.infer<
  typeof DocumentLinksByTargetQuerySchema
>;

export const ListDocumentsResponseSchema = pageResultSchema(DocumentSchema);
export const ListDocumentFoldersResponseSchema = z
  .object({
    items: z.array(DocumentFolderTreeNodeSchema),
  })
  .strict();
export const CreateDocumentFolderResponseSchema = DocumentFolderSchema;
export const UpdateDocumentFolderResponseSchema = DocumentFolderSchema;
export const MoveDocumentFolderResponseSchema = DocumentFolderSchema;
export const ReorderDocumentFolderResponseSchema = DocumentFolderSchema;
export const ReorderDocumentFoldersResponseSchema =
  ListDocumentFoldersResponseSchema;
export const DeleteDocumentFolderResponseSchema = z.object({}).strict();
export const CreateDocumentResponseSchema = DocumentSchema;
export const GetDocumentResponseSchema = DocumentDetailSchema;
export const UpdateDocumentMetadataResponseSchema = DocumentSchema;
export const UpdateDocumentContentResponseSchema = DocumentSchema;
export const MoveDocumentToFolderResponseSchema = DocumentSchema;
export const MoveDocumentsToFolderResponseSchema = z
  .object({
    items: z.array(DocumentSchema),
  })
  .strict();
export const ArchiveDocumentResponseSchema = DocumentSchema;
export const RestoreDocumentResponseSchema = DocumentSchema;
export const DeleteDocumentResponseSchema = z.object({}).strict();
export const ListDocumentRevisionsResponseSchema = pageResultSchema(
  DocumentRevisionSchema,
);
export const ListDocumentLinksResponseSchema = z
  .object({
    items: z.array(DocumentLinkSchema),
  })
  .strict();
export const ReplaceDocumentLinksResponseSchema =
  ListDocumentLinksResponseSchema;
export const ListDocumentChunksResponseSchema = pageResultSchema(
  DocumentChunkSchema,
);
export const ListDocumentLinksByTargetResponseSchema =
  pageResultSchema(DocumentLinkSchema);

function containsBase64ImageData(value: string): boolean {
  return /data:image\/[a-z0-9.+-]+;base64,/iu.test(value);
}
