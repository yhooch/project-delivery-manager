import { z } from "zod";
import {
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import {
  PrioritySchema,
  RequirementStatusSchema,
  StatusCategorySchema,
  WorkItemTypeSchema,
} from "./enums.ts";
import { PermissionSnapshotSchema } from "./workflow.ts";

export const TiptapJsonSchema = z.record(z.string(), z.unknown());

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

export const RequirementSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    versionId: UlidSchema.optional(),
    title: z.string().max(200),
    summary: z.string().max(2000).optional(),
    contentJson: TiptapJsonSchema,
    contentText: z.string().max(20000).optional(),
    contentMarkdownCache: z.string().max(20000).optional(),
    contentFormat: z.literal("TIPTAP_JSON"),
    status: RequirementStatusSchema,
    priority: PrioritySchema.optional(),
    ownerId: UlidSchema.optional(),
    attachments: z.array(AttachmentRefSchema).optional(),
    permissions: PermissionSnapshotSchema.optional(),
    relatedWorkItems: RequirementRelatedWorkItemsSchema,
  })
  .strict();

export type Requirement = z.infer<typeof RequirementSchema>;

export const CreateRequirementDraftRequestSchema = z
  .object({
    versionId: UlidSchema.optional(),
  })
  .strict();

export type CreateRequirementDraftRequest = z.infer<
  typeof CreateRequirementDraftRequestSchema
>;

export const SaveRequirementRequestSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.string().max(2000).optional(),
    contentJson: TiptapJsonSchema,
    contentText: z.string().max(20000).optional(),
    contentMarkdownCache: z.string().max(20000).optional(),
    versionId: UlidSchema.optional(),
    priority: PrioritySchema.optional(),
    ownerId: UlidSchema.optional(),
  })
  .strict();

export type SaveRequirementRequest = z.infer<
  typeof SaveRequirementRequestSchema
>;

export const ArchiveRequirementRequestSchema = z
  .object({
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

export const RequirementListQuerySchema = PageQuerySchema.extend({
  versionId: UlidSchema.optional(),
  status: RequirementStatusSchema.optional(),
  ownerId: UlidSchema.optional(),
  includeDrafts: z.coerce.boolean().optional(),
});

export const ListRequirementsResponseSchema =
  pageResultSchema(RequirementSchema);
export const CreateRequirementDraftResponseSchema = RequirementSchema;
export const GetRequirementResponseSchema = RequirementSchema;
export const UpdateRequirementResponseSchema = RequirementSchema;
