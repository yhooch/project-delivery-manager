import { z } from "zod";
import {
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import { RecordStatusSchema, SpaceRoleSchema } from "./enums.ts";
import { OrganizationMemberUserSummarySchema } from "./organization.ts";
import { UsernameSchema } from "./user.ts";
import { VersionSummarySchema } from "./version.ts";
import { DefaultWorkflowSummarySchema } from "./workflow.ts";

export const SpaceCodeSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const SpaceSettingsSchema = z
  .object({
    staleThresholdDays: z.number().int().min(1).max(30).default(3),
  })
  .strict();

export type SpaceSettings = z.infer<typeof SpaceSettingsSchema>;

export const SpaceSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    name: z.string().min(1).max(120),
    code: SpaceCodeSchema,
    description: z.string().max(2000).optional(),
    ownerId: UlidSchema.optional(),
    status: RecordStatusSchema,
    settings: SpaceSettingsSchema,
  })
  .strict();

export type Space = z.infer<typeof SpaceSchema>;

export const SpaceSummarySchema = SpaceSchema.pick({
  id: true,
  organizationId: true,
  name: true,
  code: true,
  description: true,
  ownerId: true,
  status: true,
});

export type SpaceSummary = z.infer<typeof SpaceSummarySchema>;

export const SpaceMemberSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    userId: UlidSchema,
    role: SpaceRoleSchema,
    status: RecordStatusSchema,
  })
  .strict();

export type SpaceMember = z.infer<typeof SpaceMemberSchema>;

export const SpaceMemberWithUserSchema = SpaceMemberSchema.extend({
  user: OrganizationMemberUserSummarySchema,
}).strict();

export type SpaceMemberWithUser = z.infer<typeof SpaceMemberWithUserSchema>;

export const SpaceOverviewStatsSchema = z
  .object({
    versionCount: z.number().int().min(0),
    requirementCount: z.number().int().min(0),
    taskCount: z.number().int().min(0),
    completedTaskCount: z.number().int().min(0),
    bugCount: z.number().int().min(0),
    openBugCount: z.number().int().min(0),
    blockedCount: z.number().int().min(0),
    overdueCount: z.number().int().min(0),
  })
  .strict();

export type SpaceOverviewStats = z.infer<typeof SpaceOverviewStatsSchema>;

export const SpaceOverviewSchema = z
  .object({
    space: SpaceSchema,
    currentVersion: VersionSummarySchema.optional(),
    stats: SpaceOverviewStatsSchema,
    defaultWorkflows: z.array(DefaultWorkflowSummarySchema),
  })
  .strict();

export type SpaceOverview = z.infer<typeof SpaceOverviewSchema>;

export const CreateSpaceRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    code: SpaceCodeSchema.optional(),
    description: z.string().max(2000).optional(),
    ownerId: UlidSchema.optional(),
    staleThresholdDays: z.number().int().min(1).max(30).optional(),
  })
  .strict();

export type CreateSpaceRequest = z.infer<typeof CreateSpaceRequestSchema>;

export const UpdateSpaceRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    code: SpaceCodeSchema.optional(),
    description: z.string().max(2000).optional(),
    ownerId: UlidSchema.optional(),
    status: RecordStatusSchema.optional(),
    staleThresholdDays: z.number().int().min(1).max(30).optional(),
  })
  .strict();

export type UpdateSpaceRequest = z.infer<typeof UpdateSpaceRequestSchema>;

export const AddSpaceMemberRequestSchema = z
  .object({
    username: UsernameSchema.optional(),
    userId: UlidSchema.optional(),
    role: SpaceRoleSchema,
  })
  .strict()
  .refine((value) => Boolean(value.username ?? value.userId), {
    message: "Either username or userId is required",
    path: ["username"],
  });

export type AddSpaceMemberRequest = z.infer<typeof AddSpaceMemberRequestSchema>;

export const UpdateSpaceMemberRequestSchema = z
  .object({
    role: SpaceRoleSchema.optional(),
    status: RecordStatusSchema.optional(),
  })
  .strict();

export type UpdateSpaceMemberRequest = z.infer<
  typeof UpdateSpaceMemberRequestSchema
>;

export const ListSpacesQuerySchema = PageQuerySchema.extend({
  status: RecordStatusSchema.optional(),
});
export const ListSpacesResponseSchema = pageResultSchema(SpaceSummarySchema);
export const CreateSpaceResponseSchema = SpaceSchema;
export const GetSpaceResponseSchema = SpaceSchema;
export const UpdateSpaceResponseSchema = SpaceSchema;

export const ListSpaceMembersQuerySchema = PageQuerySchema.extend({
  role: SpaceRoleSchema.optional(),
  status: RecordStatusSchema.optional(),
});
export const ListSpaceMembersResponseSchema = pageResultSchema(
  SpaceMemberWithUserSchema,
);
export const AddSpaceMemberResponseSchema = SpaceMemberWithUserSchema;
export const UpdateSpaceMemberResponseSchema = SpaceMemberWithUserSchema;

export const GetSpaceOverviewResponseSchema = SpaceOverviewSchema;
