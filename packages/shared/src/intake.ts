import { z } from "zod";
import {
  IsoDateTimeSchema,
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import {
  IntakeSourceTypeSchema,
  IntakeStatusSchema,
  PrioritySchema,
} from "./enums.ts";
import { WorkItemSchema } from "./work-item.ts";

export const IntakeSourceObjectSchema = z.record(z.string(), z.unknown());
export type IntakeSourceObject = z.infer<typeof IntakeSourceObjectSchema>;

export const IntakeItemSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    versionId: UlidSchema.optional(),
    requirementId: UlidSchema.optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(8000).optional(),
    sourceType: IntakeSourceTypeSchema,
    sourceObject: IntakeSourceObjectSchema.optional(),
    status: IntakeStatusSchema,
    priority: PrioritySchema.optional(),
    reporterId: UlidSchema,
    assigneeId: UlidSchema.optional(),
    acceptedAt: IsoDateTimeSchema.optional(),
    convertedAt: IsoDateTimeSchema.optional(),
    updatedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export type IntakeItem = z.infer<typeof IntakeItemSchema>;

export const CreateIntakeItemRequestSchema = z
  .object({
    versionId: UlidSchema.optional(),
    requirementId: UlidSchema.optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(8000).optional(),
    sourceType: IntakeSourceTypeSchema,
    sourceObject: IntakeSourceObjectSchema.optional(),
    priority: PrioritySchema.optional(),
    assigneeId: UlidSchema.optional(),
  })
  .strict();

export type CreateIntakeItemRequest = z.infer<
  typeof CreateIntakeItemRequestSchema
>;

export const UpdateIntakeItemRequestSchema = z
  .object({
    versionId: UlidSchema.optional(),
    requirementId: UlidSchema.optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(8000).optional(),
    sourceType: IntakeSourceTypeSchema.optional(),
    sourceObject: IntakeSourceObjectSchema.optional(),
    priority: PrioritySchema.optional(),
    assigneeId: UlidSchema.optional(),
  })
  .strict();

export type UpdateIntakeItemRequest = z.infer<
  typeof UpdateIntakeItemRequestSchema
>;

export const IntakeTaskInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(8000).optional(),
    versionId: UlidSchema.optional(),
    requirementId: UlidSchema.optional(),
    priority: PrioritySchema.optional(),
    assigneeId: UlidSchema.optional(),
    dueDate: IsoDateTimeSchema.optional(),
    workflowVersionId: UlidSchema.optional(),
  })
  .strict();

export type IntakeTaskInput = z.infer<typeof IntakeTaskInputSchema>;

export const ConvertIntakeItemToWorkItemsRequestSchema = z
  .object({
    tasks: z.array(IntakeTaskInputSchema).min(1),
  })
  .strict();

export type ConvertIntakeItemToWorkItemsRequest = z.infer<
  typeof ConvertIntakeItemToWorkItemsRequestSchema
>;

export const ConvertIntakeItemToWorkItemsResponseSchema = z
  .object({
    intakeItemId: UlidSchema,
    workItems: z.array(WorkItemSchema),
  })
  .strict();

export type ConvertIntakeItemToWorkItemsResponse = z.infer<
  typeof ConvertIntakeItemToWorkItemsResponseSchema
>;

export const IntakeItemListQuerySchema = PageQuerySchema.extend({
  versionId: UlidSchema.optional(),
  requirementId: UlidSchema.optional(),
  status: IntakeStatusSchema.optional(),
  sourceType: IntakeSourceTypeSchema.optional(),
  priority: PrioritySchema.optional(),
  reporterId: UlidSchema.optional(),
  assigneeId: UlidSchema.optional(),
});

export const ListIntakeItemsResponseSchema = pageResultSchema(IntakeItemSchema);
export const CreateIntakeItemResponseSchema = IntakeItemSchema;
export const GetIntakeItemResponseSchema = IntakeItemSchema;
export const UpdateIntakeItemResponseSchema = IntakeItemSchema;
export const AcceptIntakeItemResponseSchema = IntakeItemSchema;
export const DeferIntakeItemResponseSchema = IntakeItemSchema;
export const RejectIntakeItemResponseSchema = IntakeItemSchema;
