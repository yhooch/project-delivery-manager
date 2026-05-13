import { z } from "zod";
import {
  IsoDateTimeSchema,
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import {
  BugSeveritySchema,
  PrioritySchema,
  StatusCategorySchema,
  WorkItemTypeSchema,
} from "./enums.ts";
import { PermissionSnapshotSchema } from "./workflow.ts";

export const WorkItemSchema = z
  .object({
    id: UlidSchema,
    type: WorkItemTypeSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    versionId: UlidSchema.optional(),
    requirementId: UlidSchema.optional(),
    intakeItemId: UlidSchema.optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(8000).optional(),
    priority: PrioritySchema,
    assigneeId: UlidSchema.optional(),
    reporterId: UlidSchema,
    workflowVersionId: UlidSchema,
    currentStateId: UlidSchema,
    statusCategory: StatusCategorySchema,
    dueDate: IsoDateTimeSchema.optional(),
    lastStatusChangedAt: IsoDateTimeSchema,
    lastActionAt: IsoDateTimeSchema.optional(),
    blockedReason: z.string().max(1000).optional(),
    blockedAt: IsoDateTimeSchema.optional(),
    permissions: PermissionSnapshotSchema.optional(),
  })
  .strict();

export type WorkItem = z.infer<typeof WorkItemSchema>;

export const WorkItemDetailSchema = WorkItemSchema.extend({
  permissions: PermissionSnapshotSchema,
}).strict();

export type WorkItemDetail = z.infer<typeof WorkItemDetailSchema>;

export const CreateWorkItemRequestSchema = z
  .object({
    type: z.literal("TASK").default("TASK"),
    versionId: UlidSchema.optional(),
    requirementId: UlidSchema.optional(),
    intakeItemId: UlidSchema.optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(8000).optional(),
    priority: PrioritySchema.default("MEDIUM"),
    assigneeId: UlidSchema.optional(),
    workflowVersionId: UlidSchema.optional(),
    dueDate: IsoDateTimeSchema.optional(),
  })
  .strict();

export type CreateWorkItemRequest = z.infer<typeof CreateWorkItemRequestSchema>;

export const UpdateWorkItemRequestSchema = z
  .object({
    versionId: UlidSchema.optional(),
    requirementId: UlidSchema.optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(8000).optional(),
    priority: PrioritySchema.optional(),
    assigneeId: UlidSchema.optional(),
    dueDate: IsoDateTimeSchema.optional(),
    blockedReason: z.string().max(1000).optional(),
  })
  .strict();

export type UpdateWorkItemRequest = z.infer<typeof UpdateWorkItemRequestSchema>;

export const BugDetailSchema = z
  .object({
    workItemId: UlidSchema,
    severity: BugSeveritySchema,
    stepsToReproduce: z.string().max(8000).optional(),
    expectedResult: z.string().max(8000).optional(),
    actualResult: z.string().max(8000).optional(),
    fixNote: z.string().max(8000).optional(),
    regressionResult: z.string().max(8000).optional(),
    regressionBy: UlidSchema.optional(),
    regressionAt: IsoDateTimeSchema.optional(),
    relatedTaskId: UlidSchema.optional(),
  })
  .strict();

export type BugDetail = z.infer<typeof BugDetailSchema>;

export const BugViewSchema = WorkItemSchema.extend({
  type: z.literal("BUG"),
  bugDetail: BugDetailSchema,
}).strict();

export type BugView = z.infer<typeof BugViewSchema>;

export const CreateBugRequestSchema = CreateWorkItemRequestSchema.omit({
  type: true,
}).extend({
  severity: BugSeveritySchema,
  stepsToReproduce: z.string().max(8000).optional(),
  expectedResult: z.string().max(8000).optional(),
  actualResult: z.string().max(8000).optional(),
  relatedTaskId: UlidSchema.optional(),
});

export type CreateBugRequest = z.infer<typeof CreateBugRequestSchema>;

export const UpdateBugRequestSchema = UpdateWorkItemRequestSchema.extend({
  severity: BugSeveritySchema.optional(),
  stepsToReproduce: z.string().max(8000).optional(),
  expectedResult: z.string().max(8000).optional(),
  actualResult: z.string().max(8000).optional(),
  fixNote: z.string().max(8000).optional(),
  regressionResult: z.string().max(8000).optional(),
  regressionBy: UlidSchema.optional(),
  regressionAt: IsoDateTimeSchema.optional(),
  relatedTaskId: UlidSchema.optional(),
});

export type UpdateBugRequest = z.infer<typeof UpdateBugRequestSchema>;

export const WorkItemListQuerySchema = PageQuerySchema.extend({
  type: z.literal("TASK").optional(),
  versionId: UlidSchema.optional(),
  requirementId: UlidSchema.optional(),
  intakeItemId: UlidSchema.optional(),
  reporterId: UlidSchema.optional(),
  assigneeId: UlidSchema.optional(),
  statusCategory: StatusCategorySchema.optional(),
  priority: PrioritySchema.optional(),
});

export const ListWorkItemsResponseSchema = pageResultSchema(WorkItemSchema);
export const CreateWorkItemResponseSchema = WorkItemSchema;
export const GetWorkItemResponseSchema = WorkItemDetailSchema;
export const UpdateWorkItemResponseSchema = WorkItemSchema;

export const BugListQuerySchema = PageQuerySchema.extend({
  type: z.literal("BUG").optional(),
  versionId: UlidSchema.optional(),
  requirementId: UlidSchema.optional(),
  intakeItemId: UlidSchema.optional(),
  reporterId: UlidSchema.optional(),
  assigneeId: UlidSchema.optional(),
  statusCategory: StatusCategorySchema.optional(),
  priority: PrioritySchema.optional(),
  severity: BugSeveritySchema.optional(),
  relatedTaskId: UlidSchema.optional(),
});
export const ListBugsResponseSchema = pageResultSchema(BugViewSchema);
export const CreateBugResponseSchema = BugViewSchema;
export const GetBugResponseSchema = BugViewSchema;
export const UpdateBugResponseSchema = BugViewSchema;
