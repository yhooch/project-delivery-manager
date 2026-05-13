import {
  ExecuteActionRequestSchema,
  UlidSchema,
  type ActionFormFieldSummary,
  type ExecuteActionRequest,
  type WorkflowActionSummary,
} from "@project-delivery/shared";
import { z } from "zod";

export type ActionExecutionFormConfig = Pick<
  WorkflowActionSummary,
  "formFields" | "requiresComment"
>;

export type ActionExecutionFormInput = {
  comment?: unknown;
  formValues?: Record<string, unknown>;
} & Record<string, unknown>;

export function createActionExecutionFormSchema(
  config: ActionExecutionFormConfig,
) {
  const formValuesSchema = z.object(createFormValueShape(config.formFields)).strict();

  return z
    .preprocess(
      (value) => normalizeActionFormInput(value, config.formFields),
      z
        .object({
          comment: createCommentSchema(config.requiresComment),
          formValues: formValuesSchema,
        })
        .strict(),
    )
    .transform((value) =>
      ExecuteActionRequestSchema.parse({
        comment: value.comment,
        formValues: removeUndefinedValues(value.formValues),
      }),
    );
}

export function toExecuteActionRequest(
  config: ActionExecutionFormConfig,
  input: ActionExecutionFormInput,
): ExecuteActionRequest {
  return createActionExecutionFormSchema(config).parse(input);
}

function createFormValueShape(fields: ActionFormFieldSummary[]) {
  return Object.fromEntries(
    fields.map((field) => [field.key, createFieldSchema(field)]),
  );
}

function createFieldSchema(field: ActionFormFieldSummary) {
  switch (field.fieldType) {
    case "TEXT":
    case "TEXTAREA":
      return createTextSchema(field.required);
    case "SELECT":
      return createSelectSchema(field);
    case "USER":
      return createUserSchema(field.required);
    case "DATE":
      return createDateSchema(field.required);
    case "NUMBER":
      return createNumberSchema(field.required);
  }
}

function createCommentSchema(required: boolean) {
  if (required) {
    return z.preprocess(
      (value) => normalizeRequiredText(value),
      z.string().min(1).max(4000),
    );
  }

  return z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().max(4000).optional(),
  );
}

function createTextSchema(required: boolean) {
  if (required) {
    return z.preprocess(
      (value) => normalizeRequiredText(value),
      z.string().min(1),
    );
  }

  return z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().min(1).optional(),
  );
}

function createSelectSchema(field: ActionFormFieldSummary) {
  const options = field.options ?? [];
  const optionSchema =
    options.length > 0
      ? z.string().refine((value) => options.includes(value))
      : z.string().min(1);

  if (field.required) {
    return z.preprocess((value) => normalizeRequiredText(value), optionSchema);
  }

  return z.preprocess(
    (value) => normalizeOptionalText(value),
    optionSchema.optional(),
  );
}

function createUserSchema(required: boolean) {
  if (required) {
    return z.preprocess((value) => normalizeRequiredText(value), UlidSchema);
  }

  return z.preprocess(
    (value) => normalizeOptionalText(value),
    UlidSchema.optional(),
  );
}

function createDateSchema(required: boolean) {
  const schema = z
    .string()
    .min(1)
    .refine((value) => !Number.isNaN(new Date(value).getTime()))
    .transform((value) => new Date(value).toISOString());

  if (required) {
    return z.preprocess((value) => normalizeRequiredText(value), schema);
  }

  return z.preprocess((value) => normalizeOptionalText(value), schema.optional());
}

function createNumberSchema(required: boolean) {
  if (required) {
    return z.preprocess(
      (value) => normalizeNumberInput(value),
      z.number().finite(),
    );
  }

  return z.preprocess(
    (value) => normalizeOptionalNumberInput(value),
    z.number().finite().optional(),
  );
}

function normalizeActionFormInput(
  value: unknown,
  fields: ActionFormFieldSummary[],
) {
  if (typeof value !== "object" || value === null) {
    return {
      comment: undefined,
      formValues: {},
    };
  }

  const candidate = value as ActionExecutionFormInput;
  const nestedValues =
    typeof candidate.formValues === "object" && candidate.formValues !== null
      ? candidate.formValues
      : {};

  return {
    comment: candidate.comment,
    formValues: Object.fromEntries(
      fields.map((field) => [
        field.key,
        nestedValues[field.key] ?? candidate[field.key],
      ]),
    ),
  };
}

function normalizeRequiredText(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumberInput(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? Number(trimmed) : undefined;
}

function normalizeOptionalNumberInput(value: unknown): number | undefined {
  const normalized = normalizeNumberInput(value);

  return typeof normalized === "number" ? normalized : undefined;
}

function removeUndefinedValues(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}
