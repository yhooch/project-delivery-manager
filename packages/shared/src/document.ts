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
const DocumentMarkdownSchema = z
  .string()
  .min(1)
  .max(DocumentMaxMarkdownBytes)
  .refine((value) => !containsBase64ImageData(value), {
    message: "document markdown must not contain base64 image data",
  });
const DocumentTextSchema = z.string().max(DocumentMaxMarkdownBytes);
const BaseRevisionSchema = z.coerce.number().int().positive();

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
).extend({
  query: z.string().trim().min(1).max(200).optional(),
  status: DocumentStatusSchema.optional(),
  sourceType: DocumentSourceTypeSchema.optional(),
  lastEditedVia: DocumentActorTypeSchema.optional(),
  createdById: UlidSchema.optional(),
  linkedTargetType: DocumentLinkTargetTypeSchema.optional(),
  linkedTargetId: UlidSchema.optional(),
});
export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export const PasteDocumentRequestSchema = z
  .object({
    title: DocumentTitleSchema.optional(),
    contentMarkdown: DocumentMarkdownSchema,
    sourceType: z.enum(["PASTE_MARKDOWN", "PASTE_TEXT"]).default("PASTE_MARKDOWN"),
    tagIds: TagIdListSchema.optional(),
    links: z.array(DocumentLinkTargetSchema).max(100).optional(),
  })
  .strict();
export type PasteDocumentRequest = z.infer<typeof PasteDocumentRequestSchema>;

export const ImportMarkdownDocumentRequestSchema = z
  .object({
    title: DocumentTitleSchema.optional(),
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
export const CreateDocumentResponseSchema = DocumentSchema;
export const GetDocumentResponseSchema = DocumentDetailSchema;
export const UpdateDocumentMetadataResponseSchema = DocumentSchema;
export const UpdateDocumentContentResponseSchema = DocumentSchema;
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
