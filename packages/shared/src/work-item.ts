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
  type StatusCategory,
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
    versionId: UlidSchema.nullable().optional(),
    requirementId: UlidSchema.nullable().optional(),
    intakeItemId: UlidSchema.nullable().optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(8000).nullable().optional(),
    priority: PrioritySchema.optional(),
    assigneeId: UlidSchema.nullable().optional(),
    dueDate: IsoDateTimeSchema.nullable().optional(),
    blockedReason: z.never().optional(),
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

export const BugDetailViewSchema = BugViewSchema.extend({
  permissions: PermissionSnapshotSchema,
}).strict();

export type BugDetailView = z.infer<typeof BugDetailViewSchema>;

export const BugLifecycleFilterBuckets = [
  "pendingConfirm",
  "pendingFix",
  "fixing",
  "pendingRegression",
  "regressionPassed",
  "closed",
] as const;

export const BugLifecycleBucketSchema = z.enum([
  "all",
  ...BugLifecycleFilterBuckets,
]);
export const BugLifecycleFilterBucketSchema = z.enum(BugLifecycleFilterBuckets);

export type BugLifecycleBucket = z.infer<typeof BugLifecycleBucketSchema>;
export type BugLifecycleFilterBucket = z.infer<
  typeof BugLifecycleFilterBucketSchema
>;

export const BugLifecycleBucketStateCodes = {
  pendingConfirm: ["PENDING_CONFIRMATION"],
  pendingFix: ["PENDING_FIX"],
  fixing: ["FIXING"],
  pendingRegression: ["PENDING_REGRESSION"],
  regressionPassed: ["REGRESSION_PASSED"],
  closed: ["CLOSED"],
} as const satisfies Record<BugLifecycleFilterBucket, readonly string[]>;

// Pending regression must come from an explicit workflow state, not VERIFYING alone.
export const BugLifecycleBucketFallbackStatusCategories = {
  pendingConfirm: ["NOT_STARTED"],
  pendingFix: ["WAITING"],
  fixing: ["IN_PROGRESS", "VERIFYING"],
  pendingRegression: [],
  regressionPassed: ["DONE"],
  closed: ["TERMINATED"],
} as const satisfies Record<
  BugLifecycleFilterBucket,
  readonly StatusCategory[]
>;

export function resolveBugLifecycleBucket(input: {
  stateCode?: string;
  statusCategory: StatusCategory;
}): BugLifecycleFilterBucket {
  const normalized = input.stateCode?.trim().toUpperCase();

  if (normalized) {
    const match = BugLifecycleFilterBuckets.find((bucket) =>
      (BugLifecycleBucketStateCodes[bucket] as readonly string[]).includes(
        normalized,
      ),
    );
    if (match) {
      return match;
    }
  }

  const fallbackMatch = BugLifecycleFilterBuckets.find((bucket) => {
    const fallbackCategories = BugLifecycleBucketFallbackStatusCategories[
      bucket
    ] as readonly StatusCategory[];

    return fallbackCategories.includes(input.statusCategory);
  });

  if (fallbackMatch) {
    return fallbackMatch;
  }

  return "fixing";
}

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
  stepsToReproduce: z.string().max(8000).nullable().optional(),
  expectedResult: z.string().max(8000).nullable().optional(),
  actualResult: z.string().max(8000).nullable().optional(),
  relatedTaskId: UlidSchema.nullable().optional(),
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
  lifecycleBucket: BugLifecycleFilterBucketSchema.optional(),
});

export const WorkItemStatusCategoryCountSchema = z
  .object({
    statusCategory: StatusCategorySchema,
    count: z.number().int().min(0),
  })
  .strict();

export type WorkItemStatusCategoryCount = z.infer<
  typeof WorkItemStatusCategoryCountSchema
>;

export const BugLifecycleBucketCountSchema = z
  .object({
    bucket: BugLifecycleFilterBucketSchema,
    count: z.number().int().min(0),
  })
  .strict();

export type BugLifecycleBucketCount = z.infer<
  typeof BugLifecycleBucketCountSchema
>;

export const ListWorkItemsResponseSchema = pageResultSchema(
  WorkItemSchema,
).extend({
  statusCategoryCounts: z.array(WorkItemStatusCategoryCountSchema).optional(),
});

export type ListWorkItemsResponse = z.infer<typeof ListWorkItemsResponseSchema>;

export const ListBugsResponseSchema = pageResultSchema(BugViewSchema).extend({
  lifecycleBucketCounts: z.array(BugLifecycleBucketCountSchema).optional(),
  statusCategoryCounts: z.array(WorkItemStatusCategoryCountSchema).optional(),
});

export type ListBugsResponse = z.infer<typeof ListBugsResponseSchema>;
export const CreateBugResponseSchema = BugViewSchema;
export const GetBugResponseSchema = BugDetailViewSchema;
export const UpdateBugResponseSchema = BugViewSchema;
