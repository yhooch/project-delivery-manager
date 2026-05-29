import { z } from "zod";
import {
  EmptyObjectSchema,
  IsoDateTimeSchema,
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import {
  DocumentContentFormatSchema,
  DocumentStatusSchema,
  PrioritySchema,
  RequirementStatusSchema,
  StatusCategorySchema,
  WorkItemTypeSchema,
} from "./enums.ts";
import {
  TagFilterQuerySchema,
  TagIdListSchema,
  TagListSchema,
} from "./tag.ts";
import { DisplayIdentitySchema } from "./object-code.ts";
import { PermissionSnapshotSchema } from "./workflow.ts";
import {
  containsBase64ImageData,
  TiptapJsonSchema,
} from "./document.ts";
export { containsBase64ImageData, TiptapJsonSchema } from "./document.ts";

const BaseRevisionSchema = z.coerce.number().int().positive();
const RequirementContentTextSchema = z
  .string()
  .max(20000)
  .refine((value) => !containsBase64ImageData(value), {
    message: "content text must not contain base64 image data",
  });

export const RequirementContentFormatSchema = DocumentContentFormatSchema;
export type RequirementContentFormat = z.infer<
  typeof RequirementContentFormatSchema
>;

export const AttachmentRefSchema = z
  .object({
    id: UlidSchema,
    fileName: z.string().min(1),
    fileKey: z.string().min(1),
    mimeType: z.string().min(1),
    size: z.number().int().positive(),
    previewUrl: z.url().optional(),
  })
  .strict();

export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

export const RequirementRelatedWorkItemSummarySchema = z
  .object({
    id: UlidSchema,
    sequence: DisplayIdentitySchema.shape.sequence,
    displayCode: DisplayIdentitySchema.shape.displayCode,
    type: WorkItemTypeSchema,
    title: z.string().min(1).max(200),
    versionId: UlidSchema.optional(),
    assigneeId: UlidSchema.optional(),
    statusCategory: StatusCategorySchema.optional(),
  })
  .strict();

export type RequirementRelatedWorkItemSummary = z.infer<
  typeof RequirementRelatedWorkItemSummarySchema
>;

export const RequirementRelatedWorkItemsSchema = z
  .object({
    taskCount: z.number().int().min(0),
    bugCount: z.number().int().min(0),
    tasks: z.array(RequirementRelatedWorkItemSummarySchema),
    bugs: z.array(RequirementRelatedWorkItemSummarySchema),
  })
  .strict();

export type RequirementRelatedWorkItems = z.infer<
  typeof RequirementRelatedWorkItemsSchema
>;

const RequirementBaseSchema = z.object({
  id: UlidSchema,
  organizationId: UlidSchema,
  spaceId: UlidSchema,
  sequence: DisplayIdentitySchema.shape.sequence,
  displayCode: DisplayIdentitySchema.shape.displayCode,
  revision: z.number().int().positive().optional(),
  versionId: UlidSchema.optional(),
  kind: z.literal("REQUIREMENT").default("REQUIREMENT"),
  title: z.string().max(200),
  summary: z.string().max(2000).optional(),
  contentText: RequirementContentTextSchema.optional(),
  status: DocumentStatusSchema,
  priority: PrioritySchema.optional(),
  ownerId: UlidSchema.optional(),
  authorId: UlidSchema.optional(),
  attachments: z.array(AttachmentRefSchema).optional(),
  tags: TagListSchema,
  permissions: PermissionSnapshotSchema.optional(),
  relatedWorkItems: RequirementRelatedWorkItemsSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

const TiptapRequirementSchema = RequirementBaseSchema.extend({
  contentFormat: z.literal("TIPTAP_JSON"),
  contentJson: TiptapJsonSchema,
  contentMarkdown: z.never().optional(),
  contentMarkdownCache: RequirementContentTextSchema.optional(),
}).strict();

const MarkdownRequirementSchema = RequirementBaseSchema.extend({
  contentFormat: z.literal("MARKDOWN"),
  contentJson: z.never().optional(),
  contentMarkdown: RequirementContentTextSchema,
  contentMarkdownCache: z.never().optional(),
}).strict();

export const RequirementSchema = z.discriminatedUnion("contentFormat", [
  TiptapRequirementSchema,
  MarkdownRequirementSchema,
]);

export type Requirement = z.infer<typeof RequirementSchema>;

const SaveRequirementBaseSchema = z
  .object({
    baseRevision: BaseRevisionSchema,
    title: z.string().min(1).max(200),
    summary: z.string().max(2000).optional(),
    contentFormat: RequirementContentFormatSchema.optional(),
    contentJson: TiptapJsonSchema.optional(),
    contentMarkdown: RequirementContentTextSchema.optional(),
    contentText: RequirementContentTextSchema.optional(),
    contentMarkdownCache: RequirementContentTextSchema.optional(),
    versionId: UlidSchema.nullable().optional(),
    cascadeVersionChange: z.boolean().optional(),
    priority: PrioritySchema.optional(),
    ownerId: UlidSchema.optional(),
  })
  .strict();

export const SaveRequirementRequestSchema =
  SaveRequirementBaseSchema.superRefine((value, context) => {
    const contentFormat =
      value.contentFormat ??
      (value.contentMarkdown !== undefined && value.contentJson === undefined
        ? "MARKDOWN"
        : "TIPTAP_JSON");

    if (contentFormat === "TIPTAP_JSON" && value.contentJson === undefined) {
      context.addIssue({
        code: "custom",
        message: "contentJson is required for TIPTAP_JSON requirements",
        path: ["contentJson"],
      });
    }

    if (
      contentFormat === "TIPTAP_JSON" &&
      value.contentMarkdown !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "contentMarkdown is only valid for MARKDOWN requirements",
        path: ["contentMarkdown"],
      });
    }

    if (
      contentFormat === "MARKDOWN" &&
      (value.contentMarkdown === undefined ||
        value.contentMarkdown.trim().length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "contentMarkdown is required for MARKDOWN requirements",
        path: ["contentMarkdown"],
      });
    }

    if (contentFormat === "MARKDOWN" && value.contentJson !== undefined) {
      context.addIssue({
        code: "custom",
        message: "contentJson is only valid for TIPTAP_JSON requirements",
        path: ["contentJson"],
      });
    }

    if (
      contentFormat === "MARKDOWN" &&
      value.contentMarkdownCache !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message:
          "contentMarkdownCache is only a TIPTAP_JSON export cache, not MARKDOWN source",
        path: ["contentMarkdownCache"],
      });
    }
  });

export type SaveRequirementRequest = z.infer<
  typeof SaveRequirementRequestSchema
>;

const CreateRequirementDraftBodySchema = z
  .object({
    contentFormat: RequirementContentFormatSchema.optional(),
    versionId: UlidSchema.optional(),
    tagIds: TagIdListSchema.optional(),
  })
  .strict();

export const CreateRequirementDraftRequestSchema =
  CreateRequirementDraftBodySchema.default({});

export type CreateRequirementDraftRequest = z.infer<
  typeof CreateRequirementDraftRequestSchema
>;

export const ArchiveRequirementRequestSchema = z
  .object({
    baseRevision: BaseRevisionSchema,
    status: z.literal("ARCHIVED"),
  })
  .strict();

export type ArchiveRequirementRequest = z.infer<
  typeof ArchiveRequirementRequestSchema
>;

export const UpdateRequirementRequestSchema = z.union([
  SaveRequirementRequestSchema,
  ArchiveRequirementRequestSchema,
]);
export type UpdateRequirementRequest = z.infer<
  typeof UpdateRequirementRequestSchema
>;

export const RequirementListQuerySchema = PageQuerySchema.merge(
  TagFilterQuerySchema,
).extend({
  query: z.string().trim().min(1).max(200).optional(),
  versionId: UlidSchema.optional(),
  status: z.union([DocumentStatusSchema, RequirementStatusSchema]).optional(),
  ownerId: UlidSchema.optional(),
  includeDrafts: z.coerce.boolean().optional(),
});

export const RequirementStatusCountSchema = z
  .object({
    status: DocumentStatusSchema,
    count: z.number().int().min(0),
  })
  .strict();

export type RequirementStatusCount = z.infer<
  typeof RequirementStatusCountSchema
>;

export const ListRequirementsResponseSchema = pageResultSchema(
  RequirementSchema,
).extend({
  statusCounts: z.array(RequirementStatusCountSchema).optional(),
});

export type ListRequirementsResponse = z.infer<
  typeof ListRequirementsResponseSchema
>;
export const CreateRequirementDraftResponseSchema = RequirementSchema;
export type CreateRequirementDraftResponse = z.infer<
  typeof CreateRequirementDraftResponseSchema
>;
export const GetRequirementResponseSchema = RequirementSchema;
export type GetRequirementResponse = z.infer<
  typeof GetRequirementResponseSchema
>;
export const UpdateRequirementResponseSchema = RequirementSchema;
export type UpdateRequirementResponse = z.infer<
  typeof UpdateRequirementResponseSchema
>;
export const DeleteRequirementDraftResponseSchema = EmptyObjectSchema;
export type DeleteRequirementDraftResponse = z.infer<
  typeof DeleteRequirementDraftResponseSchema
>;
