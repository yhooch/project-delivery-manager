import {
  CreateWorkItemRequestSchema,
  PrioritySchema,
  UlidSchema,
  UpdateWorkItemRequestSchema,
  type CreateWorkItemRequest,
  type UpdateWorkItemRequest,
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

const clearableText = (maxLength: number) =>
  z.preprocess(
    (value) => normalizeClearableText(value),
    z.string().max(maxLength).nullable().optional(),
  );

const clearableUlid = z.preprocess(
  (value) => normalizeClearableText(value),
  UlidSchema.nullable().optional(),
);

const optionalPriority = z.preprocess(
  (value) => normalizeOptionalText(value),
  PrioritySchema.optional(),
);

const optionalIsoDateTime = z.preprocess(
  (value) => normalizeOptionalText(value),
  z.string().min(1).optional(),
);

const clearableIsoDateTime = z.preprocess(
  (value) => normalizeClearableText(value),
  z.string().min(1).nullable().optional(),
);

export const createTaskFormSchema = CreateWorkItemRequestSchema.extend({
  assigneeId: optionalUlid,
  description: optionalText(8000),
  dueDate: optionalIsoDateTime,
  intakeItemId: optionalUlid,
  priority: z.preprocess(
    (value) => normalizeOptionalText(value) ?? "MEDIUM",
    PrioritySchema.default("MEDIUM"),
  ),
  requirementId: optionalUlid,
  title: requiredText(200),
  type: z.preprocess(
    (value) => normalizeOptionalText(value) ?? "TASK",
    z.literal("TASK").default("TASK"),
  ),
  versionId: optionalUlid,
  workflowVersionId: optionalUlid,
});

export type CreateTaskFormInput = z.input<typeof createTaskFormSchema>;
export type CreateTaskFormValues = z.output<typeof createTaskFormSchema>;

export const updateTaskFormSchema = UpdateWorkItemRequestSchema.extend({
  assigneeId: clearableUlid,
  description: clearableText(8000),
  dueDate: clearableIsoDateTime,
  intakeItemId: clearableUlid,
  priority: optionalPriority,
  requirementId: clearableUlid,
  title: z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().min(1).max(200).optional(),
  ),
  versionId: clearableUlid,
});

export type UpdateTaskFormInput = z.input<typeof updateTaskFormSchema>;
export type UpdateTaskFormValues = z.output<typeof updateTaskFormSchema>;

export function toCreateTaskRequest(
  input: CreateTaskFormInput,
): CreateWorkItemRequest {
  return CreateWorkItemRequestSchema.parse(createTaskFormSchema.parse(input));
}

export function toUpdateTaskRequest(
  input: UpdateTaskFormInput,
): UpdateWorkItemRequest {
  return UpdateWorkItemRequestSchema.parse(updateTaskFormSchema.parse(input));
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeClearableText(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return value as string | null | undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
