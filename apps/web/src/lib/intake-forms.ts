import {
  ConvertIntakeItemToWorkItemsRequestSchema,
  CreateIntakeItemRequestSchema,
  IntakeSourceObjectSchema,
  IntakeSourceTypeSchema,
  IntakeTaskInputSchema,
  PrioritySchema,
  UlidSchema,
  UpdateIntakeItemRequestSchema,
  type ConvertIntakeItemToWorkItemsRequest,
  type CreateIntakeItemRequest,
  type UpdateIntakeItemRequest,
} from "@project-delivery/shared";
import { z } from "zod";

const optionalText = (maxLength: number) =>
  z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().max(maxLength).optional(),
  );

const requiredText = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1).max(maxLength),
  );

const optionalUlid = z.preprocess(
  (value) => normalizeOptionalText(value),
  UlidSchema.optional(),
);

const optionalPriority = z.preprocess(
  (value) => normalizeOptionalText(value),
  PrioritySchema.optional(),
);

const optionalIsoDateTime = z.preprocess(
  (value) => normalizeOptionalText(value),
  z.string().min(1).optional(),
);

const optionalSourceObject = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}, IntakeSourceObjectSchema.optional());

const intakeBaseFormFields = {
  assigneeId: optionalUlid,
  description: optionalText(8000),
  priority: optionalPriority,
  requirementId: optionalUlid,
  sourceObject: optionalSourceObject,
  versionId: optionalUlid,
};

const intakeTaskFormSchema = IntakeTaskInputSchema.extend({
  assigneeId: optionalUlid,
  description: optionalText(8000),
  dueDate: optionalIsoDateTime,
  priority: optionalPriority,
  requirementId: optionalUlid,
  title: requiredText(200),
  versionId: optionalUlid,
  workflowVersionId: optionalUlid,
});

export const createIntakeItemFormSchema = CreateIntakeItemRequestSchema.extend({
  ...intakeBaseFormFields,
  sourceType: IntakeSourceTypeSchema,
  title: requiredText(200),
});

export type CreateIntakeItemFormInput = z.input<
  typeof createIntakeItemFormSchema
>;
export type CreateIntakeItemFormValues = z.output<
  typeof createIntakeItemFormSchema
>;

export const updateIntakeItemFormSchema = UpdateIntakeItemRequestSchema.extend({
  ...intakeBaseFormFields,
  sourceType: IntakeSourceTypeSchema.optional(),
  title: z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().min(1).max(200).optional(),
  ),
});

export type UpdateIntakeItemFormInput = z.input<
  typeof updateIntakeItemFormSchema
>;
export type UpdateIntakeItemFormValues = z.output<
  typeof updateIntakeItemFormSchema
>;

export const intakeStatusActionFormSchema = z
  .object({
    action: z.enum(["accept", "defer", "reject"]),
  })
  .strict();

export type IntakeStatusActionFormValues = z.output<
  typeof intakeStatusActionFormSchema
>;

export const convertIntakeItemFormSchema =
  ConvertIntakeItemToWorkItemsRequestSchema.extend({
    tasks: z.array(intakeTaskFormSchema).min(1),
  });

export type ConvertIntakeItemFormInput = z.input<
  typeof convertIntakeItemFormSchema
>;
export type ConvertIntakeItemFormValues = z.output<
  typeof convertIntakeItemFormSchema
>;

export function toCreateIntakeItemRequest(
  input: CreateIntakeItemFormInput,
): CreateIntakeItemRequest {
  return CreateIntakeItemRequestSchema.parse(
    createIntakeItemFormSchema.parse(input),
  );
}

export function toUpdateIntakeItemRequest(
  input: UpdateIntakeItemFormInput,
): UpdateIntakeItemRequest {
  return UpdateIntakeItemRequestSchema.parse(
    updateIntakeItemFormSchema.parse(input),
  );
}

export function toConvertIntakeItemRequest(
  input: ConvertIntakeItemFormInput,
): ConvertIntakeItemToWorkItemsRequest {
  return ConvertIntakeItemToWorkItemsRequestSchema.parse(
    convertIntakeItemFormSchema.parse(input),
  );
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}
