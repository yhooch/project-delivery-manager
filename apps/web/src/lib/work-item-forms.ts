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

const optionalPriority = z.preprocess(
  (value) => normalizeOptionalText(value),
  PrioritySchema.optional(),
);

const optionalIsoDateTime = z.preprocess(
  (value) => normalizeOptionalText(value),
  z.string().min(1).optional(),
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
  assigneeId: optionalUlid,
  blockedReason: optionalText(1000),
  description: optionalText(8000),
  dueDate: optionalIsoDateTime,
  priority: optionalPriority,
  requirementId: optionalUlid,
  title: z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().min(1).max(200).optional(),
  ),
  versionId: optionalUlid,
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
