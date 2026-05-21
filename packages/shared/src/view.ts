import { z } from "zod";
import {
  IsoDateTimeSchema,
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import {
  PrioritySchema,
  StatusCategorySchema,
  ViewExceptionTypeSchema,
  WorkItemTypeSchema,
} from "./enums.ts";
import { SpaceOverviewSchema } from "./space.ts";
import { TagFilterQuerySchema, TagListSchema, TagMatchSchema } from "./tag.ts";
import { TimelineEventSchema } from "./timeline.ts";
import { DisplayIdentitySchema } from "./object-code.ts";
import { WorkflowActionSummarySchema } from "./workflow.ts";

export const ViewAppliedFiltersSchema = z
  .object({
    organizationId: UlidSchema.optional(),
    spaceId: UlidSchema.optional(),
    versionId: UlidSchema.optional(),
    assigneeId: UlidSchema.optional(),
    statusCategory: StatusCategorySchema.optional(),
    workItemType: WorkItemTypeSchema.optional(),
    exceptionType: ViewExceptionTypeSchema.optional(),
    tagIds: TagFilterQuerySchema.shape.tagIds.optional(),
    tagMatch: TagMatchSchema.optional(),
  })
  .strict();

export type ViewAppliedFilters = z.infer<typeof ViewAppliedFiltersSchema>;

export const WorkbenchViewQuerySchema = PageQuerySchema.extend({
  organizationId: UlidSchema,
  spaceId: UlidSchema.optional(),
  versionId: UlidSchema.optional(),
  assigneeId: UlidSchema.optional(),
  statusCategory: StatusCategorySchema.optional(),
  workItemType: WorkItemTypeSchema.optional(),
  exceptionType: ViewExceptionTypeSchema.optional(),
});

export type WorkbenchViewQuery = z.infer<typeof WorkbenchViewQuerySchema>;

export const SpaceOverviewViewQuerySchema = z
  .object({
    organizationId: UlidSchema.optional(),
    versionId: UlidSchema.optional(),
  })
  .strict();

export type SpaceOverviewViewQuery = z.infer<
  typeof SpaceOverviewViewQuerySchema
>;

export const VersionBoardViewQuerySchema = PageQuerySchema.extend({
  organizationId: UlidSchema.optional(),
  spaceId: UlidSchema.optional(),
  assigneeId: UlidSchema.optional(),
  statusCategory: StatusCategorySchema.optional(),
  columnStatusCategory: StatusCategorySchema.optional(),
  workItemType: WorkItemTypeSchema.optional(),
});

export type VersionBoardViewQuery = z.infer<typeof VersionBoardViewQuerySchema>;

export const SpaceExceptionsViewQuerySchema = PageQuerySchema.extend({
  organizationId: UlidSchema.optional(),
  versionId: UlidSchema.optional(),
  assigneeId: UlidSchema.optional(),
  statusCategory: StatusCategorySchema.optional(),
  workItemType: WorkItemTypeSchema.optional(),
  exceptionType: ViewExceptionTypeSchema.optional(),
  tagIds: TagFilterQuerySchema.shape.tagIds.optional(),
  tagMatch: TagMatchSchema.optional(),
});

export type SpaceExceptionsViewQuery = z.infer<
  typeof SpaceExceptionsViewQuerySchema
>;

export const ViewCurrentStatusSummarySchema = z
  .object({
    workflowVersionId: UlidSchema,
    currentStateId: UlidSchema,
    stateCode: z.string().min(1).max(80),
    stateName: z.string().min(1).max(120),
    statusCategory: StatusCategorySchema,
    lastStatusChangedAt: IsoDateTimeSchema,
    exceptionHints: z
      .object({
        blocked: z.boolean(),
        pendingConfirm: z.boolean(),
        pendingRegression: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type ViewCurrentStatusSummary = z.infer<
  typeof ViewCurrentStatusSummarySchema
>;

export const ViewExceptionEvidenceSourceSchema = z.enum([
  "DUE_DATE",
  "WORKFLOW_STATE",
  "ACTION_REQUIRED",
  "LAST_STATUS_CHANGED_AT",
]);

export type ViewExceptionEvidenceSource = z.infer<
  typeof ViewExceptionEvidenceSourceSchema
>;

export const ViewExceptionSignalSchema = z
  .object({
    type: ViewExceptionTypeSchema,
    evidenceSource: ViewExceptionEvidenceSourceSchema,
    reason: z.string().min(1).max(500),
    dueDate: IsoDateTimeSchema.optional(),
    blockedReason: z.string().max(1000).optional(),
    blockedAt: IsoDateTimeSchema.optional(),
    currentStateId: UlidSchema.optional(),
    lastStatusChangedAt: IsoDateTimeSchema.optional(),
    staleThresholdDays: z.number().int().min(1).max(30).optional(),
    staleDays: z.number().int().min(0).optional(),
  })
  .strict();

export type ViewExceptionSignal = z.infer<typeof ViewExceptionSignalSchema>;

export const ViewWorkItemSummarySchema = z
  .object({
    id: UlidSchema,
    sequence: DisplayIdentitySchema.shape.sequence,
    displayCode: DisplayIdentitySchema.shape.displayCode,
    type: WorkItemTypeSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    versionId: UlidSchema.optional(),
    requirementId: UlidSchema.optional(),
    intakeItemId: UlidSchema.optional(),
    title: z.string().min(1).max(200),
    priority: PrioritySchema,
    assigneeId: UlidSchema.optional(),
    reporterId: UlidSchema,
    createdAt: IsoDateTimeSchema.optional(),
    createdById: UlidSchema.optional(),
    dueDate: IsoDateTimeSchema.optional(),
    lastActionAt: IsoDateTimeSchema.optional(),
    currentStatus: ViewCurrentStatusSummarySchema,
    exceptionSignals: z.array(ViewExceptionSignalSchema),
    tags: TagListSchema.optional(),
  })
  .strict();

export type ViewWorkItemSummary = z.infer<typeof ViewWorkItemSummarySchema>;

export const WorkbenchActionReasonCodeSchema = z.enum([
  "ASSIGNED_TO_ME",
  "REPORTED_BY_ME",
  "SPACE_ROLE_MATCHED",
  "EXPLICIT_PARTICIPANT",
  "WORKFLOW_POLICY",
]);

export type WorkbenchActionReasonCode = z.infer<
  typeof WorkbenchActionReasonCodeSchema
>;

export const WorkbenchActionTodoSchema = z
  .object({
    id: z.string().min(1),
    workItem: ViewWorkItemSummarySchema,
    currentStatus: ViewCurrentStatusSummarySchema,
    availableAction: WorkflowActionSummarySchema,
    actionTarget: z
      .object({
        workItemId: UlidSchema,
        actionId: UlidSchema,
        executePath: z.string().min(1),
      })
      .strict(),
    reason: z
      .object({
        code: WorkbenchActionReasonCodeSchema,
        description: z.string().min(1).max(500),
      })
      .strict(),
  })
  .strict();

export type WorkbenchActionTodo = z.infer<typeof WorkbenchActionTodoSchema>;

export const ViewRecentActivitySchema = TimelineEventSchema;
export type ViewRecentActivity = z.infer<typeof ViewRecentActivitySchema>;

export const WorkbenchWorkItemSectionSchema = z
  .object({
    title: z.string().min(1).max(120),
    total: z.number().int().min(0),
    items: pageResultSchema(ViewWorkItemSummarySchema),
  })
  .strict();

export type WorkbenchWorkItemSection = z.infer<
  typeof WorkbenchWorkItemSectionSchema
>;

export const WorkbenchActionTodoSectionSchema = z
  .object({
    title: z.string().min(1).max(120),
    total: z.number().int().min(0),
    items: pageResultSchema(WorkbenchActionTodoSchema),
  })
  .strict();

export type WorkbenchActionTodoSection = z.infer<
  typeof WorkbenchActionTodoSectionSchema
>;

export const WorkbenchRecentActivitySectionSchema = z
  .object({
    title: z.string().min(1).max(120),
    total: z.number().int().min(0),
    items: pageResultSchema(ViewRecentActivitySchema),
  })
  .strict();

export type WorkbenchRecentActivitySection = z.infer<
  typeof WorkbenchRecentActivitySectionSchema
>;

export const WorkbenchSectionsSchema = z
  .object({
    myTodos: WorkbenchWorkItemSectionSchema,
    assignedTasks: WorkbenchWorkItemSectionSchema,
    assignedBugs: WorkbenchWorkItemSectionSchema,
    actionTodos: WorkbenchActionTodoSectionSchema,
    pendingConfirm: WorkbenchWorkItemSectionSchema,
    dueSoon: WorkbenchWorkItemSectionSchema,
    blocked: WorkbenchWorkItemSectionSchema,
    recentActivities: WorkbenchRecentActivitySectionSchema,
  })
  .strict();

export type WorkbenchSections = z.infer<typeof WorkbenchSectionsSchema>;

export const WorkbenchViewStatsSchema = z
  .object({
    assignedWorkItemCount: z.number().int().min(0),
    actionTodoCount: z.number().int().min(0),
    overdueCount: z.number().int().min(0),
    blockedCount: z.number().int().min(0),
    pendingConfirmCount: z.number().int().min(0),
    pendingRegressionCount: z.number().int().min(0),
    staleCount: z.number().int().min(0),
  })
  .strict();

export type WorkbenchViewStats = z.infer<typeof WorkbenchViewStatsSchema>;

export const GetMyWorkbenchViewResponseSchema = z
  .object({
    filters: ViewAppliedFiltersSchema,
    stats: WorkbenchViewStatsSchema,
    sections: WorkbenchSectionsSchema,
    actionTodos: pageResultSchema(WorkbenchActionTodoSchema).optional(),
    workItems: pageResultSchema(ViewWorkItemSummarySchema).optional(),
  })
  .strict();

export type GetMyWorkbenchViewResponse = z.infer<
  typeof GetMyWorkbenchViewResponseSchema
>;

export const ViewStatusCountSchema = z
  .object({
    statusCategory: StatusCategorySchema,
    count: z.number().int().min(0),
  })
  .strict();

export type ViewStatusCount = z.infer<typeof ViewStatusCountSchema>;

export const ViewWorkItemTypeCountSchema = z
  .object({
    workItemType: WorkItemTypeSchema,
    count: z.number().int().min(0),
  })
  .strict();

export type ViewWorkItemTypeCount = z.infer<typeof ViewWorkItemTypeCountSchema>;

export const ViewExceptionCountSchema = z
  .object({
    exceptionType: ViewExceptionTypeSchema,
    count: z.number().int().min(0),
  })
  .strict();

export type ViewExceptionCount = z.infer<typeof ViewExceptionCountSchema>;

export const GetSpaceOverviewViewResponseSchema = SpaceOverviewSchema.extend({
  filters: ViewAppliedFiltersSchema.optional(),
  statusCounts: z.array(ViewStatusCountSchema).optional(),
  taskStatusCounts: z.array(ViewStatusCountSchema).optional(),
  bugStatusCounts: z.array(ViewStatusCountSchema).optional(),
  workItemTypeCounts: z.array(ViewWorkItemTypeCountSchema).optional(),
  exceptionCounts: z.array(ViewExceptionCountSchema).optional(),
  recentActivities: pageResultSchema(ViewRecentActivitySchema).optional(),
  staleThresholdDays: z.number().int().min(1).max(30).optional(),
}).strict();

export type GetSpaceOverviewViewResponse = z.infer<
  typeof GetSpaceOverviewViewResponseSchema
>;

export const VersionBoardColumnSchema = z
  .object({
    statusCategory: StatusCategorySchema,
    title: z.string().min(1).max(120),
    total: z.number().int().min(0),
    items: pageResultSchema(ViewWorkItemSummarySchema),
  })
  .strict();

export type VersionBoardColumn = z.infer<typeof VersionBoardColumnSchema>;

export const GetVersionBoardViewResponseSchema = z
  .object({
    filters: ViewAppliedFiltersSchema,
    columns: z.array(VersionBoardColumnSchema),
  })
  .strict();

export type GetVersionBoardViewResponse = z.infer<
  typeof GetVersionBoardViewResponseSchema
>;

export const SpaceExceptionItemSchema = z
  .object({
    workItem: ViewWorkItemSummarySchema,
    currentStatus: ViewCurrentStatusSummarySchema,
    exceptions: z.array(ViewExceptionSignalSchema).min(1),
  })
  .strict();

export type SpaceExceptionItem = z.infer<typeof SpaceExceptionItemSchema>;

export const GetSpaceExceptionsViewResponseSchema = z
  .object({
    filters: ViewAppliedFiltersSchema,
    counts: z.array(ViewExceptionCountSchema),
    items: pageResultSchema(SpaceExceptionItemSchema),
  })
  .strict();

export type GetSpaceExceptionsViewResponse = z.infer<
  typeof GetSpaceExceptionsViewResponseSchema
>;
