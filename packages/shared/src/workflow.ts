import { z } from "zod";
import {
  EmptyObjectSchema,
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import {
  ActionFormFieldTypeSchema,
  PrioritySchema,
  SpaceRoleSchema,
  StatusCategorySchema,
  WorkflowActorRelationSchema,
  WorkflowDefinitionStatusSchema,
  WorkflowVersionStatusSchema,
  WorkItemTypeSchema,
} from "./enums.ts";

export const ActionFormFieldSummarySchema = z
  .object({
    id: UlidSchema,
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    fieldType: ActionFormFieldTypeSchema,
    required: z.boolean(),
    options: z.array(z.string().min(1)).optional(),
    order: z.number().int().min(0),
  })
  .strict();

export type ActionFormFieldSummary = z.infer<
  typeof ActionFormFieldSummarySchema
>;

export const WorkflowActionSummarySchema = z
  .object({
    id: UlidSchema,
    code: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    fromStateId: UlidSchema,
    toStateId: UlidSchema,
    allowedSpaceRoles: z.array(SpaceRoleSchema),
    actorRelations: z.array(WorkflowActorRelationSchema),
    requiresComment: z.boolean(),
    formFields: z.array(ActionFormFieldSummarySchema),
    order: z.number().int().min(0),
  })
  .strict();

export type WorkflowActionSummary = z.infer<typeof WorkflowActionSummarySchema>;

export const PermissionSnapshotSchema = z
  .object({
    canEdit: z.boolean(),
    canComment: z.boolean(),
    canUploadAttachment: z.boolean(),
    availableActions: z.array(WorkflowActionSummarySchema),
  })
  .strict();

export type PermissionSnapshot = z.infer<typeof PermissionSnapshotSchema>;

export const WorkflowStateSchema = z
  .object({
    id: UlidSchema,
    workflowVersionId: UlidSchema,
    code: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    category: StatusCategorySchema,
    isStart: z.boolean(),
    isEnd: z.boolean(),
    order: z.number().int().min(0),
  })
  .strict();

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const WorkflowDefinitionSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    code: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    status: WorkflowDefinitionStatusSchema,
  })
  .strict();

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const WorkflowVersionSchema = z
  .object({
    id: UlidSchema,
    workflowId: UlidSchema,
    version: z.number().int().positive(),
    status: WorkflowVersionStatusSchema,
    publishedAt: z.string().min(1).optional(),
    states: z.array(WorkflowStateSchema),
    actions: z.array(WorkflowActionSummarySchema),
  })
  .strict();

export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;

export const WorkflowBindingSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    workflowId: UlidSchema,
    workItemType: WorkItemTypeSchema,
    workflowVersionId: UlidSchema,
    priority: PrioritySchema.optional(),
    isDefault: z.boolean(),
  })
  .strict();

export type WorkflowBinding = z.infer<typeof WorkflowBindingSchema>;

export const DefaultWorkflowCodeSchema = z.enum([
  "DEVELOPMENT_TASK",
  "GENERAL_TASK",
  "BUG",
]);

export type DefaultWorkflowCode = z.infer<typeof DefaultWorkflowCodeSchema>;

export const DefaultWorkflowSummarySchema = z
  .object({
    workflowId: UlidSchema,
    workflowVersionId: UlidSchema,
    code: DefaultWorkflowCodeSchema,
    name: z.string().min(1).max(120),
    workItemType: WorkItemTypeSchema,
    version: z.number().int().positive(),
    stateCount: z.number().int().min(0),
    actionCount: z.number().int().min(0),
    isDefault: z.boolean(),
    publishedAt: z.string().min(1).optional(),
  })
  .strict();

export type DefaultWorkflowSummary = z.infer<
  typeof DefaultWorkflowSummarySchema
>;

export const CreateWorkflowDefinitionRequestSchema = z
  .object({
    code: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
  })
  .strict();

export type CreateWorkflowDefinitionRequest = z.infer<
  typeof CreateWorkflowDefinitionRequestSchema
>;

export const UpdateWorkflowDefinitionRequestSchema =
  CreateWorkflowDefinitionRequestSchema.partial()
    .extend({
      status: WorkflowDefinitionStatusSchema.optional(),
    })
    .strict();

export type UpdateWorkflowDefinitionRequest = z.infer<
  typeof UpdateWorkflowDefinitionRequestSchema
>;

export const CreateWorkflowVersionRequestSchema = z
  .object({
    sourceWorkflowVersionId: UlidSchema.optional(),
  })
  .strict();

export type CreateWorkflowVersionRequest = z.infer<
  typeof CreateWorkflowVersionRequestSchema
>;

export const UpdateWorkflowVersionRequestSchema = z
  .object({
    status: WorkflowVersionStatusSchema.optional(),
  })
  .strict();

export const PublishWorkflowVersionRequestSchema = EmptyObjectSchema;

const WorkflowActionAllowedSpaceRoleSchema = z.enum([
  "SPACE_ADMIN",
  "PM",
  "DEVELOPER",
  "TESTER",
  "REQUIREMENT",
  "MEMBER",
]);

export const CreateWorkflowStateRequestSchema = z
  .object({
    code: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    category: StatusCategorySchema,
    isStart: z.boolean().optional(),
    isEnd: z.boolean().optional(),
    order: z.number().int().min(0).optional(),
  })
  .strict();

export const UpdateWorkflowStateRequestSchema =
  CreateWorkflowStateRequestSchema.partial();

export const CreateWorkflowActionRequestSchema = z
  .object({
    code: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    fromStateId: UlidSchema,
    toStateId: UlidSchema,
    requiresComment: z.boolean().optional(),
    allowedSpaceRoles: z.array(WorkflowActionAllowedSpaceRoleSchema).optional(),
    actorRelations: z.array(WorkflowActorRelationSchema).optional(),
    order: z.number().int().min(0).optional(),
  })
  .strict();

export const UpdateWorkflowActionRequestSchema =
  CreateWorkflowActionRequestSchema.partial();

export const CreateActionFormFieldRequestSchema = z
  .object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    fieldType: ActionFormFieldTypeSchema,
    required: z.boolean(),
    options: z.array(z.string().min(1)).optional(),
    order: z.number().int().min(0).optional(),
  })
  .strict();

export const UpdateActionFormFieldRequestSchema =
  CreateActionFormFieldRequestSchema.partial();

export const CreateWorkflowBindingRequestSchema = z
  .object({
    workflowId: UlidSchema.optional(),
    workItemType: WorkItemTypeSchema,
    workflowVersionId: UlidSchema,
    priority: PrioritySchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const UpdateWorkflowBindingRequestSchema =
  CreateWorkflowBindingRequestSchema.partial();

export const ExecuteActionRequestSchema = z
  .object({
    comment: z.string().max(4000).optional(),
    formValues: z.record(z.string(), z.unknown()),
  })
  .strict();

export type ExecuteActionRequest = z.infer<typeof ExecuteActionRequestSchema>;

export const ListWorkflowsQuerySchema = PageQuerySchema;
export const ListWorkflowsResponseSchema = pageResultSchema(
  WorkflowDefinitionSchema,
);
export const ListWorkflowVersionsQuerySchema = PageQuerySchema;
export const ListWorkflowVersionsResponseSchema = pageResultSchema(
  WorkflowVersionSchema,
);
export const CreateWorkflowDefinitionResponseSchema = WorkflowDefinitionSchema;
export const GetWorkflowDefinitionResponseSchema = WorkflowDefinitionSchema;
export const UpdateWorkflowDefinitionResponseSchema = WorkflowDefinitionSchema;
export const CreateWorkflowVersionResponseSchema = WorkflowVersionSchema;
export const GetWorkflowVersionResponseSchema = WorkflowVersionSchema;
export const UpdateWorkflowVersionResponseSchema = WorkflowVersionSchema;
export const PublishWorkflowVersionResponseSchema = WorkflowVersionSchema;
export const CreateWorkflowStateResponseSchema = WorkflowStateSchema;
export const UpdateWorkflowStateResponseSchema = WorkflowStateSchema;
export const DeleteWorkflowStateResponseSchema = EmptyObjectSchema;
export const CreateWorkflowActionResponseSchema = WorkflowActionSummarySchema;
export const UpdateWorkflowActionResponseSchema = WorkflowActionSummarySchema;
export const DeleteWorkflowActionResponseSchema = EmptyObjectSchema;
export const CreateActionFormFieldResponseSchema = ActionFormFieldSummarySchema;
export const UpdateActionFormFieldResponseSchema = ActionFormFieldSummarySchema;
export const DeleteActionFormFieldResponseSchema = EmptyObjectSchema;
export const ListWorkflowBindingsQuerySchema = PageQuerySchema.extend({
  workflowId: UlidSchema.optional(),
  workflowVersionId: UlidSchema.optional(),
  workItemType: WorkItemTypeSchema.optional(),
  priority: PrioritySchema.optional(),
  isDefault: z.coerce.boolean().optional(),
});
export const ListDefaultWorkflowSummariesQuerySchema = PageQuerySchema;
export const ListDefaultWorkflowSummariesResponseSchema = pageResultSchema(
  DefaultWorkflowSummarySchema,
);
export const ListWorkflowBindingsResponseSchema = pageResultSchema(
  WorkflowBindingSchema,
);
export const CreateWorkflowBindingResponseSchema = WorkflowBindingSchema;
export const UpdateWorkflowBindingResponseSchema = WorkflowBindingSchema;
