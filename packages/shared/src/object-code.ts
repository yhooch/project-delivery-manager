import { z } from "zod";

import { UlidSchema } from "./common.ts";
import { WorkItemTypeSchema } from "./enums.ts";

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
  })
  .strict();

export type ObjectCodeLookupQuery = z.infer<
  typeof ObjectCodeLookupQuerySchema
>;

export const ObjectCodeLookupResultSchema = DisplayIdentitySchema.extend({
  id: UlidSchema,
  type: z.enum(["REQUIREMENT", "INTAKE_ITEM", "WORK_ITEM"]),
  workItemType: WorkItemTypeSchema.optional(),
  organizationId: UlidSchema,
  spaceId: UlidSchema,
  sequence: DisplaySequenceSchema,
  displayCode: DisplayCodeSchema,
  title: z.string().min(1).max(200),
}).strict();

export type ObjectCodeLookupResult = z.infer<
  typeof ObjectCodeLookupResultSchema
>;
