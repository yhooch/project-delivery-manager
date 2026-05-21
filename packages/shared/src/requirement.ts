import { z } from "zod";
import {
  EmptyObjectSchema,
  IsoDateTimeSchema,
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
import {
  TagFilterQuerySchema,
  TagIdListSchema,
  TagListSchema,
} from "./tag.ts";
import { DisplayIdentitySchema } from "./object-code.ts";
import { PermissionSnapshotSchema } from "./workflow.ts";

const TiptapJsonRecordSchema = z.record(z.string(), z.unknown());
const RequirementContentTextSchema = z
  .string()
  .max(20000)
  .refine((value) => !containsBase64ImageData(value), {
    message: "content text must not contain base64 image data",
  });

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

export const RequirementSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    sequence: DisplayIdentitySchema.shape.sequence,
    displayCode: DisplayIdentitySchema.shape.displayCode,
    versionId: UlidSchema.optional(),
    title: z.string().max(200),
    summary: z.string().max(2000).optional(),
    contentJson: TiptapJsonSchema,
    contentText: RequirementContentTextSchema.optional(),
    contentMarkdownCache: RequirementContentTextSchema.optional(),
    contentFormat: z.literal("TIPTAP_JSON"),
    status: RequirementStatusSchema,
    priority: PrioritySchema.optional(),
    ownerId: UlidSchema.optional(),
    authorId: UlidSchema.optional(),
    attachments: z.array(AttachmentRefSchema).optional(),
    tags: TagListSchema,
    permissions: PermissionSnapshotSchema.optional(),
    relatedWorkItems: RequirementRelatedWorkItemsSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export type Requirement = z.infer<typeof RequirementSchema>;

const CreateRequirementDraftBodySchema = z
  .object({
    versionId: UlidSchema.optional(),
    tagIds: TagIdListSchema.optional(),
  })
  .strict();

export const CreateRequirementDraftRequestSchema =
  CreateRequirementDraftBodySchema.default({});

export type CreateRequirementDraftRequest = z.infer<
  typeof CreateRequirementDraftRequestSchema
>;

export const SaveRequirementRequestSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.string().max(2000).optional(),
    contentJson: TiptapJsonSchema,
    contentText: RequirementContentTextSchema.optional(),
    contentMarkdownCache: RequirementContentTextSchema.optional(),
    versionId: UlidSchema.nullable().optional(),
    cascadeVersionChange: z.boolean().optional(),
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

export const RequirementListQuerySchema = PageQuerySchema.merge(
  TagFilterQuerySchema,
).extend({
  query: z.string().trim().min(1).max(200).optional(),
  versionId: UlidSchema.optional(),
  status: RequirementStatusSchema.optional(),
  ownerId: UlidSchema.optional(),
  includeDrafts: z.coerce.boolean().optional(),
});

export const RequirementStatusCountSchema = z
  .object({
    status: RequirementStatusSchema,
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
export const GetRequirementResponseSchema = RequirementSchema;
export const UpdateRequirementResponseSchema = RequirementSchema;
export const DeleteRequirementDraftResponseSchema = EmptyObjectSchema;

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
