import { z } from "zod";
import {
  EmptyObjectSchema,
  IsoDateTimeSchema,
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import { TagTargetTypeSchema } from "./enums.ts";

const UlidCsvPattern =
  /^[0-9A-HJKMNP-TV-Z]{26}(,[0-9A-HJKMNP-TV-Z]{26})*$/u;

export const TagNameSchema = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => value.trim().length > 0, {
    message: "tag name must not be blank",
  })
  .refine((value) => !value.includes("#"), {
    message: "tag name must not contain #",
  });

export const TagNameInputSchema = z
  .string()
  .min(1)
  .max(41)
  .refine((value) => normalizeTagInputName(value).length > 0, {
    message: "tag name must not be blank",
  })
  .refine((value) => normalizeTagInputName(value).length <= 40, {
    message: "tag name must be at most 40 characters",
  })
  .refine((value) => !normalizeTagInputName(value).includes("#"), {
    message: "tag name may only include # as a leading shortcut",
  });

export const TagDisplayNameSchema = z
  .string()
  .min(2)
  .max(41)
  .startsWith("#");

export const TagColorKeySchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_-]*$/u, "Expected a controlled color key");

export const TagIdListSchema = z.array(UlidSchema).max(100);

export const TagMatchSchema = z.enum(["ANY", "ALL"]);
export type TagMatch = z.infer<typeof TagMatchSchema>;

export const TagIdsQueryParamSchema = z
  .string()
  .regex(UlidCsvPattern, "Expected comma-separated ULIDs");

export const TagFilterQuerySchema = z
  .object({
    tagIds: TagIdsQueryParamSchema.optional(),
    tagMatch: TagMatchSchema.default("ANY"),
  })
  .strict();

export type TagFilterQuery = z.infer<typeof TagFilterQuerySchema>;

export const TagDtoSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    name: TagNameSchema,
    displayName: TagDisplayNameSchema,
    normalizedName: z.string().min(1).max(80),
    colorKey: TagColorKeySchema,
    usageCount: z.number().int().min(0).optional(),
    isOrphan: z.boolean().optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.displayName !== `#${value.name}`) {
      context.addIssue({
        code: "custom",
        path: ["displayName"],
        message: "displayName must equal # + name",
      });
    }
  });

export type TagDto = z.infer<typeof TagDtoSchema>;

export const TagListSchema = z.array(TagDtoSchema);

export const CreateTagRequestSchema = z
  .object({
    name: TagNameInputSchema,
  })
  .strict();

export type CreateTagRequest = z.infer<typeof CreateTagRequestSchema>;

export const ListTagsQuerySchema = PageQuerySchema.extend({
  query: z.string().max(80).optional(),
  includeUsage: z.coerce.boolean().default(false),
});

export type ListTagsQuery = z.infer<typeof ListTagsQuerySchema>;

export const TagAssignmentDtoSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    targetType: TagTargetTypeSchema,
    targetId: UlidSchema,
    tagId: UlidSchema,
    tag: TagDtoSchema,
    assignedById: UlidSchema.optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export type TagAssignmentDto = z.infer<typeof TagAssignmentDtoSchema>;

export const GetTagAssignmentsQuerySchema = z
  .object({
    targetType: TagTargetTypeSchema,
    targetId: UlidSchema,
  })
  .strict();

export type GetTagAssignmentsQuery = z.infer<
  typeof GetTagAssignmentsQuerySchema
>;

export const ReplaceTagAssignmentsRequestSchema = z
  .object({
    targetType: TagTargetTypeSchema,
    targetId: UlidSchema,
    tagIds: TagIdListSchema,
  })
  .strict();

export type ReplaceTagAssignmentsRequest = z.infer<
  typeof ReplaceTagAssignmentsRequestSchema
>;

export const TagAssignmentsResponseSchema = z
  .object({
    targetType: TagTargetTypeSchema,
    targetId: UlidSchema,
    tags: TagListSchema,
  })
  .strict();

export type TagAssignmentsResponse = z.infer<
  typeof TagAssignmentsResponseSchema
>;

export const ListTagsResponseSchema = pageResultSchema(TagDtoSchema);
export const CreateTagResponseSchema = TagDtoSchema;
export const DeleteTagResponseSchema = EmptyObjectSchema;
export const GetTagAssignmentsResponseSchema = TagAssignmentsResponseSchema;
export const ReplaceTagAssignmentsResponseSchema = TagAssignmentsResponseSchema;

function normalizeTagInputName(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed;
}
