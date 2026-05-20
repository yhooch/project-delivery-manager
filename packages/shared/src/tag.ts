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
const TagNameTokenPattern = /[\p{L}\p{N}]/u;
export const TagNameMaxLength = 30;

export type NormalizedTagName = {
  displayName: string;
  name: string;
  normalizedName: string;
};

export const TagNameSchema = z
  .string()
  .refine((value) => value.length > 0, {
    message: "tag name must not be blank",
  })
  .refine((value) => tagNameLength(value) <= TagNameMaxLength, {
    message: `tag name must be at most ${TagNameMaxLength} characters`,
  })
  .refine((value) => value === normalizeTagNameInput(value).name, {
    message: "tag name must be normalized",
  })
  .refine((value) => !value.includes("#"), {
    message: "tag name must not contain #",
  })
  .refine((value) => hasTagNameToken(value), {
    message: "tag name must include a letter or number",
  });

export const TagNameInputSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => normalizeTagNameInput(value).name.length > 0, {
    message: "tag name must not be blank",
  })
  .refine(
    (value) => tagNameLength(normalizeTagNameInput(value).name) <= TagNameMaxLength,
    {
      message: `tag name must be at most ${TagNameMaxLength} characters`,
    },
  )
  .refine((value) => !normalizeTagNameInput(value).name.includes("#"), {
    message: "tag name may only include # as a leading shortcut",
  })
  .refine((value) => hasTagNameToken(normalizeTagNameInput(value).name), {
    message: "tag name must include a letter or number",
  });

export const TagDisplayNameSchema = z
  .string()
  .min(2)
  .max(TagNameMaxLength + 1)
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
    normalizedName: z
      .string()
      .min(1)
      .max(TagNameMaxLength)
      .refine((value) => !value.includes("#"), {
        message: "normalizedName must not contain #",
      })
      .refine((value) => hasTagNameToken(value), {
        message: "normalizedName must include a letter or number",
      }),
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

export const TagFilterOptionScopeSchema = z.enum([
  "TASK",
  "BUG",
  "REQUIREMENT",
  "INTAKE_ITEM",
  "SPACE_EXCEPTION",
]);
export type TagFilterOptionScope = z.infer<
  typeof TagFilterOptionScopeSchema
>;

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

export const ListTagFilterOptionsQuerySchema = z
  .object({
    scope: TagFilterOptionScopeSchema,
  })
  .strict();

export type ListTagFilterOptionsQuery = z.infer<
  typeof ListTagFilterOptionsQuerySchema
>;

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
export const ListTagFilterOptionsResponseSchema = z
  .object({
    items: TagListSchema,
  })
  .strict();
export type ListTagFilterOptionsResponse = z.infer<
  typeof ListTagFilterOptionsResponseSchema
>;
export const CreateTagResponseSchema = TagDtoSchema;
export const DeleteTagResponseSchema = EmptyObjectSchema;
export const GetTagAssignmentsResponseSchema = TagAssignmentsResponseSchema;
export const ReplaceTagAssignmentsResponseSchema = TagAssignmentsResponseSchema;

export function normalizeTagNameInput(value: string): NormalizedTagName {
  const withoutShortcut = stripLeadingShortcut(value);
  const name = collapseWhitespace(withoutShortcut.trim());
  const normalizedName = name.toLocaleLowerCase("en-US");

  return {
    displayName: `#${name}`,
    name,
    normalizedName,
  };
}

export function normalizeTagSearchQuery(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeTagNameInput(value).normalizedName;

  return normalized.length > 0 ? normalized : undefined;
}

function stripLeadingShortcut(value: string): string {
  return value.trim().replace(/^#+/u, "").trim();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ");
}

function tagNameLength(value: string): number {
  return [...value].length;
}

function hasTagNameToken(value: string): boolean {
  return TagNameTokenPattern.test(value);
}
