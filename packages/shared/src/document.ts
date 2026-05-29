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
  DocumentContentFormatSchema,
  DocumentKindSchema,
  DocumentLinkTargetTypeSchema,
  DocumentSourceTypeSchema,
  DocumentStatusSchema,
  PrioritySchema,
  TimelineEventTypeSchema,
  WorkItemTypeSchema,
} from "./enums.ts";
import { DisplayIdentitySchema } from "./object-code.ts";
import { TagFilterQuerySchema, TagIdListSchema, TagListSchema } from "./tag.ts";

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
const TiptapJsonRecordSchema = z.record(z.string(), z.unknown());

export const DocumentFolderMaxDepth = 6;

export const TiptapJsonSchema = TiptapJsonRecordSchema.superRefine(
  (value, context) => {
    if (containsBase64ImageData(value)) {
      context.addIssue({
        code: "custom",
        message: "contentJson must not contain base64 image data",
      });
      return;
    }

    if (isEmptyRecord(value) || isValidTiptapNode(value, true)) {
      return;
    }

    context.addIssue({
      code: "custom",
      message: "contentJson must be a Tiptap JSON document",
    });
  },
);

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
    kind: DocumentKindSchema.default("GENERAL"),
    title: DocumentTitleSchema,
    summary: z.string().max(2000).optional(),
    contentFormat: DocumentContentFormatSchema.default("MARKDOWN"),
    contentJson: TiptapJsonSchema.optional(),
    contentMarkdown: DocumentMarkdownSchema.optional(),
    contentMarkdownCache: DocumentTextSchema.optional(),
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

const DocumentBaseSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    folderId: UlidSchema.optional(),
    folderPath: z.array(DocumentFolderPathItemSchema).optional(),
    kind: DocumentKindSchema.default("GENERAL"),
    sequence: DisplayIdentitySchema.shape.sequence,
    displayCode: DisplayIdentitySchema.shape.displayCode,
    versionId: UlidSchema.optional(),
    title: DocumentTitleSchema,
    summary: z.string().max(2000).optional(),
    contentFormat: DocumentContentFormatSchema.default("MARKDOWN"),
    contentJson: TiptapJsonSchema.optional(),
    contentMarkdown: DocumentMarkdownSchema.optional(),
    contentMarkdownCache: DocumentTextSchema.optional(),
    contentText: DocumentTextSchema,
    sourceType: DocumentSourceTypeSchema,
    sourceAttachmentId: UlidSchema.optional(),
    status: DocumentStatusSchema,
    revision: z.number().int().positive(),
    priority: PrioritySchema.optional(),
    ownerId: UlidSchema.optional(),
    authorId: UlidSchema.optional(),
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

export const DocumentSchema = DocumentBaseSchema.superRefine(
  (value, context) => {
    if (value.contentFormat === "TIPTAP_JSON") {
      if (value.contentJson === undefined) {
        context.addIssue({
          code: "custom",
          message: "contentJson is required for TIPTAP_JSON documents",
          path: ["contentJson"],
        });
      }

      if (value.contentMarkdown !== undefined) {
        context.addIssue({
          code: "custom",
          message: "contentMarkdown is only valid for MARKDOWN documents",
          path: ["contentMarkdown"],
        });
      }

      return;
    }

    if (
      value.contentMarkdown === undefined ||
      value.contentMarkdown.trim().length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "contentMarkdown is required for MARKDOWN documents",
        path: ["contentMarkdown"],
      });
    }

    if (value.contentJson !== undefined) {
      context.addIssue({
        code: "custom",
        message: "contentJson is only valid for TIPTAP_JSON documents",
        path: ["contentJson"],
      });
    }

    if (value.contentMarkdownCache !== undefined) {
      context.addIssue({
        code: "custom",
        message:
          "contentMarkdownCache is only a TIPTAP_JSON export cache, not MARKDOWN source",
        path: ["contentMarkdownCache"],
      });
    }
  },
);
export type Document = z.infer<typeof DocumentSchema>;

export const DocumentListItemSchema = DocumentBaseSchema.omit({
  chunks: true,
  contentMarkdown: true,
  contentJson: true,
  contentMarkdownCache: true,
  contentText: true,
})
  .extend({
    contentSnippet: z.string().min(1).max(400).optional(),
  })
  .strict();
export type DocumentListItem = z.infer<typeof DocumentListItemSchema>;

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
    eventType: TimelineEventTypeSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type DocumentTimelineOverview = z.infer<
  typeof DocumentTimelineOverviewSchema
>;

export const DocumentDetailSchema = DocumentSchema.extend({
  attachments: z.array(DocumentAttachmentOverviewSchema),
  attachmentTotal: z.number().int().min(0),
  comments: z.array(DocumentCommentOverviewSchema),
  commentTotal: z.number().int().min(0),
  timeline: z.array(DocumentTimelineOverviewSchema),
  timelineTotal: z.number().int().min(0),
}).strict();
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;

export const DocumentListQuerySchema = PageQuerySchema.merge(
  TagFilterQuerySchema,
)
  .extend({
    query: z.string().trim().min(1).max(200).optional(),
    kind: DocumentKindSchema.optional(),
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
    sourceType: z
      .enum(["PASTE_MARKDOWN", "PASTE_TEXT"])
      .default("PASTE_MARKDOWN"),
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
  .union([
    z
      .object({
        baseRevision: BaseRevisionSchema,
        contentFormat: z.literal("MARKDOWN").optional(),
        contentMarkdown: DocumentMarkdownSchema,
      })
      .strict(),
    z
      .object({
        baseRevision: BaseRevisionSchema,
        contentFormat: z.literal("TIPTAP_JSON"),
        contentJson: TiptapJsonSchema,
        contentMarkdownCache: DocumentTextSchema.optional(),
        contentText: DocumentTextSchema.optional(),
      })
      .strict(),
  ]);
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

export const ConvertDocumentToRequirementRequestSchema = z
  .object({
    activate: z.boolean().optional(),
    baseRevision: BaseRevisionSchema,
    summary: z.string().max(2000).optional(),
    title: DocumentTitleSchema.optional(),
    versionId: UlidSchema.nullable().optional(),
    priority: PrioritySchema.optional(),
    ownerId: UlidSchema.optional(),
  })
  .strict();
export type ConvertDocumentToRequirementRequest = z.infer<
  typeof ConvertDocumentToRequirementRequestSchema
>;

export const CancelRequirementReferenceModeSchema = z.enum([
  "REJECT_IF_REFERENCED",
  "UNLINK_REFERENCES",
]);
export type CancelRequirementReferenceMode = z.infer<
  typeof CancelRequirementReferenceModeSchema
>;

export const CancelRequirementRequestSchema = z
  .object({
    baseRevision: BaseRevisionSchema,
    reason: z.string().trim().min(1).max(2000).optional(),
    referenceMode: CancelRequirementReferenceModeSchema,
  })
  .strict();
export type CancelRequirementRequest = z.infer<
  typeof CancelRequirementRequestSchema
>;

export const CancelRequirementPreflightResponseSchema = z
  .object({
    canCancel: z.boolean(),
    referenceCount: z.number().int().min(0),
    modeRequired: CancelRequirementReferenceModeSchema.optional(),
  })
  .strict();
export type CancelRequirementPreflightResponse = z.infer<
  typeof CancelRequirementPreflightResponseSchema
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

export const ListDocumentsResponseSchema = pageResultSchema(
  DocumentListItemSchema,
);
export type ListDocumentsResponse = z.infer<typeof ListDocumentsResponseSchema>;
export const ListDocumentFoldersResponseSchema = z
  .object({
    items: z.array(DocumentFolderTreeNodeSchema),
  })
  .strict();
export type ListDocumentFoldersResponse = z.infer<
  typeof ListDocumentFoldersResponseSchema
>;
export const CreateDocumentFolderResponseSchema = DocumentFolderSchema;
export type CreateDocumentFolderResponse = z.infer<
  typeof CreateDocumentFolderResponseSchema
>;
export const UpdateDocumentFolderResponseSchema = DocumentFolderSchema;
export type UpdateDocumentFolderResponse = z.infer<
  typeof UpdateDocumentFolderResponseSchema
>;
export const MoveDocumentFolderResponseSchema = DocumentFolderSchema;
export type MoveDocumentFolderResponse = z.infer<
  typeof MoveDocumentFolderResponseSchema
>;
export const ReorderDocumentFolderResponseSchema = DocumentFolderSchema;
export type ReorderDocumentFolderResponse = z.infer<
  typeof ReorderDocumentFolderResponseSchema
>;
export const ReorderDocumentFoldersResponseSchema =
  ListDocumentFoldersResponseSchema;
export type ReorderDocumentFoldersResponse = z.infer<
  typeof ReorderDocumentFoldersResponseSchema
>;
export const DeleteDocumentFolderResponseSchema = z.object({}).strict();
export type DeleteDocumentFolderResponse = z.infer<
  typeof DeleteDocumentFolderResponseSchema
>;
export const CreateDocumentResponseSchema = DocumentSchema;
export type CreateDocumentResponse = z.infer<
  typeof CreateDocumentResponseSchema
>;
export const GetDocumentResponseSchema = DocumentDetailSchema;
export type GetDocumentResponse = z.infer<typeof GetDocumentResponseSchema>;
export const UpdateDocumentMetadataResponseSchema = DocumentSchema;
export type UpdateDocumentMetadataResponse = z.infer<
  typeof UpdateDocumentMetadataResponseSchema
>;
export const UpdateDocumentContentResponseSchema = DocumentSchema;
export type UpdateDocumentContentResponse = z.infer<
  typeof UpdateDocumentContentResponseSchema
>;
export const MoveDocumentToFolderResponseSchema = DocumentSchema;
export type MoveDocumentToFolderResponse = z.infer<
  typeof MoveDocumentToFolderResponseSchema
>;
export const MoveDocumentsToFolderResponseSchema = z
  .object({
    items: z.array(DocumentSchema),
  })
  .strict();
export type MoveDocumentsToFolderResponse = z.infer<
  typeof MoveDocumentsToFolderResponseSchema
>;
export const ArchiveDocumentResponseSchema = DocumentSchema;
export type ArchiveDocumentResponse = z.infer<
  typeof ArchiveDocumentResponseSchema
>;
export const RestoreDocumentResponseSchema = DocumentSchema;
export type RestoreDocumentResponse = z.infer<
  typeof RestoreDocumentResponseSchema
>;
export const DeleteDocumentResponseSchema = z.object({}).strict();
export type DeleteDocumentResponse = z.infer<
  typeof DeleteDocumentResponseSchema
>;
export const ConvertDocumentToRequirementResponseSchema = DocumentSchema;
export type ConvertDocumentToRequirementResponse = z.infer<
  typeof ConvertDocumentToRequirementResponseSchema
>;
export const CancelRequirementResponseSchema = DocumentSchema;
export type CancelRequirementResponse = z.infer<
  typeof CancelRequirementResponseSchema
>;
export const ListDocumentRevisionsResponseSchema = pageResultSchema(
  DocumentRevisionSchema,
);
export type ListDocumentRevisionsResponse = z.infer<
  typeof ListDocumentRevisionsResponseSchema
>;
export const ListDocumentLinksResponseSchema = z
  .object({
    items: z.array(DocumentLinkSchema),
  })
  .strict();
export type ListDocumentLinksResponse = z.infer<
  typeof ListDocumentLinksResponseSchema
>;
export const ReplaceDocumentLinksResponseSchema =
  ListDocumentLinksResponseSchema;
export type ReplaceDocumentLinksResponse = z.infer<
  typeof ReplaceDocumentLinksResponseSchema
>;
export const ListDocumentChunksResponseSchema =
  pageResultSchema(DocumentChunkSchema);
export type ListDocumentChunksResponse = z.infer<
  typeof ListDocumentChunksResponseSchema
>;
export const ListDocumentLinksByTargetResponseSchema =
  pageResultSchema(DocumentLinkSchema);
export type ListDocumentLinksByTargetResponse = z.infer<
  typeof ListDocumentLinksByTargetResponseSchema
>;

export function containsBase64ImageData(value: unknown): boolean {
  if (typeof value === "string") {
    return /data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64(?:,|$)/iu.test(
      value,
    );
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsBase64ImageData(item));
  }

  if (!isPlainRecord(value)) {
    return false;
  }

  return Object.values(value).some((item) => containsBase64ImageData(item));
}

function isValidTiptapNode(
  value: unknown,
  isRoot = false,
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return false;
  }

  if (
    !Object.keys(value).every((key) =>
      ["attrs", "content", "marks", "text", "type"].includes(key),
    )
  ) {
    return false;
  }

  if (typeof value.type !== "string" || value.type.trim().length === 0) {
    return false;
  }

  if (isRoot && value.type !== "doc") {
    return false;
  }

  if ("text" in value && typeof value.text !== "string") {
    return false;
  }

  if (value.type === "text" && typeof value.text !== "string") {
    return false;
  }

  if ("attrs" in value && !isJsonCompatibleObject(value.attrs)) {
    return false;
  }

  if (
    "content" in value &&
    (!Array.isArray(value.content) ||
      !value.content.every((item) => isValidTiptapNode(item)))
  ) {
    return false;
  }

  if (
    "marks" in value &&
    (!Array.isArray(value.marks) ||
      !value.marks.every((item) => isValidTiptapMark(item)))
  ) {
    return false;
  }

  return true;
}

function isValidTiptapMark(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return false;
  }

  if (!Object.keys(value).every((key) => ["attrs", "type"].includes(key))) {
    return false;
  }

  return (
    typeof value.type === "string" &&
    value.type.trim().length > 0 &&
    (!("attrs" in value) || isJsonCompatibleObject(value.attrs))
  );
}

function isJsonCompatibleObject(value: unknown): boolean {
  return isPlainRecord(value) && isJsonCompatible(value);
}

function isJsonCompatible(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonCompatible(item));
  }

  if (isPlainRecord(value)) {
    return Object.values(value).every((item) => isJsonCompatible(item));
  }

  return false;
}

function isEmptyRecord(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
