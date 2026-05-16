import { z } from "zod";
import { EmptyObjectSchema } from "./common.ts";
import { PasswordSchema, UserPreferencesSchema, UsernameSchema } from "./user.ts";
import { OrganizationRoleSchema, RecordStatusSchema, SpaceRoleSchema } from "./enums.ts";

export const RecentOrganizationCookieName = "pdm.recentOrganizationId";
export const RecentSpaceCookieName = "pdm.recentSpaceId";

export const RegisterRequestSchema = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema,
    confirmPassword: PasswordSchema,
  })
  .strict();

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema,
  })
  .strict();

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LogoutRequestSchema = EmptyObjectSchema;
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const GetAuthSessionQuerySchema = EmptyObjectSchema;

export type GetAuthSessionQuery = z.infer<typeof GetAuthSessionQuerySchema>;

export const ChangePasswordRequestSchema = z
  .object({
    oldPassword: PasswordSchema,
    newPassword: PasswordSchema,
    confirmPassword: PasswordSchema,
  })
  .strict();

export type ChangePasswordRequest = z.infer<
  typeof ChangePasswordRequestSchema
>;

export const SessionOrganizationSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    code: z.string().min(1),
    role: OrganizationRoleSchema,
    status: RecordStatusSchema,
  })
  .strict();

export type SessionOrganizationSummary = z.infer<
  typeof SessionOrganizationSummarySchema
>;

export const SessionSpaceSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    code: z.string().min(1),
    organizationId: z.string().min(1),
    role: SpaceRoleSchema,
    status: RecordStatusSchema,
  })
  .strict();

export type SessionSpaceSummary = z.infer<typeof SessionSpaceSummarySchema>;

export const AppSessionCapabilitiesSchema = z
  .object({
    canCreateOrganization: z.boolean(),
    canCreateSpace: z.boolean(),
  })
  .strict();

export type AppSessionCapabilities = z.infer<
  typeof AppSessionCapabilitiesSchema
>;

export const AppSessionSchema = z
  .object({
    user: z
      .object({
        id: z.string().min(1),
        username: UsernameSchema,
        email: z.email().optional(),
        name: z.string().min(1),
        avatar: z.url().optional(),
        status: RecordStatusSchema,
        preferences: UserPreferencesSchema,
      })
      .strict(),
    organizations: z.array(SessionOrganizationSummarySchema),
    spaces: z.array(SessionSpaceSummarySchema),
    defaultOrganizationId: z.string().min(1).optional(),
    defaultSpaceId: z.string().min(1).optional(),
    capabilities: AppSessionCapabilitiesSchema,
  })
  .strict();

export type AppSession = z.infer<typeof AppSessionSchema>;

export const RegisterResponseSchema = AppSessionSchema;
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

export const LoginResponseSchema = AppSessionSchema;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const LogoutResponseSchema = EmptyObjectSchema;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

export const GetAuthSessionResponseSchema = AppSessionSchema;
export type GetAuthSessionResponse = z.infer<
  typeof GetAuthSessionResponseSchema
>;

export const ChangePasswordResponseSchema = EmptyObjectSchema;
export type ChangePasswordResponse = z.infer<
  typeof ChangePasswordResponseSchema
>;
