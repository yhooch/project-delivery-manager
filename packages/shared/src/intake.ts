import { z } from "zod";
import {
  IsoDateTimeSchema,
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import { IntakeStatusSchema, PrioritySchema } from "./enums.ts";
import { WorkItemSchema } from "./work-item.ts";

export const IntakeItemSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    versionId: UlidSchema.optional(),
    requirementId: UlidSchema.optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(8000).optional(),
    status: IntakeStatusSchema,
    priority: PrioritySchema.optional(),
    reporterId: UlidSchema,
    acceptedAt: IsoDateTimeSchema.optional(),
    convertedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export type IntakeItem = z.infer<typeof IntakeItemSchema>;

export const CreateIntakeItemRequestSchema = z
  .object({
    versionId: UlidSchema.optional(),
    requirementId: UlidSchema.optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(8000).optional(),
    priority: PrioritySchema.optional(),
  })
  .strict();

export type CreateIntakeItemRequest = z.infer<
  typeof CreateIntakeItemRequestSchema
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
});

export const ListIntakeItemsResponseSchema = pageResultSchema(IntakeItemSchema);
export const CreateIntakeItemResponseSchema = IntakeItemSchema;
export const AcceptIntakeItemResponseSchema = IntakeItemSchema;
export const DeferIntakeItemResponseSchema = IntakeItemSchema;
export const RejectIntakeItemResponseSchema = IntakeItemSchema;
