import { z } from "zod";
import { PageQuerySchema, UlidSchema, pageResultSchema } from "./common.ts";
import { OrganizationRoleSchema, RecordStatusSchema } from "./enums.ts";
import { UsernameSchema } from "./user.ts";

export const OrganizationCodeSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const OrganizationSchema = z
  .object({
    id: UlidSchema,
    name: z.string().min(1).max(120),
    code: OrganizationCodeSchema,
    ownerId: UlidSchema.optional(),
    status: RecordStatusSchema,
  })
  .strict();

export type Organization = z.infer<typeof OrganizationSchema>;

export const OrganizationMemberSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    userId: UlidSchema,
    role: OrganizationRoleSchema,
    status: RecordStatusSchema,
  })
  .strict();

export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;

export const OrganizationMemberUserSummarySchema = z
  .object({
    id: UlidSchema,
    username: UsernameSchema,
    name: z.string().min(1).max(120),
    avatar: z.url().optional(),
    status: RecordStatusSchema,
  })
  .strict();

export type OrganizationMemberUserSummary = z.infer<
  typeof OrganizationMemberUserSummarySchema
>;

export const OrganizationMemberWithUserSchema = OrganizationMemberSchema.extend(
  {
    user: OrganizationMemberUserSummarySchema,
  },
).strict();

export type OrganizationMemberWithUser = z.infer<
  typeof OrganizationMemberWithUserSchema
>;

export const CreateOrganizationRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    code: OrganizationCodeSchema.optional(),
  })
  .strict();

export type CreateOrganizationRequest = z.infer<
  typeof CreateOrganizationRequestSchema
>;

export const UpdateOrganizationRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    code: OrganizationCodeSchema.optional(),
    status: RecordStatusSchema.optional(),
  })
  .strict();

export type UpdateOrganizationRequest = z.infer<
  typeof UpdateOrganizationRequestSchema
>;

export const AddOrganizationMemberRequestSchema = z
  .object({
    username: UsernameSchema.optional(),
    userId: UlidSchema.optional(),
    role: OrganizationRoleSchema,
  })
  .strict()
  .refine((value) => Boolean(value.username ?? value.userId), {
    message: "Either username or userId is required",
    path: ["username"],
  });

export type AddOrganizationMemberRequest = z.infer<
  typeof AddOrganizationMemberRequestSchema
>;

export const UpdateOrganizationMemberRequestSchema = z
  .object({
    role: OrganizationRoleSchema.optional(),
    status: RecordStatusSchema.optional(),
  })
  .strict();

export type UpdateOrganizationMemberRequest = z.infer<
  typeof UpdateOrganizationMemberRequestSchema
>;

export const ListOrganizationsQuerySchema = PageQuerySchema;
export const ListOrganizationsResponseSchema = pageResultSchema(
  OrganizationSchema,
);
export const CreateOrganizationResponseSchema = OrganizationSchema;
export const GetOrganizationResponseSchema = OrganizationSchema;
export const UpdateOrganizationResponseSchema = OrganizationSchema;

export const ListOrganizationMembersQuerySchema = PageQuerySchema.extend({
  role: OrganizationRoleSchema.optional(),
  status: RecordStatusSchema.optional(),
});
export const ListOrganizationMembersResponseSchema = pageResultSchema(
  OrganizationMemberWithUserSchema,
);
export const AddOrganizationMemberResponseSchema =
  OrganizationMemberWithUserSchema;
export const UpdateOrganizationMemberResponseSchema =
  OrganizationMemberWithUserSchema;
