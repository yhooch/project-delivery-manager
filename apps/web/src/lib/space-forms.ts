import {
  AddOrganizationMemberRequestSchema,
  AddSpaceMemberRequestSchema,
  CreateSpaceRequestSchema,
  type AddOrganizationMemberRequest,
  type AddSpaceMemberRequest,
  type OrganizationRole,
  type SpaceRole,
  OrganizationRoleSchema,
  SpaceCodeSchema,
  SpaceRoleSchema,
  UlidSchema,
  UpdateSpaceRequestSchema,
} from "@project-delivery/shared";
import { z } from "zod";

const optionalString = (maxLength: number) =>
  z.preprocess(
    (value) => normalizeOptionalText(value),
    z.string().max(maxLength).optional(),
  );

const optionalUlid = z.preprocess(
  (value) => normalizeOptionalText(value),
  UlidSchema.optional(),
);

const optionalSpaceCode = z.preprocess(
  (value) => normalizeOptionalText(value),
  SpaceCodeSchema.optional(),
);

const optionalThresholdDays = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  return Number(value);
}, z.number().int().min(1).max(30).optional());

export const createSpaceFormSchema = CreateSpaceRequestSchema.extend({
  code: optionalSpaceCode,
  description: optionalString(2000),
  ownerId: optionalUlid,
  staleThresholdDays: optionalThresholdDays,
});

export type CreateSpaceFormInput = z.input<typeof createSpaceFormSchema>;
export type CreateSpaceFormValues = z.output<typeof createSpaceFormSchema>;

export const updateSpaceFormSchema = UpdateSpaceRequestSchema.extend({
  code: optionalSpaceCode,
  description: optionalString(2000),
  ownerId: optionalUlid,
  staleThresholdDays: optionalThresholdDays,
});

export type UpdateSpaceFormInput = z.input<typeof updateSpaceFormSchema>;
export type UpdateSpaceFormValues = z.output<typeof updateSpaceFormSchema>;

export type AddOrganizationMemberFormInput = {
  role: OrganizationRole;
  userId?: string;
  username?: string;
};

export const addOrganizationMemberFormSchema = z
  .object({
    role: OrganizationRoleSchema,
    userId: z.string().optional(),
    username: z.string().optional(),
  })
  .superRefine((input, context) => {
    const result = AddOrganizationMemberRequestSchema.safeParse(
      normalizeAddOrganizationMemberInput(input),
    );

    if (!result.success) {
      context.addIssue({
        code: "custom",
        message: "Invalid organization member",
        path: ["username"],
      });
    }
  });

export type AddOrganizationMemberFormValues = z.output<
  typeof addOrganizationMemberFormSchema
>;

export function toAddOrganizationMemberRequest(
  input: AddOrganizationMemberFormValues,
): AddOrganizationMemberRequest {
  return AddOrganizationMemberRequestSchema.parse(
    normalizeAddOrganizationMemberInput(input),
  );
}

export type AddSpaceMemberFormInput = {
  role: SpaceRole;
  userId?: string;
  username?: string;
};

export const addSpaceMemberFormSchema = z
  .object({
    role: SpaceRoleSchema,
    userId: z.string().optional(),
    username: z.string().optional(),
  })
  .superRefine((input, context) => {
    const result = AddSpaceMemberRequestSchema.safeParse(
      normalizeAddSpaceMemberInput(input),
    );

    if (!result.success) {
      context.addIssue({
        code: "custom",
        message: "Invalid space member",
        path: ["userId"],
      });
    }
  });

export type AddSpaceMemberFormValues = z.output<
  typeof addSpaceMemberFormSchema
>;

export function toAddSpaceMemberRequest(
  input: AddSpaceMemberFormValues,
): AddSpaceMemberRequest {
  return AddSpaceMemberRequestSchema.parse(normalizeAddSpaceMemberInput(input));
}

function normalizeAddOrganizationMemberInput(
  input: AddOrganizationMemberFormValues,
) {
  return {
    role: input.role,
    userId: normalizeOptionalText(input.userId),
    username: normalizeOptionalText(input.username),
  };
}

function normalizeAddSpaceMemberInput(input: AddSpaceMemberFormValues) {
  return {
    role: input.role,
    userId: normalizeOptionalText(input.userId),
    username: normalizeOptionalText(input.username),
  };
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}
