import {
  BugSeveritySchema,
  CreateBugRequestSchema,
  PrioritySchema,
  UlidSchema,
  UpdateBugRequestSchema,
  type CreateBugRequest,
  type UpdateBugRequest,
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

const optionalSeverity = z.preprocess(
  (value) => normalizeOptionalText(value),
  BugSeveritySchema.optional(),
);

const optionalIsoDateTime = z.preprocess(
  (value) => normalizeOptionalText(value),
  z.string().min(1).optional(),
);

export const createBugFormSchema = CreateBugRequestSchema.extend({
  actualResult: optionalText(8000),
  assigneeId: optionalUlid,
  description: optionalText(8000),
  dueDate: optionalIsoDateTime,
  expectedResult: optionalText(8000),
  priority: z.preprocess(
    (value) => normalizeOptionalText(value) ?? "MEDIUM",
    PrioritySchema.default("MEDIUM"),
  ),
  relatedTaskId: optionalUlid,
  requirementId: optionalUlid,
  severity: z.preprocess(
    (value) => normalizeOptionalText(value) ?? "MAJOR",
    BugSeveritySchema.default("MAJOR"),
  ),
  stepsToReproduce: optionalText(8000),
  title: requiredText(200),
  versionId: optionalUlid,
  workflowVersionId: optionalUlid,
});

export type CreateBugFormInput = z.input<typeof createBugFormSchema>;
export type CreateBugFormValues = z.output<typeof createBugFormSchema>;

export const updateBugFormSchema = UpdateBugRequestSchema.extend({
  actualResult: optionalText(8000),
  assigneeId: optionalUlid,
  blockedReason: optionalText(1000),
  description: optionalText(8000),
  dueDate: optionalIsoDateTime,
  expectedResult: optionalText(8000),
  fixNote: optionalText(8000),
  priority: optionalPriority,
  regressionAt: optionalIsoDateTime,
  regressionBy: optionalUlid,
  regressionResult: optionalText(8000),
  relatedTaskId: optionalUlid,
  requirementId: optionalUlid,
  severity: optionalSeverity,
  stepsToReproduce: optionalText(8000),
  title: z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().min(1).max(200).optional(),
  ),
  versionId: optionalUlid,
});

export type UpdateBugFormInput = z.input<typeof updateBugFormSchema>;
export type UpdateBugFormValues = z.output<typeof updateBugFormSchema>;

export function toCreateBugRequest(input: CreateBugFormInput): CreateBugRequest {
  return CreateBugRequestSchema.parse(createBugFormSchema.parse(input));
}

export function toUpdateBugRequest(input: UpdateBugFormInput): UpdateBugRequest {
  return UpdateBugRequestSchema.parse(updateBugFormSchema.parse(input));
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}
