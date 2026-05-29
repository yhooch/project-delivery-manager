import { z } from "zod";

import { UlidSchema } from "./common.ts";
import { DocumentKindSchema, WorkItemTypeSchema } from "./enums.ts";

export const ObjectCodeTypeSchema = z.enum([
  "REQUIREMENT",
  "INTAKE_ITEM",
  "TASK",
  "BUG",
]);

export type ObjectCodeType = z.infer<typeof ObjectCodeTypeSchema>;

const DisplaySequenceSchema = z.number().int().positive();
const DisplayCodeSchema = z
  .string()
  .regex(/^(REQ|INTAKE|TASK|BUG)-[1-9]\d*$/u);

export const DisplayIdentitySchema = z
  .object({
    sequence: DisplaySequenceSchema.optional(),
    displayCode: DisplayCodeSchema.optional(),
  })
  .strict();

export type DisplayIdentity = z.infer<typeof DisplayIdentitySchema>;

export const ObjectCodeLookupQuerySchema = z
  .object({
    organizationId: UlidSchema,
    spaceId: UlidSchema.optional(),
    code: z.string().trim().min(1).max(64),
    includeHistorical: z.coerce.boolean().optional(),
  })
  .strict();

export type ObjectCodeLookupQuery = z.infer<
  typeof ObjectCodeLookupQuerySchema
>;

export const ObjectCodeLookupResultSchema = DisplayIdentitySchema.extend({
  id: UlidSchema,
  type: z.enum(["REQUIREMENT", "INTAKE_ITEM", "WORK_ITEM"]),
  targetType: z.enum(["DOCUMENT", "INTAKE_ITEM", "WORK_ITEM"]),
  targetId: UlidSchema,
  kind: DocumentKindSchema.optional(),
  previousKind: z.literal("REQUIREMENT").optional(),
  codeStatus: z.enum(["ASSIGNED", "CANCELLED", "DELETED"]).optional(),
  workItemType: WorkItemTypeSchema.optional(),
  organizationId: UlidSchema,
  spaceId: UlidSchema,
  sequence: DisplaySequenceSchema,
  displayCode: DisplayCodeSchema,
  title: z.string().min(1).max(200),
})
  .strict()
  .superRefine((value, context) => {
    if (value.targetId !== value.id) {
      context.addIssue({
        code: "custom",
        message: "targetId must match id for object code lookup results",
        path: ["targetId"],
      });
    }

    if (value.type === "REQUIREMENT") {
      if (value.targetType !== "DOCUMENT") {
        context.addIssue({
          code: "custom",
          message: "REQ lookup results must use DOCUMENT as targetType",
          path: ["targetType"],
        });
      }

      if (value.kind !== "REQUIREMENT" && value.previousKind !== "REQUIREMENT") {
        context.addIssue({
          code: "custom",
          message:
            "REQ lookup results must include kind=REQUIREMENT or previousKind=REQUIREMENT",
          path: ["kind"],
        });
      }

      if (!value.displayCode.startsWith("REQ-")) {
        context.addIssue({
          code: "custom",
          message: "REQUIREMENT lookup results must use REQ display codes",
          path: ["displayCode"],
        });
      }

      return;
    }

    if (value.kind !== undefined || value.previousKind !== undefined) {
      context.addIssue({
        code: "custom",
        message:
          "kind is only valid for requirement document lookup results",
        path: value.kind !== undefined ? ["kind"] : ["previousKind"],
      });
    }

    if (value.type === "INTAKE_ITEM" && value.targetType !== "INTAKE_ITEM") {
      context.addIssue({
        code: "custom",
        message: "INTAKE_ITEM lookup results must use INTAKE_ITEM targetType",
        path: ["targetType"],
      });
    }

    if (value.type === "WORK_ITEM" && value.targetType !== "WORK_ITEM") {
      context.addIssue({
        code: "custom",
        message: "WORK_ITEM lookup results must use WORK_ITEM targetType",
        path: ["targetType"],
      });
    }
  });

export type ObjectCodeLookupResult = z.infer<
  typeof ObjectCodeLookupResultSchema
>;
