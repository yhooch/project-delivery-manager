import { z } from "zod";

export const EmptyObjectSchema = z.object({}).strict();

export const RequestIdSchema = z.string().min(1);

export const UlidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/u, "Expected a 26-character ULID");

export const IsoDateTimeSchema = z.string().min(1);

export const ApiErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "INTERNAL_SERVER_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_ERROR",
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "ORGANIZATION_NOT_FOUND",
  "ORGANIZATION_ACCESS_DENIED",
  "CROSS_ORGANIZATION_ACCESS_DENIED",
  "ORGANIZATION_MEMBER_NOT_FOUND",
  "SPACE_NOT_FOUND",
  "SPACE_ACCESS_DENIED",
  "SPACE_MEMBER_NOT_FOUND",
  "SPACE_MEMBER_MUST_BELONG_TO_ORGANIZATION",
  "LAST_ORGANIZATION_OWNER_REQUIRED",
  "WORKFLOW_NOT_FOUND",
  "WORKFLOW_VERSION_NOT_FOUND",
  "WORKFLOW_VERSION_ALREADY_PUBLISHED",
  "WORKFLOW_VERSION_INVALID",
  "WORKFLOW_PUBLISH_VALIDATION_FAILED",
  "WORKFLOW_ACTION_NOT_AVAILABLE",
  "WORKFLOW_ACTION_STATE_CONFLICT",
  "WORKFLOW_ACTION_PERMISSION_DENIED",
  "WORKFLOW_ACTION_FORM_INVALID",
  "WORKFLOW_ACTION_COMMENT_REQUIRED",
  "SPACE_MEMBER_INVALID",
  "WORK_ITEM_NOT_FOUND",
  "REQUIREMENT_NOT_FOUND",
  "TARGET_REQUIRED_FOR_ATTACHMENT",
  "ATTACHMENT_TARGET_NOT_FOUND",
  "ATTACHMENT_LIMIT_EXCEEDED",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_MIME_TYPE",
  "DRAFT_REQUIREMENT_REQUIRED",
  "INTAKE_ITEM_NOT_FOUND",
  "INTAKE_ITEM_NOT_ACCEPTED",
  "INTAKE_ITEM_ALREADY_CONVERTED",
  "TRACE_VERSION_CONFLICT",
  "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
  "TRACE_CASCADE_CONFLICT",
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z
  .object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    details: z.unknown().optional(),
    requestId: RequestIdSchema,
  })
  .strict();

export type ApiError = z.infer<typeof ApiErrorSchema>;

export function apiResponseSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema,
) {
  return z
    .object({
      data: dataSchema,
      requestId: RequestIdSchema,
    })
    .strict();
}

export type ApiResponse<T> = {
  data: T;
  requestId: string;
};

export function pageResultSchema<TSchema extends z.ZodType>(
  itemSchema: TSchema,
) {
  return z
    .object({
      items: z.array(itemSchema),
      page: z.number().int().positive(),
      pageSize: z.number().int().positive().max(200),
      total: z.number().int().min(0),
    })
    .strict();
}

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export const PaginationQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(200).default(20),
  })
  .strict();

export const SortOrderSchema = z.enum(["asc", "desc"]);

export const SortQuerySchema = z
  .object({
    sortBy: z.string().min(1).optional(),
    sortOrder: SortOrderSchema.optional(),
  })
  .strict();

export const PageQuerySchema = PaginationQuerySchema.merge(SortQuerySchema);

export const IdPathParamsSchema = z
  .object({
    id: UlidSchema,
  })
  .strict();

export const OrganizationIdPathParamsSchema = z
  .object({
    organizationId: UlidSchema,
  })
  .strict();

export const SpaceIdPathParamsSchema = z
  .object({
    spaceId: UlidSchema,
  })
  .strict();

export const VersionIdPathParamsSchema = z
  .object({
    versionId: UlidSchema,
  })
  .strict();

export const RequirementIdPathParamsSchema = z
  .object({
    requirementId: UlidSchema,
  })
  .strict();

export const WorkItemIdPathParamsSchema = z
  .object({
    workItemId: UlidSchema,
  })
  .strict();

export const BugIdPathParamsSchema = z
  .object({
    bugId: UlidSchema,
  })
  .strict();

export const MemberIdPathParamsSchema = z
  .object({
    memberId: UlidSchema,
  })
  .strict();

export const WorkflowIdPathParamsSchema = z
  .object({
    workflowId: UlidSchema,
  })
  .strict();

export const WorkflowVersionIdPathParamsSchema = z
  .object({
    workflowVersionId: UlidSchema,
  })
  .strict();

export const WorkflowStateIdPathParamsSchema = z
  .object({
    stateId: UlidSchema,
  })
  .strict();

export const WorkflowActionIdPathParamsSchema = z
  .object({
    actionId: UlidSchema,
  })
  .strict();

export const ActionFormFieldIdPathParamsSchema = z
  .object({
    fieldId: UlidSchema,
  })
  .strict();

export const AttachmentIdPathParamsSchema = z
  .object({
    attachmentId: UlidSchema,
  })
  .strict();
